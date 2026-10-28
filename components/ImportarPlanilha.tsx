import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { getDB } from "@/lib/db";
import * as C from "@/constants/colors";
import {
  CAMPOS_INGREDIENTE, CAMPOS_PRODUTO, acharCabecalho, sugerirMapa, faltaObrigatorio,
  planejarIngredientes, planejarProdutos,
  type CampoImport, type Mapa, type PlanoIngredientes, type PlanoProdutos,
} from "@/lib/importarPlanilha";

type Tipo = "ingredientes" | "produtos";
type Plano = { tipo: "ingredientes"; dados: PlanoIngredientes } | { tipo: "produtos"; dados: PlanoProdutos };

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Importa uma planilha (.xlsx/.csv) para uma empresa: o usuário diz qual coluna é
// qual, vê uma prévia do que vai entrar e só então grava. Nunca apaga nem
// sobrescreve o que já existe. Espelha components/ImportarPlanilha.tsx do site.
export default function ImportarPlanilha() {
  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [tipo, setTipo] = useState<Tipo>("ingredientes");
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [planilhas, setPlanilhas] = useState<Record<string, unknown[][]>>({});
  const [aba, setAba] = useState("");
  const [cabIdx, setCabIdx] = useState(0);
  const [mapa, setMapa] = useState<Mapa>({});
  const [campoAberto, setCampoAberto] = useState<string | null>(null);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const campos: CampoImport[] = tipo === "ingredientes" ? CAMPOS_INGREDIENTE : CAMPOS_PRODUTO;
  const linhas = planilhas[aba] ?? [];
  const cabecalhos = (linhas[cabIdx] ?? []).map((c) => String(c ?? "").trim());
  const abasComDados = Object.keys(planilhas).filter((n) => planilhas[n].length > 0);

  useEffect(() => {
    const lista = getDB().getAllSync<{ id: number; nome: string }>("SELECT id, nome FROM empresas ORDER BY nome");
    setEmpresas(lista);
    if (lista.length > 0) setEmpresaId((atual) => atual ?? lista[0].id);
  }, []);

  // Sempre que muda a planilha, a aba ou o tipo, tenta adivinhar o cabeçalho e as colunas.
  useEffect(() => {
    if (!aba) return;
    const l = planilhas[aba] ?? [];
    const idx = acharCabecalho(l);
    setCabIdx(idx);
    setMapa(sugerirMapa(l[idx] ?? [], campos));
    setPlano(null);
    setCampoAberto(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, tipo, planilhas]);

  async function escolherArquivo() {
    setMsg(null); setPlano(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ["*/*"], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setOcupado(true);
    try {
      const XLSX = await import("xlsx");
      const arquivo = new File(asset.uri);
      let wb;
      if (/\.(csv|txt)$/i.test(asset.name)) {
        const texto = await arquivo.text();
        const primeira = texto.split(/\r?\n/)[0] ?? "";
        const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ";" : (primeira.includes("\t") ? "\t" : ",");
        wb = XLSX.read(texto, { type: "string", raw: true, FS: sep });
      } else {
        wb = XLSX.read(await arquivo.base64(), { type: "base64" });
      }
      const todas: Record<string, unknown[][]> = {};
      for (const nome of wb.SheetNames) {
        todas[nome] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, defval: "", raw: true });
      }
      const comDados = wb.SheetNames.filter((n) => todas[n].length > 0);
      if (comDados.length === 0) throw new Error("vazia");
      setNomeArquivo(asset.name);
      setPlanilhas(todas);
      setAba(comDados[0]);
    } catch {
      setMsg({ ok: false, texto: "Não consegui ler esse arquivo. Use uma planilha .xlsx ou .csv." });
      setNomeArquivo(""); setPlanilhas({}); setAba("");
    } finally {
      setOcupado(false);
    }
  }

  function verPrevia() {
    if (!empresaId) return;
    setMsg(null);
    const faltam = faltaObrigatorio(mapa, campos);
    if (faltam.length > 0) { setMsg({ ok: false, texto: `Falta indicar a coluna: ${faltam.join(", ")}.` }); return; }
    const db = getDB();
    const dados = linhas.slice(cabIdx + 1);
    const primeira = cabIdx + 2;
    const catalogo = db.getAllSync<{ nome: string; unidade: string; custo_por_unidade: number; fator_correcao: number | null }>(
      "SELECT nome, unidade, custo_por_unidade, fator_correcao FROM catalogo_ingredientes WHERE empresa_id = ?", [empresaId]
    );
    if (tipo === "ingredientes") {
      setPlano({ tipo, dados: planejarIngredientes(dados, mapa, catalogo, primeira) });
    } else {
      const produtos = db.getAllSync<{ nome: string }>("SELECT nome FROM produtos WHERE empresa_id = ?", [empresaId]);
      setPlano({ tipo, dados: planejarProdutos(dados, mapa, produtos.map((p) => p.nome), catalogo, primeira) });
    }
  }

  function importar() {
    if (!plano || !empresaId) return;
    setOcupado(true);
    try {
      const db = getDB();
      let total = 0;
      db.withTransactionSync(() => {
        if (plano.tipo === "ingredientes") {
          for (const i of plano.dados.novos) {
            db.runSync(
              "INSERT INTO catalogo_ingredientes (empresa_id, nome, unidade, custo_por_unidade, fator_correcao) VALUES (?, ?, ?, ?, ?)",
              [empresaId, i.nome, i.unidade, i.custo, i.fator]
            );
            total++;
          }
        } else {
          for (const p of plano.dados.novos) {
            db.runSync(
              "INSERT INTO produtos (empresa_id, nome, margem, tempo_preparo_minutos, pessoas_preparo, rendimento) VALUES (?, ?, ?, 0, 1, 1)",
              [empresaId, p.nome, p.margem]
            );
            const pid = db.getFirstSync<{ id: number }>("SELECT last_insert_rowid() as id")!.id;
            for (const ing of p.ingredientes) {
              db.runSync(
                "INSERT INTO produto_ingredientes (produto_id, nome, quantidade, unidade, custo_por_unidade) VALUES (?, ?, ?, ?, ?)",
                [pid, ing.nome, ing.quantidade, ing.unidade, ing.custo]
              );
            }
            total++;
          }
        }
      });
      Alert.alert("✅ Pronto", `${total} ${tipo === "ingredientes" ? "ingrediente(s) importado(s)" : "produto(s) importado(s)"}. Confira em Precificação.`);
      setPlano(null); setPlanilhas({}); setAba(""); setNomeArquivo("");
    } catch {
      setMsg({ ok: false, texto: "Não foi possível salvar. Nada foi alterado." });
    } finally {
      setOcupado(false);
    }
  }

  const novos = plano ? plano.dados.novos.length : 0;
  const jaExistem = plano ? plano.dados.jaExistem.length : 0;
  const problemas = plano ? plano.dados.problemas : [];

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>3. Importar de uma planilha</Text>
      <Text style={s.cardSub}>
        Já tem seus ingredientes ou receitas numa planilha (Excel, Google Planilhas)? Traga pra cá sem digitar tudo de novo. Nada que você já cadastrou é apagado ou alterado.
      </Text>

      {empresas.length === 0 ? (
        <View style={s.avisoBox}><Text style={s.avisoText}>Cadastre uma empresa primeiro para poder importar.</Text></View>
      ) : (
        <>
          <Text style={s.rotulo}>Importar para a empresa</Text>
          <View style={s.chips}>
            {empresas.map((e) => (
              <TouchableOpacity key={e.id} onPress={() => { setEmpresaId(e.id); setPlano(null); }} style={[s.chip, empresaId === e.id && s.chipAtivo]}>
                <Text style={[s.chipText, empresaId === e.id && s.chipTextAtivo]}>{e.nome}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.rotulo}>O que tem na planilha</Text>
          <View style={s.chips}>
            <TouchableOpacity onPress={() => setTipo("ingredientes")} style={[s.chip, tipo === "ingredientes" && s.chipAtivo]}>
              <Text style={[s.chipText, tipo === "ingredientes" && s.chipTextAtivo]}>Ingredientes e preços</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setTipo("produtos")} style={[s.chip, tipo === "produtos" && s.chipAtivo]}>
              <Text style={[s.chipText, tipo === "produtos" && s.chipTextAtivo]}>Produtos com receita</Text>
            </TouchableOpacity>
          </View>
          {tipo === "produtos" && (
            <View style={s.dicaBox}>
              <Text style={s.dicaText}>💡 Um ingrediente por linha. O preço vem do seu catálogo — importe primeiro os ingredientes para os produtos já saírem com custo.</Text>
            </View>
          )}

          <TouchableOpacity style={[s.btnOutline, ocupado && { opacity: 0.6 }]} onPress={escolherArquivo} disabled={ocupado}>
            {ocupado && !plano ? <ActivityIndicator color={C.BRAND} /> : <Text style={s.btnOutlineText}>{nomeArquivo ? "Trocar planilha" : "Escolher planilha (.xlsx ou .csv)"}</Text>}
          </TouchableOpacity>
          {!!nomeArquivo && <Text style={s.arquivo}>📄 {nomeArquivo}</Text>}

          {!!aba && (
            <View style={{ marginTop: 14, gap: 8 }}>
              {abasComDados.length > 1 && (
                <>
                  <Text style={s.rotulo}>Aba da planilha</Text>
                  <View style={s.chips}>
                    {abasComDados.map((n) => (
                      <TouchableOpacity key={n} onPress={() => setAba(n)} style={[s.chip, aba === n && s.chipAtivo]}>
                        <Text style={[s.chipText, aba === n && s.chipTextAtivo]}>{n}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <Text style={[s.rotulo, { marginTop: 4 }]}>Qual coluna é qual?</Text>
              {campos.map((c) => {
                const idx = mapa[c.chave] ?? -1;
                const aberto = campoAberto === c.chave;
                return (
                  <View key={c.chave}>
                    <TouchableOpacity style={s.campo} onPress={() => setCampoAberto(aberto ? null : c.chave)}>
                      <Text style={s.campoRotulo}>{c.rotulo}{c.obrigatorio ? " *" : ""}</Text>
                      <Text style={s.campoValor} numberOfLines={1}>{idx >= 0 ? (cabecalhos[idx] || `Coluna ${idx + 1}`) : "— não usar —"} ▾</Text>
                    </TouchableOpacity>
                    {aberto && (
                      <View style={s.opcoes}>
                        <TouchableOpacity onPress={() => { setMapa({ ...mapa, [c.chave]: -1 }); setCampoAberto(null); setPlano(null); }}>
                          <Text style={s.opcao}>— não usar —</Text>
                        </TouchableOpacity>
                        {cabecalhos.map((h, i) => (
                          <TouchableOpacity key={i} onPress={() => { setMapa({ ...mapa, [c.chave]: i }); setCampoAberto(null); setPlano(null); }}>
                            <Text style={[s.opcao, idx === i && { color: C.BRAND, fontWeight: "800" }]}>{h || `Coluna ${i + 1}`}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}

              <Text style={s.rotulo}>Primeiras linhas da planilha</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.tabela}>
                  <View style={s.tabelaLinha}>
                    {cabecalhos.map((h, i) => <Text key={i} style={[s.tabelaCel, { fontWeight: "800", color: C.TEXT }]}>{h || `Col ${i + 1}`}</Text>)}
                  </View>
                  {linhas.slice(cabIdx + 1, cabIdx + 4).map((l, r) => (
                    <View key={r} style={s.tabelaLinha}>
                      {cabecalhos.map((_, i) => <Text key={i} style={s.tabelaCel}>{String(l[i] ?? "")}</Text>)}
                    </View>
                  ))}
                </View>
              </ScrollView>

              <TouchableOpacity style={s.btnPrimary} onPress={verPrevia}>
                <Text style={s.btnPrimaryText}>Ver prévia do que vai entrar</Text>
              </TouchableOpacity>
            </View>
          )}

          {plano && (
            <View style={{ marginTop: 14, gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={[s.contador, { backgroundColor: "#ecfdf5" }]}><Text style={[s.contadorNum, { color: "#047857" }]}>{novos}</Text><Text style={[s.contadorTxt, { color: "#047857" }]}>novos</Text></View>
                <View style={[s.contador, { backgroundColor: "#f1f5f9" }]}><Text style={[s.contadorNum, { color: C.TEXT_MUTED }]}>{jaExistem}</Text><Text style={[s.contadorTxt, { color: C.TEXT_MUTED }]}>já existem</Text></View>
                <View style={[s.contador, { backgroundColor: "#fffbeb" }]}><Text style={[s.contadorNum, { color: "#b45309" }]}>{problemas.length}</Text><Text style={[s.contadorTxt, { color: "#b45309" }]}>com problema</Text></View>
              </View>
              <Text style={s.nota}>Os que já existem ficam como estão. Os com problema não entram.</Text>

              {plano.tipo === "ingredientes" && plano.dados.novos.slice(0, 15).map((i) => (
                <View key={i.linha} style={s.itemLinha}>
                  <Text style={s.itemNome} numberOfLines={1}>{i.nome}</Text>
                  <Text style={s.itemInfo}>{fmt(i.custo)}/{i.unidade}{i.fator > 1 ? ` · fator ${i.fator.toLocaleString("pt-BR")}` : ""}</Text>
                </View>
              ))}
              {plano.tipo === "produtos" && plano.dados.novos.slice(0, 15).map((p) => (
                <View key={p.nome} style={s.itemLinha}>
                  <Text style={s.itemNome} numberOfLines={1}>{p.nome}</Text>
                  <Text style={s.itemInfo}>{p.ingredientes.length} ingr. · margem {p.margem.toLocaleString("pt-BR")}%</Text>
                </View>
              ))}
              {novos > 15 && <Text style={s.nota}>… e mais {novos - 15}.</Text>}

              {plano.tipo === "produtos" && plano.dados.semPreco > 0 && (
                <View style={s.avisoBox}>
                  <Text style={s.avisoText}>⚠️ {plano.dados.semPreco} ingrediente(s) das receitas não foram achados no catálogo (ou têm outra unidade) e entram com custo zero. Importe os ingredientes antes, ou ajuste depois em Precificação.</Text>
                </View>
              )}
              {problemas.length > 0 && (
                <View style={s.avisoBox}>
                  <Text style={[s.avisoText, { fontWeight: "800", marginBottom: 4 }]}>O que ficou de fora:</Text>
                  {problemas.slice(0, 20).map((p, i) => <Text key={i} style={s.avisoText}>Linha {p.linha}: {p.motivo}</Text>)}
                  {problemas.length > 20 && <Text style={s.avisoText}>… e mais {problemas.length - 20}.</Text>}
                </View>
              )}

              <TouchableOpacity style={[s.btnPrimary, { backgroundColor: C.SUCCESS }, (ocupado || novos === 0) && { opacity: 0.5 }]} onPress={importar} disabled={ocupado || novos === 0}>
                <Text style={s.btnPrimaryText}>{novos === 0 ? "Nada novo para importar" : `Importar ${novos} ${tipo === "ingredientes" ? "ingrediente(s)" : "produto(s)"}`}</Text>
              </TouchableOpacity>
            </View>
          )}

          {msg && (
            <View style={[s.avisoBox, { marginTop: 12, backgroundColor: msg.ok ? "#ecfdf5" : "#fef2f2" }]}>
              <Text style={[s.avisoText, { color: msg.ok ? "#047857" : C.DANGER }]}>{msg.texto}</Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.CARD, borderRadius: 16, padding: 16, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: C.TEXT, marginBottom: 4 },
  cardSub: { fontSize: 13, color: C.TEXT_MUTED, lineHeight: 18, marginBottom: 12 },
  rotulo: { fontSize: 12, fontWeight: "700", color: C.TEXT_MUTED, marginTop: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER },
  chipAtivo: { backgroundColor: "#eef2ff", borderColor: C.BRAND },
  chipText: { fontSize: 12, fontWeight: "600", color: C.TEXT_MUTED },
  chipTextAtivo: { color: C.BRAND, fontWeight: "700" },
  dicaBox: { backgroundColor: C.BG, borderRadius: 10, padding: 10, marginBottom: 8 },
  dicaText: { fontSize: 12, color: C.TEXT_MUTED, lineHeight: 16 },
  avisoBox: { backgroundColor: "#fffbeb", borderRadius: 10, padding: 10 },
  avisoText: { color: "#b45309", fontSize: 12, lineHeight: 16 },
  btnPrimary: { backgroundColor: C.BRAND, borderRadius: 14, paddingVertical: 13, alignItems: "center", marginTop: 6 },
  btnPrimaryText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  btnOutline: { borderRadius: 14, paddingVertical: 13, alignItems: "center", borderWidth: 2, borderColor: C.BRAND, marginTop: 6 },
  btnOutlineText: { color: C.BRAND, fontWeight: "700", fontSize: 14 },
  arquivo: { fontSize: 12, color: C.TEXT_MUTED, marginTop: 6 },
  campo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  campoRotulo: { fontSize: 13, color: C.TEXT, fontWeight: "600" },
  campoValor: { fontSize: 13, color: C.BRAND, fontWeight: "700", flexShrink: 1 },
  opcoes: { backgroundColor: C.CARD, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, marginTop: 4, paddingVertical: 4 },
  opcao: { paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: C.TEXT },
  tabela: { borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, overflow: "hidden" },
  tabelaLinha: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.BG },
  tabelaCel: { width: 110, paddingHorizontal: 8, paddingVertical: 6, fontSize: 11, color: C.TEXT_MUTED },
  contador: { flex: 1, borderRadius: 12, padding: 10, alignItems: "center" },
  contadorNum: { fontSize: 20, fontWeight: "900" },
  contadorTxt: { fontSize: 11, fontWeight: "600" },
  nota: { fontSize: 11, color: C.TEXT_MUTED },
  itemLinha: { flexDirection: "row", justifyContent: "space-between", gap: 10, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.BG },
  itemNome: { flex: 1, fontSize: 13, color: C.TEXT },
  itemInfo: { fontSize: 12, color: C.TEXT_MUTED },
});
