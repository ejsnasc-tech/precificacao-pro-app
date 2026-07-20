import { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Modal, FlatList, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDB } from "@/lib/db";
import * as C from "@/constants/colors";

interface Config {
  regime_tributario: string; aliquota_imposto: number; taxa_cartao: number;
  taxa_delivery: number; margem_lucro: number; num_funcionarios: number;
  salario_medio: number; horas_mes: number; perda_percentual: number;
}
interface Ingrediente { id?: number; nome: string; quantidade: string; unidade: string; custo_unitario: string; }
interface Produto { id: number; nome: string; categoria: string; preco_venda: number; }
interface CatalogoItem { id: number; nome: string; unidade: string; custo_unitario: number; }

type Aba = "calcular" | "salvos" | "ingredientes" | "config";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const UNIDADES = ["kg", "g", "L", "ml", "un", "cx", "pc", "saco", "fardo"];

export default function PrecificacaoScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const empresaId = Number(id);

  const [aba, setAba] = useState<Aba>("calcular");
  const [config, setConfig] = useState<Config>({
    regime_tributario: "simples", aliquota_imposto: 6, taxa_cartao: 3,
    taxa_delivery: 12, margem_lucro: 30, num_funcionarios: 1,
    salario_medio: 1500, horas_mes: 160, perda_percentual: 5,
  });

  // Calculadora
  const [nomeProduto, setNomeProduto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([
    { nome: "", quantidade: "", unidade: "kg", custo_unitario: "" },
  ]);
  const [usarDelivery, setUsarDelivery] = useState(false);
  const [usarCartao, setUsarCartao] = useState(true);
  const [salvandoProduto, setSalvandoProduto] = useState(false);

  // Salvos
  const [produtos, setProdutos] = useState<Produto[]>([]);

  // Catálogo de ingredientes
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [modalCatalogo, setModalCatalogo] = useState(false);
  const [idxAtual, setIdxAtual] = useState(0);
  const [buscaCatalogo, setBuscaCatalogo] = useState("");
  const [novoNomeCat, setNovoNomeCat] = useState("");
  const [novoUnidCat, setNovoUnidCat] = useState("kg");
  const [novoCustoCat, setNovoCustoCat] = useState("");

  const loadConfig = useCallback(() => {
    const db = getDB();
    const row = db.getFirstSync<Config>(
      "SELECT * FROM configuracoes_empresa WHERE empresa_id = ?", [empresaId]
    );
    if (row) setConfig(row);
  }, [empresaId]);

  const loadProdutos = useCallback(() => {
    const rows = getDB().getAllSync<Produto>(
      "SELECT p.*, (SELECT COUNT(*) FROM produto_ingredientes WHERE produto_id = p.id) as qtd_ing FROM produtos p WHERE p.empresa_id = ? ORDER BY p.criado_at DESC",
      [empresaId]
    );
    setProdutos(rows);
  }, [empresaId]);

  const loadCatalogo = useCallback(() => {
    const rows = getDB().getAllSync<CatalogoItem>(
      "SELECT * FROM catalogo_ingredientes ORDER BY nome", []
    );
    setCatalogo(rows);
  }, []);

  useFocusEffect(useCallback(() => {
    loadConfig(); loadProdutos(); loadCatalogo();
  }, [loadConfig, loadProdutos, loadCatalogo]));

  // ── Cálculo ─────────────────────────────────────────────────────────────────
  const custoIngredientes = ingredientes.reduce((acc, i) => {
    const qtd = parseFloat(i.quantidade) || 0;
    const custo = parseFloat(i.custo_unitario) || 0;
    return acc + qtd * custo;
  }, 0);

  const custoComPerda = custoIngredientes * (1 + config.perda_percentual / 100);

  const custoMaoObra = config.num_funcionarios > 0
    ? (config.salario_medio * config.num_funcionarios) / config.horas_mes / 60
    : 0;

  const custoTotal = custoComPerda + custoMaoObra;

  const taxaImposto = config.aliquota_imposto / 100;
  const taxaCartao = usarCartao ? config.taxa_cartao / 100 : 0;
  const taxaDelivery = usarDelivery ? config.taxa_delivery / 100 : 0;
  const margem = config.margem_lucro / 100;

  const divisor = 1 - taxaImposto - taxaCartao - taxaDelivery - margem;
  const precoSugerido = divisor > 0 ? custoTotal / divisor : 0;
  const lucroLiquido = precoSugerido * margem;

  // ── Ingredientes ─────────────────────────────────────────────────────────────
  function addIngrediente() {
    setIngredientes([...ingredientes, { nome: "", quantidade: "", unidade: "kg", custo_unitario: "" }]);
  }

  function removeIngrediente(idx: number) {
    if (ingredientes.length === 1) return;
    setIngredientes(ingredientes.filter((_, i) => i !== idx));
  }

  function updateIngrediente(idx: number, field: keyof Ingrediente, value: string) {
    setIngredientes(ingredientes.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  function abrirCatalogo(idx: number) {
    setIdxAtual(idx);
    setBuscaCatalogo("");
    setModalCatalogo(true);
  }

  function selecionarDoCatalogo(item: CatalogoItem) {
    setIngredientes(ingredientes.map((ing, i) =>
      i === idxAtual ? { ...ing, nome: item.nome, unidade: item.unidade, custo_unitario: String(item.custo_unitario) } : ing
    ));
    setModalCatalogo(false);
  }

  function salvarNoCatalogo() {
    if (!novoNomeCat.trim() || !novoCustoCat) return;
    getDB().runSync(
      "INSERT OR REPLACE INTO catalogo_ingredientes (nome, unidade, custo_unitario) VALUES (?, ?, ?)",
      [novoNomeCat.trim(), novoUnidCat, parseFloat(novoCustoCat)]
    );
    setNovoNomeCat(""); setNovoCustoCat(""); setNovoUnidCat("kg");
    loadCatalogo();
  }

  function deletarCatalogo(item: CatalogoItem) {
    Alert.alert("Excluir", `Remover "${item.nome}" do catálogo?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => { getDB().runSync("DELETE FROM catalogo_ingredientes WHERE id = ?", [item.id]); loadCatalogo(); } },
    ]);
  }

  // ── Salvar produto ───────────────────────────────────────────────────────────
  function salvarProduto() {
    if (!nomeProduto.trim()) { Alert.alert("Atenção", "Digite o nome do produto."); return; }
    setSalvandoProduto(true);
    const db = getDB();
    db.runSync(
      "INSERT INTO produtos (empresa_id, nome, categoria, preco_venda) VALUES (?, ?, ?, ?)",
      [empresaId, nomeProduto.trim(), categoria.trim(), precoSugerido]
    );
    const prodId = db.getFirstSync<{ id: number }>("SELECT last_insert_rowid() as id")!.id;
    for (const ing of ingredientes) {
      if (!ing.nome.trim()) continue;
      db.runSync(
        "INSERT INTO produto_ingredientes (produto_id, nome, quantidade, unidade, custo_unitario) VALUES (?, ?, ?, ?, ?)",
        [prodId, ing.nome, parseFloat(ing.quantidade) || 0, ing.unidade, parseFloat(ing.custo_unitario) || 0]
      );
    }
    setSalvandoProduto(false);
    setNomeProduto(""); setCategoria("");
    setIngredientes([{ nome: "", quantidade: "", unidade: "kg", custo_unitario: "" }]);
    loadProdutos();
    setAba("salvos");
  }

  function deletarProduto(p: Produto) {
    Alert.alert("Excluir produto", `Excluir "${p.nome}"?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => { getDB().runSync("DELETE FROM produtos WHERE id = ?", [p.id]); loadProdutos(); } },
    ]);
  }

  function salvarConfig() {
    getDB().runSync(`UPDATE configuracoes_empresa SET
      regime_tributario=?, aliquota_imposto=?, taxa_cartao=?, taxa_delivery=?,
      margem_lucro=?, num_funcionarios=?, salario_medio=?, horas_mes=?, perda_percentual=?
      WHERE empresa_id=?`,
      [config.regime_tributario, config.aliquota_imposto, config.taxa_cartao, config.taxa_delivery,
       config.margem_lucro, config.num_funcionarios, config.salario_medio, config.horas_mes,
       config.perda_percentual, empresaId]
    );
    Alert.alert("✅ Configurações salvas!");
  }

  const catalogoFiltrado = catalogo.filter(i => i.nome.toLowerCase().includes(buscaCatalogo.toLowerCase()));

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>🧮 Precificação</Text>
      </View>

      {/* Abas */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.abaBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
        {([["calcular", "🧮 Calcular"], ["salvos", `💾 Salvos (${produtos.length})`], ["ingredientes", "📋 Ingredientes"], ["config", "⚙️ Config"]] as const).map(([key, label]) => (
          <TouchableOpacity key={key} onPress={() => setAba(key)}
            style={[s.abaBtn, aba === key && s.abaBtnActive]}>
            <Text style={[s.abaBtnText, aba === key && s.abaBtnTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>

          {/* ── ABA CALCULAR ── */}
          {aba === "calcular" && (
            <>
              {/* Resultado */}
              <View style={s.resultCard}>
                <View style={{ flex: 1 }}>
                  <Text style={s.resultLabel}>Preço sugerido</Text>
                  <Text style={s.resultPreco}>{fmt(precoSugerido)}</Text>
                  <Text style={s.resultSub}>Custo: {fmt(custoTotal)} · Lucro: {fmt(lucroLiquido)}</Text>
                </View>
              </View>

              {/* Nome do produto */}
              <View style={s.card}>
                <Text style={s.cardTitle}>Produto</Text>
                <TextInput style={s.input} value={nomeProduto} onChangeText={setNomeProduto} placeholder="Nome do produto" placeholderTextColor={C.TEXT_MUTED} />
                <TextInput style={[s.input, { marginTop: 8 }]} value={categoria} onChangeText={setCategoria} placeholder="Categoria (opcional)" placeholderTextColor={C.TEXT_MUTED} />
              </View>

              {/* Ingredientes */}
              <View style={s.card}>
                <Text style={s.cardTitle}>Ingredientes / Insumos</Text>
                {ingredientes.map((ing, idx) => (
                  <View key={idx} style={s.ingRow}>
                    <View style={{ flexDirection: "row", gap: 6, marginBottom: 6 }}>
                      <TextInput
                        style={[s.input, { flex: 1 }]}
                        value={ing.nome} onChangeText={(v) => updateIngrediente(idx, "nome", v)}
                        placeholder="Nome do ingrediente" placeholderTextColor={C.TEXT_MUTED}
                      />
                      <TouchableOpacity style={s.btnCatalogo} onPress={() => abrirCatalogo(idx)}>
                        <Text style={{ fontSize: 16 }}>📋</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <TextInput style={[s.input, { flex: 1 }]} value={ing.quantidade} onChangeText={(v) => updateIngrediente(idx, "quantidade", v)}
                        placeholder="Qtd" placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />
                      <View style={s.unidSelect}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          {UNIDADES.map((u) => (
                            <TouchableOpacity key={u} onPress={() => updateIngrediente(idx, "unidade", u)}
                              style={[s.unidBtn, ing.unidade === u && s.unidBtnActive]}>
                              <Text style={[s.unidText, ing.unidade === u && { color: "#fff" }]}>{u}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", gap: 6, marginTop: 6, alignItems: "center" }}>
                      <TextInput style={[s.input, { flex: 1 }]} value={ing.custo_unitario} onChangeText={(v) => updateIngrediente(idx, "custo_unitario", v)}
                        placeholder={`R$/por ${ing.unidade}`} placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />
                      <Text style={s.ingSubTotal}>{fmt((parseFloat(ing.quantidade) || 0) * (parseFloat(ing.custo_unitario) || 0))}</Text>
                      <TouchableOpacity onPress={() => removeIngrediente(idx)} style={s.btnRemover}>
                        <Text style={{ color: C.DANGER }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    {idx < ingredientes.length - 1 && <View style={s.divider} />}
                  </View>
                ))}
                <TouchableOpacity style={s.btnAddIng} onPress={addIngrediente}>
                  <Text style={s.btnAddIngText}>+ Adicionar ingrediente</Text>
                </TouchableOpacity>
              </View>

              {/* Toggles */}
              <View style={s.card}>
                <Text style={s.cardTitle}>Taxas aplicadas</Text>
                <Toggle label={`Cartão (${config.taxa_cartao}%)`} value={usarCartao} onToggle={() => setUsarCartao(!usarCartao)} />
                <Toggle label={`Delivery (${config.taxa_delivery}%)`} value={usarDelivery} onToggle={() => setUsarDelivery(!usarDelivery)} />
              </View>

              {/* Breakdown */}
              <View style={s.card}>
                <Text style={s.cardTitle}>Composição do preço</Text>
                {[
                  ["Custo ingredientes", fmt(custoIngredientes)],
                  [`Perda (${config.perda_percentual}%)`, fmt(custoComPerda - custoIngredientes)],
                  ["Mão de obra", fmt(custoMaoObra)],
                  [`Impostos (${config.aliquota_imposto}%)`, fmt(precoSugerido * taxaImposto)],
                  usarCartao ? [`Cartão (${config.taxa_cartao}%)`, fmt(precoSugerido * taxaCartao)] : null,
                  usarDelivery ? [`Delivery (${config.taxa_delivery}%)`, fmt(precoSugerido * taxaDelivery)] : null,
                  [`Lucro (${config.margem_lucro}%)`, fmt(lucroLiquido)],
                ].filter(Boolean).map(([label, value], i) => (
                  <View key={i} style={s.breakRow}>
                    <Text style={s.breakLabel}>{label}</Text>
                    <Text style={s.breakValue}>{value}</Text>
                  </View>
                ))}
                <View style={[s.breakRow, s.breakTotal]}>
                  <Text style={s.breakTotalLabel}>Preço final</Text>
                  <Text style={s.breakTotalValue}>{fmt(precoSugerido)}</Text>
                </View>
              </View>

              <TouchableOpacity style={[s.btnSalvar, salvandoProduto && { opacity: 0.6 }]}
                onPress={salvarProduto} disabled={salvandoProduto}>
                <Text style={s.btnSalvarText}>💾 Salvar produto</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── ABA SALVOS ── */}
          {aba === "salvos" && (
            <>
              {produtos.length === 0 ? (
                <View style={s.empty}>
                  <Text style={s.emptyEmoji}>💾</Text>
                  <Text style={s.emptyText}>Nenhum produto salvo ainda</Text>
                </View>
              ) : (
                produtos.map((p) => (
                  <View key={p.id} style={s.prodCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.prodNome}>{p.nome}</Text>
                      {p.categoria ? <Text style={s.prodCat}>{p.categoria}</Text> : null}
                    </View>
                    <Text style={s.prodPreco}>{fmt(p.preco_venda)}</Text>
                    <TouchableOpacity onPress={() => deletarProduto(p)} style={{ padding: 8 }}>
                      <Text style={{ color: C.DANGER, fontSize: 16 }}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </>
          )}

          {/* ── ABA INGREDIENTES ── */}
          {aba === "ingredientes" && (
            <>
              <View style={s.card}>
                <Text style={s.cardTitle}>Adicionar ao catálogo</Text>
                <TextInput style={s.input} value={novoNomeCat} onChangeText={setNovoNomeCat} placeholder="Nome do ingrediente" placeholderTextColor={C.TEXT_MUTED} />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <TextInput style={[s.input, { flex: 1 }]} value={novoCustoCat} onChangeText={setNovoCustoCat}
                    placeholder="Custo por unidade (R$)" placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />
                  <View style={s.unidSelect}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {UNIDADES.map((u) => (
                        <TouchableOpacity key={u} onPress={() => setNovoUnidCat(u)}
                          style={[s.unidBtn, novoUnidCat === u && s.unidBtnActive]}>
                          <Text style={[s.unidText, novoUnidCat === u && { color: "#fff" }]}>{u}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>
                <TouchableOpacity style={[s.btnSalvar, { marginTop: 12 }]} onPress={salvarNoCatalogo}>
                  <Text style={s.btnSalvarText}>+ Salvar no catálogo</Text>
                </TouchableOpacity>
              </View>

              {catalogo.length === 0 ? (
                <View style={s.empty}><Text style={s.emptyText}>Catálogo vazio</Text></View>
              ) : (
                catalogo.map((item) => (
                  <View key={item.id} style={s.prodCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.prodNome}>{item.nome}</Text>
                      <Text style={s.prodCat}>{item.unidade}</Text>
                    </View>
                    <Text style={s.prodPreco}>{fmt(item.custo_unitario)}/{item.unidade}</Text>
                    <TouchableOpacity onPress={() => deletarCatalogo(item)} style={{ padding: 8 }}>
                      <Text style={{ color: C.DANGER, fontSize: 16 }}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </>
          )}

          {/* ── ABA CONFIG ── */}
          {aba === "config" && (
            <>
              <ConfigField label="Margem de lucro (%)" value={String(config.margem_lucro)}
                onChange={(v) => setConfig({ ...config, margem_lucro: parseFloat(v) || 0 })} />
              <ConfigField label="Alíquota de imposto (%)" value={String(config.aliquota_imposto)}
                onChange={(v) => setConfig({ ...config, aliquota_imposto: parseFloat(v) || 0 })} />
              <ConfigField label="Taxa cartão (%)" value={String(config.taxa_cartao)}
                onChange={(v) => setConfig({ ...config, taxa_cartao: parseFloat(v) || 0 })} />
              <ConfigField label="Taxa delivery (%)" value={String(config.taxa_delivery)}
                onChange={(v) => setConfig({ ...config, taxa_delivery: parseFloat(v) || 0 })} />
              <ConfigField label="Perda de ingredientes (%)" value={String(config.perda_percentual)}
                onChange={(v) => setConfig({ ...config, perda_percentual: parseFloat(v) || 0 })} />
              <ConfigField label="Nº de funcionários" value={String(config.num_funcionarios)}
                onChange={(v) => setConfig({ ...config, num_funcionarios: parseInt(v) || 0 })} />
              <ConfigField label="Salário médio (R$)" value={String(config.salario_medio)}
                onChange={(v) => setConfig({ ...config, salario_medio: parseFloat(v) || 0 })} />
              <ConfigField label="Horas trabalhadas/mês" value={String(config.horas_mes)}
                onChange={(v) => setConfig({ ...config, horas_mes: parseFloat(v) || 0 })} />
              <TouchableOpacity style={s.btnSalvar} onPress={salvarConfig}>
                <Text style={s.btnSalvarText}>💾 Salvar configurações</Text>
              </TouchableOpacity>
            </>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal catálogo */}
      <Modal visible={modalCatalogo} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalCatalogo(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
          <View style={[s.header, { paddingHorizontal: 16 }]}>
            <Text style={s.headerTitle}>📋 Catálogo</Text>
            <TouchableOpacity onPress={() => setModalCatalogo(false)}>
              <Text style={{ fontSize: 20, color: C.TEXT_MUTED }}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={{ padding: 16 }}>
            <TextInput style={s.input} value={buscaCatalogo} onChangeText={setBuscaCatalogo}
              placeholder="Buscar ingrediente..." placeholderTextColor={C.TEXT_MUTED} />
          </View>
          <FlatList
            data={catalogoFiltrado}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            ListEmptyComponent={<Text style={[s.emptyText, { textAlign: "center", marginTop: 40 }]}>Nenhum item no catálogo</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.prodCard} onPress={() => selecionarDoCatalogo(item)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.prodNome}>{item.nome}</Text>
                  <Text style={s.prodCat}>{item.unidade}</Text>
                </View>
                <Text style={s.prodPreco}>{fmt(item.custo_unitario)}/{item.unidade}</Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Toggle({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity style={s.toggleRow} onPress={onToggle} activeOpacity={0.8}>
      <Text style={s.toggleLabel}>{label}</Text>
      <View style={[s.toggleTrack, value && s.toggleTrackOn]}>
        <View style={[s.toggleThumb, value && s.toggleThumbOn]} />
      </View>
    </TouchableOpacity>
  );
}

function ConfigField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={s.card}>
      <Text style={s.configLabel}>{label}</Text>
      <TextInput style={s.input} value={value} onChangeText={onChange}
        keyboardType="decimal-pad" placeholderTextColor={C.TEXT_MUTED} />
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  backBtn: { padding: 4, marginRight: 8 },
  backText: { fontSize: 28, color: C.BRAND, lineHeight: 28 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: C.TEXT, flex: 1 },
  abaBar: { backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  abaBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: C.BG },
  abaBtnActive: { backgroundColor: C.BRAND },
  abaBtnText: { fontSize: 13, fontWeight: "600", color: C.TEXT_MUTED },
  abaBtnTextActive: { color: "#fff" },
  card: { backgroundColor: C.CARD, borderRadius: 16, padding: 16, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  cardTitle: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  resultCard: { backgroundColor: C.BRAND, borderRadius: 20, padding: 20, flexDirection: "row", alignItems: "center" },
  resultLabel: { fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: "600" },
  resultPreco: { fontSize: 36, fontWeight: "900", color: "#fff", marginVertical: 2 },
  resultSub: { fontSize: 13, color: "rgba(255,255,255,0.7)" },
  input: { backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.TEXT },
  ingRow: { marginBottom: 4 },
  divider: { height: 1, backgroundColor: C.BORDER, marginVertical: 12 },
  ingSubTotal: { fontSize: 13, fontWeight: "700", color: C.SUCCESS, minWidth: 70, textAlign: "right" },
  btnCatalogo: { backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, width: 40, alignItems: "center", justifyContent: "center" },
  btnRemover: { padding: 4 },
  unidSelect: { height: 38 },
  unidBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, marginRight: 4, height: 36, justifyContent: "center" },
  unidBtnActive: { backgroundColor: C.BRAND, borderColor: C.BRAND },
  unidText: { fontSize: 12, color: C.TEXT_MUTED, fontWeight: "600" },
  btnAddIng: { marginTop: 12, borderStyle: "dashed", borderWidth: 1.5, borderColor: C.BRAND, borderRadius: 10, padding: 10, alignItems: "center" },
  btnAddIngText: { color: C.BRAND, fontWeight: "700", fontSize: 14 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  toggleLabel: { fontSize: 14, color: C.TEXT, fontWeight: "600" },
  toggleTrack: { width: 44, height: 24, borderRadius: 12, backgroundColor: C.BORDER, padding: 2 },
  toggleTrackOn: { backgroundColor: C.BRAND },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 2, elevation: 2 },
  toggleThumbOn: { transform: [{ translateX: 20 }] },
  breakRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  breakLabel: { fontSize: 13, color: C.TEXT_MUTED },
  breakValue: { fontSize: 13, fontWeight: "700", color: C.TEXT },
  breakTotal: { borderBottomWidth: 0, marginTop: 4, paddingTop: 8, borderTopWidth: 2, borderTopColor: C.BRAND },
  breakTotalLabel: { fontSize: 15, fontWeight: "800", color: C.TEXT },
  breakTotalValue: { fontSize: 15, fontWeight: "900", color: C.BRAND },
  btnSalvar: { backgroundColor: C.BRAND, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  btnSalvarText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  prodCard: { backgroundColor: C.CARD, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: C.BORDER },
  prodNome: { fontSize: 15, fontWeight: "700", color: C.TEXT },
  prodCat: { fontSize: 12, color: C.TEXT_MUTED, marginTop: 2 },
  prodPreco: { fontSize: 15, fontWeight: "800", color: C.SUCCESS },
  configLabel: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, marginBottom: 8 },
  empty: { alignItems: "center", padding: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: C.TEXT_MUTED },
});
