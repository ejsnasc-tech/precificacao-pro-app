import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { getDB } from "@/lib/db";
import { paraCanonico, doCanonico } from "@/lib/backupCanonico";

// "empresas" sempre entra, independente da seleção — sem ela, os dados das
// outras tabelas não têm a quem pertencer na hora de importar.
const TABELA_BASE = "empresas";

export const AREAS = [
  { key: "precificacao", label: "🧮 Precificação", tabelas: ["produtos", "produto_ingredientes", "catalogo_ingredientes"] },
  { key: "financeiro", label: "💰 Financeiro", tabelas: ["lancamentos", "socios"] },
  { key: "estoque", label: "📦 Estoque", tabelas: ["estoque", "estoque_movimentos"] },
  { key: "configuracoes", label: "⚙️ Configurações", tabelas: ["configuracoes_empresa", "cargos_funcionarios", "gastos_variaveis"] },
  { key: "fornecedores", label: "🚚 Fornecedores", tabelas: ["fornecedores", "cotacoes"] },
  { key: "financeiro_pessoal", label: "👤 Finanças Pessoais", tabelas: ["lancamentos_pessoais", "cartoes_pessoais", "gastos_cartao", "metas_pessoais"] },
] as const;

// Ordem não importa pra exportar, mas importa pra importar (pais antes dos
// filhos) — embora desligar foreign_keys durante a importação já evite
// qualquer problema de ordem mesmo assim.
const TABELAS = [TABELA_BASE, ...AREAS.flatMap((a) => a.tabelas)] as const;

export async function exportarBackup(areasSelecionadas: string[]): Promise<void> {
  const db = getDB();
  const brutos: Record<string, Record<string, unknown>[]> = {};
  const tabelasIncluidas = [
    TABELA_BASE,
    ...AREAS.filter((a) => areasSelecionadas.includes(a.key)).flatMap((a) => a.tabelas),
  ];
  for (const tabela of tabelasIncluidas) {
    brutos[tabela] = db.getAllSync<Record<string, unknown>>(`SELECT * FROM ${tabela}`);
  }
  // versao 2: formato canônico, compatível com backup importado/exportado
  // pelo site também (ver lib/backupCanonico.ts).
  const dados: Record<string, unknown> = { versao: 2, exportado_em: new Date().toISOString(), ...paraCanonico(brutos) };

  const data = new Date().toISOString().slice(0, 10);
  const completo = areasSelecionadas.length === AREAS.length;
  const slug = completo ? "completo" : (AREAS.filter((a) => areasSelecionadas.includes(a.key)).map((a) => a.key).join("-") || "vazio");
  const nome = `backup-${slug}-${data}.txt`;
  const file = new File(Paths.cache, nome);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(dados, null, 2));

  const disponivel = await Sharing.isAvailableAsync();
  if (!disponivel) throw new Error("Compartilhamento não disponível neste aparelho.");
  await Sharing.shareAsync(file.uri, { mimeType: "text/plain", dialogTitle: "Backup Top Precificação" });
}

type ResultadoImportacao = { ok: true } | { ok: false; cancelado: true } | { ok: false; cancelado: false; erro: string };

export async function importarBackup(): Promise<ResultadoImportacao> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["text/plain", "application/json", "*/*"],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.[0]) return { ok: false, cancelado: true };

  try {
    const arquivo = new File(res.assets[0].uri);
    const texto = await arquivo.text();
    const bruto = JSON.parse(texto) as Record<string, unknown>;
    // versao 1 (antiga) já vem no formato nativo do app — só backups feitos
    // no site (ou no app depois dessa correção) vêm no formato canônico e
    // precisam passar por doCanonico() antes de inserir no banco.
    const dados = (bruto.versao === 2 ? doCanonico(bruto as unknown as Record<string, Record<string, unknown>[]>) : bruto) as Record<string, Record<string, string | number | null>[]>;

    const db = getDB();
    db.execSync("PRAGMA foreign_keys = OFF");
    db.withTransactionSync(() => {
      for (const tabela of TABELAS) {
        const linhas = dados[tabela];
        if (!Array.isArray(linhas)) continue;
        db.runSync(`DELETE FROM ${tabela}`);
        for (const linha of linhas) {
          const colunas = Object.keys(linha);
          if (colunas.length === 0) continue;
          const placeholders = colunas.map(() => "?").join(",");
          db.runSync(
            `INSERT INTO ${tabela} (${colunas.join(",")}) VALUES (${placeholders})`,
            colunas.map((c) => linha[c])
          );
        }
      }
    });
    db.execSync("PRAGMA foreign_keys = ON");

    return { ok: true };
  } catch (e) {
    return { ok: false, cancelado: false, erro: e instanceof Error ? e.message : "Arquivo inválido ou corrompido." };
  }
}
