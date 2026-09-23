import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDB } from "@/lib/db";
import * as C from "@/constants/colors";
import { parseValorBR } from "@/lib/numero";

interface Fornecedor { id: number; nome: string; telefone: string; observacoes: string; }
interface Cotacao {
  id: number; item_nome: string; fornecedor_id: number; preco: number;
  unidade: string; data_cotacao: string; observacao: string;
}
interface CatalogoItem { id: number; nome: string; unidade: string; custo_por_unidade: number; atualizado_em: string | null; }

type Aba = "cotacoes" | "fornecedores";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (iso: string) => new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR");
const UNIDADES = ["kg", "g", "L", "ml", "un", "cx", "pc"];

export default function FornecedoresScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const empresaId = Number(id);

  const [aba, setAba] = useState<Aba>("cotacoes");
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);

  const [modalCotacao, setModalCotacao] = useState(false);
  const [itemNome, setItemNome] = useState("");
  const [fornecedorId, setFornecedorId] = useState<number | null>(null);
  const [preco, setPreco] = useState("");
  const [unidade, setUnidade] = useState("kg");
  const [dataCotacao, setDataCotacao] = useState(() => new Date().toISOString().slice(0, 10));
  const [obsCotacao, setObsCotacao] = useState("");
  const [sugestoes, setSugestoes] = useState<string[]>([]);
  const [showSug, setShowSug] = useState(false);

  const [fornecedorExpandido, setFornecedorExpandido] = useState<number | null>(null);
  const [buscaCotacao, setBuscaCotacao] = useState("");
  const [buscaFornecedor, setBuscaFornecedor] = useState("");
  const [buscaItensFornecedor, setBuscaItensFornecedor] = useState("");

  const [modalFornecedor, setModalFornecedor] = useState(false);
  const [editandoFornecedor, setEditandoFornecedor] = useState<Fornecedor | null>(null);
  const [fNome, setFNome] = useState("");
  const [fTel, setFTel] = useState("");
  const [fObs, setFObs] = useState("");

  const load = useCallback(() => {
    const db = getDB();
    setFornecedores(db.getAllSync<Fornecedor>("SELECT * FROM fornecedores WHERE empresa_id = ? ORDER BY nome", [empresaId]));
    setCotacoes(db.getAllSync<Cotacao>("SELECT * FROM cotacoes WHERE empresa_id = ?", [empresaId]));
    setCatalogo(db.getAllSync<CatalogoItem>("SELECT * FROM catalogo_ingredientes WHERE empresa_id = ?", [empresaId]));
  }, [empresaId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function abrirNovaCotacao(itemPre?: string, fornecedorPre?: number) {
    setItemNome(itemPre ?? "");
    setFornecedorId(fornecedorPre ?? fornecedores[0]?.id ?? null);
    setPreco("");
    setUnidade("kg");
    setDataCotacao(new Date().toISOString().slice(0, 10));
    setObsCotacao("");
    setShowSug(false);
    setModalCotacao(true);
  }

  function salvarCotacao() {
    if (!itemNome.trim() || !fornecedorId || !preco) return;
    getDB().runSync(
      "INSERT INTO cotacoes (empresa_id, item_nome, fornecedor_id, preco, unidade, data_cotacao, observacao) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [empresaId, itemNome.trim(), fornecedorId, parseValorBR(preco), unidade, dataCotacao, obsCotacao.trim()]
    );
    setModalCotacao(false);
    load();
  }

  function deletarCotacao(c: Cotacao) {
    Alert.alert("Excluir cotação?", `${c.item_nome} — ${fmt(c.preco)}`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => { getDB().runSync("DELETE FROM cotacoes WHERE id = ?", [c.id]); load(); } },
    ]);
  }

  function usarPreco(itemNomeAlvo: string, c: Cotacao) {
    const db = getDB();
    const existente = catalogo.find((ci) => ci.nome.trim().toLowerCase() === itemNomeAlvo.trim().toLowerCase());
    const agora = new Date().toISOString();
    if (existente) {
      db.runSync("UPDATE catalogo_ingredientes SET custo_por_unidade = ?, unidade = ?, atualizado_em = ? WHERE id = ?",
        [c.preco, c.unidade, agora, existente.id]);
    } else {
      db.runSync("INSERT INTO catalogo_ingredientes (empresa_id, nome, unidade, custo_por_unidade, atualizado_em) VALUES (?, ?, ?, ?, ?)",
        [empresaId, itemNomeAlvo, c.unidade, c.preco, agora]);
    }
    Alert.alert("✅", `Preço de ${itemNomeAlvo} atualizado no catálogo.`);
    load();
  }

  function abrirNovoFornecedor(f?: Fornecedor) {
    if (f) { setEditandoFornecedor(f); setFNome(f.nome); setFTel(f.telefone); setFObs(f.observacoes); }
    else { setEditandoFornecedor(null); setFNome(""); setFTel(""); setFObs(""); }
    setModalFornecedor(true);
  }

  function salvarFornecedor() {
    if (!fNome.trim()) return;
    const db = getDB();
    if (editandoFornecedor) {
      db.runSync("UPDATE fornecedores SET nome=?, telefone=?, observacoes=? WHERE id=?", [fNome.trim(), fTel.trim(), fObs.trim(), editandoFornecedor.id]);
    } else {
      db.runSync("INSERT INTO fornecedores (empresa_id, nome, telefone, observacoes) VALUES (?, ?, ?, ?)", [empresaId, fNome.trim(), fTel.trim(), fObs.trim()]);
    }
    setModalFornecedor(false);
    load();
  }

  function deletarFornecedor(f: Fornecedor) {
    Alert.alert("Excluir fornecedor?", `${f.nome} — as cotações feitas com ele também somem.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir", style: "destructive", onPress: () => {
          const db = getDB();
          db.runSync("DELETE FROM cotacoes WHERE fornecedor_id = ?", [f.id]);
          db.runSync("DELETE FROM fornecedores WHERE id = ?", [f.id]);
          load();
        },
      },
    ]);
  }

  function nomeFornecedor(fid: number): string {
    return fornecedores.find((f) => f.id === fid)?.nome ?? "—";
  }

  const itensAgrupados = (() => {
    const porItem = new Map<string, Cotacao[]>();
    for (const c of cotacoes) {
      const chave = c.item_nome.trim().toLowerCase();
      if (!porItem.has(chave)) porItem.set(chave, []);
      porItem.get(chave)!.push(c);
    }
    const resultado: { itemNome: string; lista: Cotacao[] }[] = [];
    for (const lista of porItem.values()) {
      const maisRecente = new Map<number, Cotacao>();
      for (const c of [...lista].sort((a, b) => a.data_cotacao.localeCompare(b.data_cotacao))) {
        maisRecente.set(c.fornecedor_id, c);
      }
      resultado.push({ itemNome: lista[0].item_nome, lista: Array.from(maisRecente.values()).sort((a, b) => a.preco - b.preco) });
    }
    return resultado.sort((a, b) => a.itemNome.localeCompare(b.itemNome));
  })();

  const nomesSugestao = Array.from(new Set([...catalogo.map((c) => c.nome), ...cotacoes.map((c) => c.item_nome)]));

  const idsMaisBaratos = new Set(itensAgrupados.map((g) => g.lista[0]?.id).filter((v): v is number => v !== undefined));

  function itensDoFornecedor(fid: number): Cotacao[] {
    const doFornecedor = cotacoes.filter((c) => c.fornecedor_id === fid);
    const maisRecentePorItem = new Map<string, Cotacao>();
    for (const c of [...doFornecedor].sort((a, b) => a.data_cotacao.localeCompare(b.data_cotacao))) {
      maisRecentePorItem.set(c.item_nome.trim().toLowerCase(), c);
    }
    return Array.from(maisRecentePorItem.values()).sort((a, b) => a.item_nome.localeCompare(b.item_nome));
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>‹</Text></TouchableOpacity>
        <Text style={s.headerTitle}>🚚 Fornecedores</Text>
      </View>

      <View style={s.abaBar}>
        {([["cotacoes", `📋 Cotações (${itensAgrupados.length})`], ["fornecedores", `🚚 Fornecedores (${fornecedores.length})`]] as const).map(([k, label]) => (
          <TouchableOpacity key={k} onPress={() => setAba(k)} style={[s.abaBtn, aba === k && s.abaBtnActive]}>
            <Text style={[s.abaBtnText, aba === k && s.abaBtnTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}>
        {aba === "cotacoes" && fornecedores.length === 0 && (
          <View style={s.avisoBox}><Text style={s.avisoText}>Cadastre pelo menos um fornecedor na aba &quot;Fornecedores&quot; antes de lançar cotações.</Text></View>
        )}

        {aba === "cotacoes" && itensAgrupados.length > 0 && (
          <View style={s.buscaBox}>
            <Text style={s.buscaIcone}>🔍</Text>
            <TextInput style={s.buscaInput} value={buscaCotacao} onChangeText={setBuscaCotacao} placeholder="Buscar por produto..." placeholderTextColor={C.TEXT_MUTED} />
          </View>
        )}

        {aba === "cotacoes" && (
          itensAgrupados.length === 0 ? (
            <View style={s.empty}><Text style={s.emptyEmoji}>🚚</Text><Text style={s.emptyText}>Nenhuma cotação lançada ainda</Text></View>
          ) : itensAgrupados.filter((g) => g.itemNome.toLowerCase().includes(buscaCotacao.toLowerCase())).length === 0 ? (
            <View style={s.empty}><Text style={s.emptyEmoji}>🔍</Text><Text style={s.emptyText}>Nenhum item encontrado para &quot;{buscaCotacao}&quot;</Text></View>
          ) : (
            itensAgrupados.filter((g) => g.itemNome.toLowerCase().includes(buscaCotacao.toLowerCase())).map(({ itemNome, lista }) => {
              const noCatalogo = catalogo.find((ci) => ci.nome.trim().toLowerCase() === itemNome.trim().toLowerCase());
              return (
                <View key={itemNome} style={s.card}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 8 }}>
                    <Text style={s.itemTitulo}>{itemNome}</Text>
                    <TouchableOpacity onPress={() => abrirNovaCotacao(itemNome)} style={s.btnCotar}>
                      <Text style={s.btnCotarText}>+ cotar</Text>
                    </TouchableOpacity>
                  </View>
                  {noCatalogo && (
                    <Text style={s.catalogoInfo}>
                      Catálogo: {fmt(noCatalogo.custo_por_unidade)}/{noCatalogo.unidade}
                      {noCatalogo.atualizado_em ? ` · atualizado em ${fmtData(noCatalogo.atualizado_em)}` : ""}
                    </Text>
                  )}
                  <View style={{ gap: 6, marginTop: 8 }}>
                    {lista.map((c, i) => (
                      <View key={c.id} style={[s.cotRow, i === 0 && s.cotRowMelhor]}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.cotFornecedor}>{nomeFornecedor(c.fornecedor_id)} {i === 0 && <Text style={s.cotMelhorBadge}>✅ Mais barato</Text>}</Text>
                          <Text style={s.cotData}>{fmtData(c.data_cotacao)}{c.observacao ? ` · ${c.observacao}` : ""}</Text>
                        </View>
                        <Text style={s.cotPreco}>{fmt(c.preco)}/{c.unidade}</Text>
                        <TouchableOpacity onPress={() => usarPreco(itemNome, c)} style={s.btnUsar}>
                          <Text style={s.btnUsarText}>Usar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => deletarCotacao(c)} style={{ padding: 4 }}>
                          <Text style={{ color: C.DANGER }}>🗑️</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })
          )
        )}

        {aba === "fornecedores" && fornecedores.length > 0 && (
          <View style={s.buscaBox}>
            <Text style={s.buscaIcone}>🔍</Text>
            <TextInput style={s.buscaInput} value={buscaFornecedor} onChangeText={setBuscaFornecedor} placeholder="Buscar fornecedor..." placeholderTextColor={C.TEXT_MUTED} />
          </View>
        )}

        {aba === "fornecedores" && (
          fornecedores.length === 0 ? (
            <View style={s.empty}><Text style={s.emptyEmoji}>🚚</Text><Text style={s.emptyText}>Nenhum fornecedor cadastrado</Text></View>
          ) : fornecedores.filter((f) => f.nome.toLowerCase().includes(buscaFornecedor.toLowerCase())).length === 0 ? (
            <View style={s.empty}><Text style={s.emptyEmoji}>🔍</Text><Text style={s.emptyText}>Nenhum fornecedor encontrado para &quot;{buscaFornecedor}&quot;</Text></View>
          ) : (
            fornecedores.filter((f) => f.nome.toLowerCase().includes(buscaFornecedor.toLowerCase())).map((f) => {
              const expandido = fornecedorExpandido === f.id;
              const itensCompletos = expandido ? itensDoFornecedor(f.id) : [];
              const itens = itensCompletos.filter((c) => c.item_nome.toLowerCase().includes(buscaItensFornecedor.toLowerCase()));
              return (
                <View key={f.id} style={s.card}>
                  <TouchableOpacity onPress={() => { setFornecedorExpandido(expandido ? null : f.id); setBuscaItensFornecedor(""); }} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, flex: 1 }}>
                      <Text style={{ color: C.TEXT_MUTED, marginTop: 2 }}>{expandido ? "▾" : "▸"}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={s.itemTitulo}>{f.nome}</Text>
                        {!!f.telefone && <Text style={s.fornInfo}>{f.telefone}</Text>}
                        {!!f.observacoes && <Text style={s.fornObs}>{f.observacoes}</Text>}
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", gap: 4 }}>
                      <TouchableOpacity onPress={() => abrirNovoFornecedor(f)} style={{ padding: 6 }}><Text>✏️</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => deletarFornecedor(f)} style={{ padding: 6 }}><Text style={{ color: C.DANGER }}>🗑️</Text></TouchableOpacity>
                    </View>
                  </TouchableOpacity>

                  {expandido && (
                    <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.BORDER, gap: 6 }}>
                      {itensCompletos.length > 4 && (
                        <View style={[s.buscaBox, { marginBottom: 4 }]}>
                          <Text style={s.buscaIcone}>🔍</Text>
                          <TextInput style={s.buscaInput} value={buscaItensFornecedor} onChangeText={setBuscaItensFornecedor} placeholder="Buscar item deste fornecedor..." placeholderTextColor={C.TEXT_MUTED} />
                        </View>
                      )}
                      {itensCompletos.length === 0 ? (
                        <Text style={{ color: C.TEXT_MUTED, fontSize: 13, textAlign: "center", paddingVertical: 6 }}>Nenhum item cotado com esse fornecedor ainda.</Text>
                      ) : itens.length === 0 ? (
                        <Text style={{ color: C.TEXT_MUTED, fontSize: 13, textAlign: "center", paddingVertical: 6 }}>Nenhum item encontrado para &quot;{buscaItensFornecedor}&quot;.</Text>
                      ) : (
                        itens.map((c) => (
                          <View key={c.id} style={[s.cotRow, idsMaisBaratos.has(c.id) && s.cotRowMelhor]}>
                            <View style={{ flex: 1 }}>
                              <Text style={s.cotFornecedor}>{c.item_nome} {idsMaisBaratos.has(c.id) && <Text style={s.cotMelhorBadge}>✅ Mais barato</Text>}</Text>
                              <Text style={s.cotData}>{fmtData(c.data_cotacao)}{c.observacao ? ` · ${c.observacao}` : ""}</Text>
                            </View>
                            <Text style={s.cotPreco}>{fmt(c.preco)}/{c.unidade}</Text>
                            <TouchableOpacity onPress={() => usarPreco(c.item_nome, c)} style={s.btnUsar}>
                              <Text style={s.btnUsarText}>Usar</Text>
                            </TouchableOpacity>
                          </View>
                        ))
                      )}
                      <TouchableOpacity onPress={() => abrirNovaCotacao(undefined, f.id)} style={[s.btnCotar, { alignSelf: "flex-start" }]}>
                        <Text style={s.btnCotarText}>+ cotar novo item com {f.nome}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )
        )}
      </ScrollView>

      <TouchableOpacity
        style={[s.fab, aba === "cotacoes" && fornecedores.length === 0 && { opacity: 0.4 }]}
        onPress={() => (aba === "cotacoes" ? abrirNovaCotacao() : abrirNovoFornecedor())}
        disabled={aba === "cotacoes" && fornecedores.length === 0}
      >
        <Text style={s.fabText}>{aba === "cotacoes" ? "+ Nova cotação" : "+ Novo fornecedor"}</Text>
      </TouchableOpacity>

      {/* Modal Nova Cotação */}
      <Modal visible={modalCotacao} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalCotacao(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.header}>
              <Text style={s.headerTitle}>📋 Nova cotação</Text>
              <TouchableOpacity onPress={() => setModalCotacao(false)}><Text style={{ fontSize: 20, color: C.TEXT_MUTED }}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
              <View>
                <Text style={s.label}>Item</Text>
                <TextInput style={s.input} value={itemNome} onChangeText={(v) => {
                  setItemNome(v);
                  const low = v.toLowerCase();
                  setSugestoes(low ? nomesSugestao.filter((n) => n.toLowerCase().includes(low)) : []);
                  setShowSug(true);
                }} placeholder="Ex: Queijo mussarela" placeholderTextColor={C.TEXT_MUTED} />
                {showSug && sugestoes.length > 0 && (
                  <View style={s.sugestoes}>
                    {sugestoes.slice(0, 6).map((n) => (
                      <TouchableOpacity key={n} onPress={() => { setItemNome(n); setShowSug(false); }} style={s.sugItem}>
                        <Text style={{ fontSize: 14, color: C.TEXT }}>{n}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <View>
                <Text style={s.label}>Fornecedor</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {fornecedores.map((f) => (
                    <TouchableOpacity key={f.id} onPress={() => setFornecedorId(f.id)}
                      style={[s.unidBtn, fornecedorId === f.id && s.unidBtnActive]}>
                      <Text style={[s.unidText, fornecedorId === f.id && { color: "#fff" }]}>{f.nome}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Preço (R$)</Text>
                  <TextInput style={s.input} value={preco} onChangeText={setPreco} placeholder="0,00" placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />
                </View>
                <View>
                  <Text style={s.label}>Unidade</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {UNIDADES.map((u) => (
                      <TouchableOpacity key={u} onPress={() => setUnidade(u)} style={[s.unidBtn, unidade === u && s.unidBtnActive]}>
                        <Text style={[s.unidText, unidade === u && { color: "#fff" }]}>{u}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>

              <View>
                <Text style={s.label}>Data da cotação</Text>
                <TextInput style={s.input} value={dataCotacao} onChangeText={setDataCotacao} placeholder="AAAA-MM-DD" placeholderTextColor={C.TEXT_MUTED} />
              </View>

              <View>
                <Text style={s.label}>Observação (opcional)</Text>
                <TextInput style={s.input} value={obsCotacao} onChangeText={setObsCotacao} placeholder="Ex: pedido mínimo de 5kg" placeholderTextColor={C.TEXT_MUTED} />
              </View>

              <TouchableOpacity style={[s.btnSalvar, (!itemNome.trim() || !fornecedorId || !preco) && { opacity: 0.5 }]}
                onPress={salvarCotacao} disabled={!itemNome.trim() || !fornecedorId || !preco}>
                <Text style={s.btnSalvarText}>Salvar cotação</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Modal Fornecedor */}
      <Modal visible={modalFornecedor} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalFornecedor(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.header}>
              <Text style={s.headerTitle}>{editandoFornecedor ? "✏️ Editar fornecedor" : "🚚 Novo fornecedor"}</Text>
              <TouchableOpacity onPress={() => setModalFornecedor(false)}><Text style={{ fontSize: 20, color: C.TEXT_MUTED }}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              <View>
                <Text style={s.label}>Nome</Text>
                <TextInput style={s.input} value={fNome} onChangeText={setFNome} placeholder="Ex: G Barbosa" placeholderTextColor={C.TEXT_MUTED} />
              </View>
              <View>
                <Text style={s.label}>Telefone (opcional)</Text>
                <TextInput style={s.input} value={fTel} onChangeText={setFTel} placeholder="(00) 00000-0000" placeholderTextColor={C.TEXT_MUTED} keyboardType="phone-pad" />
              </View>
              <View>
                <Text style={s.label}>Observações (opcional)</Text>
                <TextInput style={s.input} value={fObs} onChangeText={setFObs} placeholder="Ex: entrega às terças" placeholderTextColor={C.TEXT_MUTED} />
              </View>
              <TouchableOpacity style={[s.btnSalvar, !fNome.trim() && { opacity: 0.5 }]} onPress={salvarFornecedor} disabled={!fNome.trim()}>
                <Text style={s.btnSalvarText}>{editandoFornecedor ? "Salvar" : "Adicionar"}</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  backBtn: { padding: 4, marginRight: 8 },
  backText: { fontSize: 28, color: C.BRAND, lineHeight: 28 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: C.TEXT, flex: 1 },
  abaBar: { flexDirection: "row", backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  abaBtn: { flex: 1, alignItems: "center", paddingVertical: 11, paddingHorizontal: 4, borderBottomWidth: 2, borderBottomColor: "transparent" },
  abaBtnActive: { borderBottomColor: C.BRAND },
  abaBtnText: { fontSize: 12, fontWeight: "700", color: C.TEXT_MUTED },
  abaBtnTextActive: { color: C.BRAND },
  avisoBox: { backgroundColor: "#fffbeb", borderRadius: 12, padding: 12 },
  avisoText: { color: "#b45309", fontSize: 12, lineHeight: 17 },
  buscaBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.CARD, borderWidth: 1, borderColor: C.BORDER, borderRadius: 12, paddingHorizontal: 12 },
  buscaIcone: { fontSize: 13 },
  buscaInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: C.TEXT },
  card: { backgroundColor: C.CARD, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.BORDER },
  itemTitulo: { fontSize: 15, fontWeight: "800", color: C.TEXT },
  catalogoInfo: { fontSize: 11, color: C.TEXT_MUTED },
  btnCotar: { backgroundColor: "#fffbeb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  btnCotarText: { fontSize: 11, fontWeight: "700", color: "#b45309" },
  cotRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.BG, borderRadius: 10, padding: 10 },
  cotRowMelhor: { backgroundColor: "#ecfdf5", borderWidth: 1, borderColor: "#a7f3d0" },
  cotFornecedor: { fontSize: 13, fontWeight: "700", color: C.TEXT },
  cotMelhorBadge: { fontSize: 10, fontWeight: "800", color: C.SUCCESS },
  cotData: { fontSize: 11, color: C.TEXT_MUTED, marginTop: 1 },
  cotPreco: { fontSize: 13, fontWeight: "800", color: C.TEXT },
  btnUsar: { backgroundColor: C.BRAND, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  btnUsarText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  fornInfo: { fontSize: 13, color: C.TEXT_MUTED, marginTop: 2 },
  fornObs: { fontSize: 12, color: C.TEXT_MUTED, marginTop: 4, fontStyle: "italic" },
  empty: { alignItems: "center", padding: 48 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: C.TEXT_MUTED },
  fab: { position: "absolute", bottom: 20, left: 16, right: 16, backgroundColor: "#d97706", borderRadius: 14, paddingVertical: 14, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 10, elevation: 6 },
  fabText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  label: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, marginBottom: 6 },
  input: { backgroundColor: C.CARD, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.TEXT },
  sugestoes: { backgroundColor: C.CARD, borderRadius: 12, borderWidth: 1, borderColor: C.BORDER, marginTop: 4 },
  sugItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  unidBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, marginRight: 6, height: 36, justifyContent: "center" },
  unidBtnActive: { backgroundColor: C.BRAND, borderColor: C.BRAND },
  unidText: { fontSize: 12, color: C.TEXT_MUTED, fontWeight: "600" },
  btnSalvar: { backgroundColor: "#d97706", borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  btnSalvarText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
