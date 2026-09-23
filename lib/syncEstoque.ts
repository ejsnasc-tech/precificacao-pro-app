import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { getDB } from "@/lib/db";

interface ItemEstoque {
  id: number; nome: string; unidade: string; quantidade_atual: number;
  quantidade_minima: number; custo_unitario: number; tem_validade: number; dias_alerta: number;
}

export async function exportarEstoque(empresaNome: string, itens: ItemEstoque[]): Promise<void> {
  const payload = {
    tipo: "estoque",
    versao: 1,
    empresa_nome: empresaNome,
    exportado_em: new Date().toISOString(),
    itens: itens.map((i) => ({
      nome: i.nome, unidade: i.unidade, quantidade_atual: i.quantidade_atual,
      quantidade_minima: i.quantidade_minima, custo_unitario: i.custo_unitario,
      tem_validade: i.tem_validade, dias_alerta: i.dias_alerta,
    })),
  };
  const slug = empresaNome.toLowerCase().replace(/\s+/g, "-");
  const nome = `estoque-${slug}-${new Date().toISOString().slice(0, 10)}.txt`;
  const file = new File(Paths.cache, nome);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(payload, null, 2));

  const disponivel = await Sharing.isAvailableAsync();
  if (!disponivel) throw new Error("Compartilhamento não disponível neste aparelho.");
  await Sharing.shareAsync(file.uri, { mimeType: "text/plain", dialogTitle: "Estoque " + empresaNome });
}

interface ItemImportado {
  nome: string; unidade: string; quantidade_atual: number;
  quantidade_minima?: number; custo_unitario?: number; tem_validade?: number; dias_alerta?: number;
}

type ResultadoImportEstoque =
  | { ok: true; atualizados: number; criados: number; removidos: number }
  | { ok: false; cancelado: true }
  | { ok: false; cancelado: false; erro: string };

export async function importarEstoque(empresaId: number, itensAtuais: ItemEstoque[]): Promise<ResultadoImportEstoque> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["text/plain", "application/json", "*/*"],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.[0]) return { ok: false, cancelado: true };

  try {
    const arquivo = new File(res.assets[0].uri);
    const texto = await arquivo.text();
    const dados = JSON.parse(texto) as { itens?: ItemImportado[] };
    if (!Array.isArray(dados.itens)) throw new Error("formato inválido");

    const db = getDB();
    let atualizados = 0;
    let criados = 0;
    let removidos = 0;

    // Agrupa por nome — se já existiam duplicatas salvas localmente, o
    // arquivo importado só traz uma entrada pra esse nome, então colapsamos
    // as duplicatas numa só em vez de só checar se o nome "existe".
    const locaisPorNome = new Map<string, ItemEstoque[]>();
    for (const item of itensAtuais) {
      const chave = item.nome.trim().toLowerCase();
      const grupo = locaisPorNome.get(chave);
      if (grupo) grupo.push(item); else locaisPorNome.set(chave, [item]);
    }

    for (const imp of dados.itens) {
      const chave = imp.nome.trim().toLowerCase();
      const [principal, ...duplicatas] = locaisPorNome.get(chave) ?? [];

      if (principal) {
        if (principal.quantidade_atual !== imp.quantidade_atual) {
          db.runSync(
            "INSERT INTO estoque_movimentos (estoque_id, tipo, quantidade, observacao) VALUES (?, ?, ?, ?)",
            [principal.id, "ajuste", imp.quantidade_atual, `Importado de backup de estoque (era ${principal.quantidade_atual}, agora ${imp.quantidade_atual})`]
          );
          db.runSync("UPDATE estoque SET quantidade_atual = ? WHERE id = ?", [imp.quantidade_atual, principal.id]);
          atualizados++;
        }
        for (const dup of duplicatas) {
          db.runSync("DELETE FROM estoque_movimentos WHERE estoque_id = ?", [dup.id]);
          db.runSync("DELETE FROM estoque WHERE id = ?", [dup.id]);
          removidos++;
        }
        locaisPorNome.delete(chave);
      } else {
        db.runSync(
          "INSERT INTO estoque (empresa_id, nome, unidade, quantidade_atual, quantidade_minima, custo_unitario, tem_validade, dias_alerta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [empresaId, imp.nome, imp.unidade, imp.quantidade_atual, imp.quantidade_minima ?? 0, imp.custo_unitario ?? 0, imp.tem_validade ?? 0, imp.dias_alerta ?? 7]
        );
        const novoId = db.getFirstSync<{ id: number }>("SELECT last_insert_rowid() as id")!.id;
        if (imp.quantidade_atual > 0) {
          db.runSync(
            "INSERT INTO estoque_movimentos (estoque_id, tipo, quantidade, observacao) VALUES (?, ?, ?, ?)",
            [novoId, "entrada", imp.quantidade_atual, "Importado de backup de estoque"]
          );
        }
        criados++;
      }
    }

    // Arquivo importado sempre traz o estoque completo de quem mandou — nomes
    // que sobraram no mapa (não vieram no arquivo) foram excluídos na origem,
    // remove aqui também.
    for (const local of Array.from(locaisPorNome.values()).flat()) {
      db.runSync("DELETE FROM estoque_movimentos WHERE estoque_id = ?", [local.id]);
      db.runSync("DELETE FROM estoque WHERE id = ?", [local.id]);
      removidos++;
    }

    return { ok: true, atualizados, criados, removidos };
  } catch (e) {
    return {
      ok: false, cancelado: false,
      erro: e instanceof Error && e.message !== "formato inválido" ? e.message : "Arquivo inválido. Verifique se é um backup de estoque gerado por este app.",
    };
  }
}
