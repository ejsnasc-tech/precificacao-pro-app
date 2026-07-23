import { useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  Alert, Modal, FlatList, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDB } from "@/lib/db";
import * as C from "@/constants/colors";

// ── Tipos ────────────────────────────────────────────────────────────────────

interface Config {
  regime: string; anexo: string; aliquota_custom: number;
  taxa_debito: number; taxa_credito: number; taxa_pix: number; taxa_dinheiro: number;
  funcionarios_custo: number; funcionarios_qtd: number; perdas_pct: number;
}
interface GastoItem { id: number; nome: string; valor: number; }
interface Cargo { id: number; nome: string; tipo: "clt" | "pj" | "informal"; salario: number; quantidade: number; }

// Encargos CLT sobre salário bruto: 13º (8.33%) + férias+1/3 (11.11%) + FGTS (8%) + INSS patronal (20%) + RAT (2%) + Sistema S (5.8%)
const ENCARGOS_CLT = 0.5524;
function custoRealCargo(cargo: Cargo): number {
  const base = cargo.salario * cargo.quantidade;
  return cargo.tipo === "clt" ? base * (1 + ENCARGOS_CLT) : base;
}
interface Ingrediente { localId: number; nome: string; quantidade: number; unidade: string; custo_por_unidade: number; }
interface IngDB { id: number; nome: string; quantidade: number; unidade: string; custo_por_unidade: number; }
interface Produto { id: number; nome: string; margem: number; }
interface CatalogoItem { id: number; empresa_id: number; nome: string; unidade: string; custo_por_unidade: number; }

type Aba = "form" | "lista" | "ingredientes" | "config";
type ModoCalc = "margem" | "preco";

// ── Alíquotas ─────────────────────────────────────────────────────────────────

const ALIQ: Record<string, number> = {
  "simples_nacional-I": 4.0, "simples_nacional-II": 4.5, "simples_nacional-III": 6.0,
  "simples_nacional-IV": 6.0, "simples_nacional-V": 15.5, "simples_nacional-VI": 16.93,
  lucro_presumido: 13.33, lucro_real: 34, mei: 0,
};

function getAliquota(c: Config): number {
  if (c.regime === "custom") return c.aliquota_custom;
  if (c.regime === "simples_nacional") {
    if (c.anexo === "custom") return c.aliquota_custom;
    return ALIQ[`simples_nacional-${c.anexo}`] ?? 4.0;
  }
  return ALIQ[c.regime] ?? 0;
}

function getRegLabel(c: Config): string {
  if (c.regime === "mei") return "MEI (0%)";
  if (c.regime === "lucro_presumido") return "Lucro Presumido";
  if (c.regime === "lucro_real") return "Lucro Real";
  if (c.regime === "custom") return `Personalizada ${c.aliquota_custom}%`;
  return `Simples Anexo ${c.anexo}`;
}

function calcSub(ing: { quantidade: number; unidade: string; custo_por_unidade: number }): number {
  if (ing.unidade === "g" || ing.unidade === "ml")
    return (ing.custo_por_unidade / 1000) * ing.quantidade;
  return ing.custo_por_unidade * ing.quantidade;
}

interface Calculo {
  ins: number; perdas: number; func: number; gv: number; imposto: number;
  custoTotal: number; lucro: number; precoBase: number;
  debito: number; credito: number; pix: number; dinheiro: number;
}

function calcular(ings: Ingrediente[], margem: number, cfg: Config, funcVal: number, gvVal: number, perdasPct: number): Calculo {
  const ins = ings.reduce((a, i) => a + calcSub(i), 0);
  const perdas = ins * (perdasPct / 100);
  const func = funcVal;
  const gv = gvVal;
  const op = ins + perdas + func + gv;
  const aliq = getAliquota(cfg);
  const mDiv = 1 - margem / 100 - aliq / 100;
  const precoBase = mDiv > 0.01 ? op / mDiv : op * (1 + margem / 100);
  const imposto = precoBase * (aliq / 100);
  const custoTotal = op + imposto;
  const lucro = precoBase - custoTotal;
  const preco = (taxa: number) => { const d = 1 - margem / 100 - aliq / 100 - taxa / 100; return d > 0.01 ? op / d : precoBase; };
  return { ins, perdas, func, gv, imposto, custoTotal, lucro, precoBase, debito: preco(cfg.taxa_debito), credito: preco(cfg.taxa_credito), pix: preco(cfg.taxa_pix), dinheiro: preco(cfg.taxa_dinheiro) };
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const UNIDADES = ["kg", "g", "L", "ml", "un", "cx", "pc"];

// ── Componente ────────────────────────────────────────────────────────────────

export default function PrecificacaoScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const empresaId = Number(id);
  const localIdRef = useRef(0);

  const [aba, setAba] = useState<Aba>("form");
  const [config, setConfig] = useState<Config>({ regime: "simples_nacional", anexo: "I", aliquota_custom: 6, taxa_debito: 2, taxa_credito: 3.5, taxa_pix: 0, taxa_dinheiro: 0, funcionarios_custo: 0, funcionarios_qtd: 100, perdas_pct: 5 });
  const [cfgForm, setCfgForm] = useState<Config>(config);
  const [gastos, setGastos] = useState<GastoItem[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [modalCargo, setModalCargo] = useState(false);
  const [cargoForm, setCargoForm] = useState<{ nome: string; tipo: "clt" | "pj" | "informal"; salario: string; quantidade: string }>({ nome: "", tipo: "clt", salario: "", quantidade: "1" });
  const [cargoEditando, setCargoEditando] = useState<Cargo | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);

  // Formulário de produto
  const [nomeProd, setNomeProd] = useState("");
  const [margem, setMargem] = useState("30");
  const [modoCalc, setModoCalc] = useState<ModoCalc>("margem");
  const [precoVenda, setPrecoVenda] = useState("");
  const [ings, setIngs] = useState<Ingrediente[]>([]);
  const [editandoProduto, setEditandoProduto] = useState<Produto | null>(null);
  const [overFunc, setOverFunc] = useState("");
  const [overGv, setOverGv] = useState("");
  const [overPerdas, setOverPerdas] = useState("5");

  // Novo ingrediente
  const [iNome, setINome] = useState("");
  const [iCusto, setICusto] = useState("");
  const [iQtd, setIQtd] = useState("");
  const [iUn, setIUn] = useState("kg");
  const [sugestoes, setSugestoes] = useState<CatalogoItem[]>([]);
  const [showSug, setShowSug] = useState(false);

  // Detalhes de produto salvo
  const [prodDetail, setProdDetail] = useState<{ id: number; nome: string; margem: number; ingredientes: IngDB[] } | null>(null);

  // Config
  const [novoGasto, setNovoGasto] = useState({ nome: "", valor: "" });
  const [novoCat, setNovoCat] = useState({ nome: "", unidade: "kg", custo_por_unidade: "" });
  const [editandoCat, setEditandoCat] = useState<CatalogoItem | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(() => {
    const db = getDB();
    const c = db.getFirstSync<Config>("SELECT * FROM configuracoes_empresa WHERE empresa_id = ?", [empresaId]);
    const g = db.getAllSync<GastoItem>("SELECT * FROM gastos_variaveis WHERE empresa_id = ? ORDER BY nome", [empresaId]);
    const cs = db.getAllSync<Cargo>("SELECT * FROM cargos_funcionarios WHERE empresa_id = ? ORDER BY nome", [empresaId]);
    setCargos(cs);
    if (c) {
      const custoFunc = cs.reduce((a, cargo) => a + custoRealCargo(cargo), 0);
      const cAtual = { ...c, funcionarios_custo: custoFunc };
      setConfig(cAtual); setCfgForm(cAtual);
      syncOverrides(cAtual, g);
    }
    setGastos(g);
    setCatalogo(db.getAllSync<CatalogoItem>("SELECT * FROM catalogo_ingredientes WHERE empresa_id = ? ORDER BY nome", [empresaId]));
    setProdutos(db.getAllSync<Produto>("SELECT * FROM produtos WHERE empresa_id = ? ORDER BY criado_at DESC", [empresaId]));
  }, [empresaId]);

  function syncOverrides(c: Config, g: GastoItem[]) {
    const fp = c.funcionarios_qtd > 0 ? c.funcionarios_custo / c.funcionarios_qtd : 0;
    setOverFunc(fp > 0 ? fp.toFixed(2) : "");
    setOverPerdas(String(c.perdas_pct));
    const totalGv = g.reduce((a, x) => a + x.valor, 0);
    const gvPP = c.funcionarios_qtd > 0 ? totalGv / c.funcionarios_qtd : 0;
    setOverGv(gvPP > 0 ? gvPP.toFixed(2) : "");
  }

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Cálculo ───────────────────────────────────────────────────────────────

  const aliq = getAliquota(config);
  const gastosMensal = gastos.reduce((a, g) => a + g.valor, 0);
  const gastosPorProduto = config.funcionarios_qtd > 0 ? gastosMensal / config.funcionarios_qtd : 0;
  const funcPorProd = config.funcionarios_qtd > 0 ? config.funcionarios_custo / config.funcionarios_qtd : 0;

  const opBase = (() => {
    const ins = ings.reduce((a, i) => a + calcSub(i), 0);
    const perdas = ins * ((parseFloat(overPerdas) || 0) / 100);
    return ins + perdas + (parseFloat(overFunc) || 0) + (parseFloat(overGv) || 0);
  })();

  const margemEfetiva = (() => {
    if (modoCalc === "preco") {
      const pv = parseFloat(precoVenda) || 0;
      if (pv > 0 && opBase > 0) return Math.max(-999, (1 - aliq / 100 - opBase / pv) * 100);
      return 0;
    }
    return parseFloat(margem) || 0;
  })();

  const calc = calcular(ings, margemEfetiva, config, parseFloat(overFunc) || 0, parseFloat(overGv) || 0, parseFloat(overPerdas) || 0);

  // ── Ingrediente ───────────────────────────────────────────────────────────

  function addIng() {
    if (!iNome.trim() || !iCusto || !iQtd) {
      Alert.alert("Preencha nome, custo e quantidade.");
      return;
    }
    setIngs(prev => [...prev, { localId: localIdRef.current++, nome: iNome.trim(), custo_por_unidade: parseFloat(iCusto), quantidade: parseFloat(iQtd), unidade: iUn }]);
    setINome(""); setICusto(""); setIQtd(""); setShowSug(false);
  }

  function removeIng(localId: number) { setIngs(prev => prev.filter(i => i.localId !== localId)); }

  function selecionarSugestao(item: CatalogoItem) {
    setINome(item.nome); setICusto(String(item.custo_por_unidade)); setIUn(item.unidade);
    setShowSug(false);
  }

  // ── Salvar produto ────────────────────────────────────────────────────────

  function salvarProduto() {
    if (!nomeProd.trim()) { Alert.alert("Digite o nome do produto."); return; }
    const db = getDB();
    const mg = Math.round(margemEfetiva * 10) / 10;
    if (editandoProduto) {
      db.runSync("UPDATE produtos SET nome = ?, margem = ? WHERE id = ?", [nomeProd.trim(), mg, editandoProduto.id]);
      db.runSync("DELETE FROM produto_ingredientes WHERE produto_id = ?", [editandoProduto.id]);
      for (const i of ings) db.runSync("INSERT INTO produto_ingredientes (produto_id, nome, quantidade, unidade, custo_por_unidade) VALUES (?, ?, ?, ?, ?)", [editandoProduto.id, i.nome, i.quantidade, i.unidade, i.custo_por_unidade]);
    } else {
      db.runSync("INSERT INTO produtos (empresa_id, nome, margem) VALUES (?, ?, ?)", [empresaId, nomeProd.trim(), mg]);
      const pid = db.getFirstSync<{ id: number }>("SELECT last_insert_rowid() as id")!.id;
      for (const i of ings) db.runSync("INSERT INTO produto_ingredientes (produto_id, nome, quantidade, unidade, custo_por_unidade) VALUES (?, ?, ?, ?, ?)", [pid, i.nome, i.quantidade, i.unidade, i.custo_por_unidade]);
    }
    limparForm(); load();
    Alert.alert("✅", editandoProduto ? "Produto atualizado!" : "Produto salvo!");
  }

  function limparForm() {
    setNomeProd(""); setIngs([]); setMargem("30"); setPrecoVenda(""); setModoCalc("margem"); setEditandoProduto(null);
  }

  function iniciarEdicao(p: Produto) {
    const db = getDB();
    const detIngredientes = db.getAllSync<IngDB>("SELECT * FROM produto_ingredientes WHERE produto_id = ?", [p.id]);
    setEditandoProduto(p); setNomeProd(p.nome); setMargem(String(p.margem));
    setModoCalc("margem"); setPrecoVenda("");
    setIngs(detIngredientes.map(i => ({ ...i, localId: localIdRef.current++ })));
    setAba("form");
  }

  function deletarProduto(p: Produto) {
    Alert.alert("Excluir produto?", p.nome, [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => { getDB().runSync("DELETE FROM produtos WHERE id = ?", [p.id]); if (prodDetail?.id === p.id) setProdDetail(null); load(); } },
    ]);
  }

  function loadProdDetail(p: Produto) {
    const ing = getDB().getAllSync<IngDB>("SELECT * FROM produto_ingredientes WHERE produto_id = ?", [p.id]);
    setProdDetail({ ...p, ingredientes: ing });
  }

  // ── Cargos ───────────────────────────────────────────────────────────────

  function abrirModalCargo(cargo?: Cargo) {
    if (cargo) {
      setCargoEditando(cargo);
      setCargoForm({ nome: cargo.nome, tipo: cargo.tipo, salario: String(cargo.salario), quantidade: String(cargo.quantidade) });
    } else {
      setCargoEditando(null);
      setCargoForm({ nome: "", tipo: "clt", salario: "", quantidade: "1" });
    }
    setModalCargo(true);
  }

  function salvarCargo() {
    const sal = parseFloat(cargoForm.salario) || 0;
    const qtd = parseInt(cargoForm.quantidade) || 1;
    if (!cargoForm.nome.trim() || sal <= 0) { Alert.alert("Atenção", "Informe o cargo e o salário."); return; }
    const db = getDB();
    if (cargoEditando) {
      db.runSync("UPDATE cargos_funcionarios SET nome=?, tipo=?, salario=?, quantidade=? WHERE id=?",
        [cargoForm.nome.trim(), cargoForm.tipo, sal, qtd, cargoEditando.id]);
    } else {
      db.runSync("INSERT INTO cargos_funcionarios (empresa_id, nome, tipo, salario, quantidade) VALUES (?, ?, ?, ?, ?)",
        [empresaId, cargoForm.nome.trim(), cargoForm.tipo, sal, qtd]);
    }
    setModalCargo(false);
    load();
  }

  function deletarCargo(cargo: Cargo) {
    Alert.alert("Remover cargo?", cargo.nome, [
      { text: "Cancelar", style: "cancel" },
      { text: "Remover", style: "destructive", onPress: () => { getDB().runSync("DELETE FROM cargos_funcionarios WHERE id=?", [cargo.id]); load(); } },
    ]);
  }

  // ── Config ────────────────────────────────────────────────────────────────

  function salvarConfig() {
    getDB().runSync(`UPDATE configuracoes_empresa SET regime=?,anexo=?,aliquota_custom=?,taxa_debito=?,taxa_credito=?,taxa_pix=?,taxa_dinheiro=?,funcionarios_custo=?,funcionarios_qtd=?,perdas_pct=? WHERE empresa_id=?`,
      [cfgForm.regime, cfgForm.anexo, cfgForm.aliquota_custom, cfgForm.taxa_debito, cfgForm.taxa_credito, cfgForm.taxa_pix, cfgForm.taxa_dinheiro, cfgForm.funcionarios_custo, cfgForm.funcionarios_qtd, cfgForm.perdas_pct, empresaId]);
    setConfig(cfgForm);
    syncOverrides(cfgForm, gastos);
    Alert.alert("✅ Configurações salvas!");
  }

  function addGasto() {
    if (!novoGasto.nome.trim() || !novoGasto.valor) return;
    getDB().runSync("INSERT INTO gastos_variaveis (empresa_id, nome, valor) VALUES (?, ?, ?)", [empresaId, novoGasto.nome.trim(), parseFloat(novoGasto.valor)]);
    setNovoGasto({ nome: "", valor: "" }); load();
  }

  function deletarGasto(g: GastoItem) {
    getDB().runSync("DELETE FROM gastos_variaveis WHERE id = ?", [g.id]);
    load();
  }

  function addCatalogo() {
    if (!novoCat.nome.trim() || !novoCat.custo_por_unidade) return;
    getDB().runSync("INSERT INTO catalogo_ingredientes (empresa_id, nome, unidade, custo_por_unidade) VALUES (?, ?, ?, ?)",
      [empresaId, novoCat.nome.trim(), novoCat.unidade, parseFloat(novoCat.custo_por_unidade)]);
    setNovoCat({ nome: "", unidade: "kg", custo_por_unidade: "" }); load();
  }

  function salvarEdicaoCatalogo() {
    if (!editandoCat) return;
    getDB().runSync("UPDATE catalogo_ingredientes SET nome=?, unidade=?, custo_por_unidade=? WHERE id=?",
      [editandoCat.nome, editandoCat.unidade, editandoCat.custo_por_unidade, editandoCat.id]);
    setEditandoCat(null); load();
  }

  function deletarCatalogo(c: CatalogoItem) {
    Alert.alert("Excluir?", c.nome, [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => { getDB().runSync("DELETE FROM catalogo_ingredientes WHERE id = ?", [c.id]); load(); } },
    ]);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>‹</Text></TouchableOpacity>
        <Text style={s.headerTitle}>🧮 Precificação</Text>
      </View>

      <View style={s.abaBar}>
        {([["form", "➕", "Novo"], ["lista", "📋", `Salvos${produtos.length ? ` (${produtos.length})` : ""}`], ["ingredientes", "🧂", "Catálogo"], ["config", "⚙️", "Config"]] as const).map(([k, emoji, label]) => (
          <TouchableOpacity key={k} onPress={() => setAba(k)} style={[s.abaBtn, aba === k && s.abaBtnActive]}>
            <Text style={{ fontSize: 16 }}>{emoji}</Text>
            <Text style={[s.abaBtnText, aba === k && s.abaBtnTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">

          {/* ── ABA: FORM ── */}
          {aba === "form" && (
            <>
              {editandoProduto && (
                <View style={s.editBanner}>
                  <Text style={s.editBannerText}>✏️ Editando: {editandoProduto.nome}</Text>
                  <TouchableOpacity onPress={limparForm}><Text style={{ color: "#b45309", fontWeight: "700", fontSize: 13 }}>Cancelar</Text></TouchableOpacity>
                </View>
              )}

              {/* Nome */}
              <View style={s.card}>
                <Text style={s.cardTitle}>📝 Nome do produto</Text>
                <TextInput style={s.input} value={nomeProd} onChangeText={setNomeProd}
                  placeholder="Ex: X-Burguer Especial" placeholderTextColor={C.TEXT_MUTED} />
              </View>

              {/* Ingredientes */}
              <View style={s.card}>
                <Text style={s.cardTitle}>🧂 Ingredientes</Text>
                <View style={[s.infoBanner]}>
                  <Text style={s.infoText}>💡 g/ml: informe o preço por kg ou litro (convertemos automaticamente) · kg/L/un: preço direto</Text>
                </View>

                {/* Campos de entrada */}
                <View style={{ gap: 8, marginBottom: 10 }}>
                  <View style={{ position: "relative" }}>
                    <TextInput style={s.input} value={iNome} onChangeText={(v) => {
                      setINome(v);
                      if (v.trim().length >= 1) {
                        setSugestoes(catalogo.filter(c => c.nome.toLowerCase().includes(v.toLowerCase())));
                        setShowSug(true);
                      } else setShowSug(false);
                    }}
                      placeholder="Nome do ingrediente" placeholderTextColor={C.TEXT_MUTED} />
                    {showSug && sugestoes.length > 0 && (
                      <View style={s.sugestoes}>
                        {sugestoes.slice(0, 5).map(sug => (
                          <TouchableOpacity key={sug.id} style={s.sugItem} onPress={() => selecionarSugestao(sug)}>
                            <Text style={s.sugNome}>{sug.nome}</Text>
                            <Text style={s.sugCusto}>{fmt(sug.custo_por_unidade)}/{sug.unidade}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TextInput style={[s.input, { flex: 1 }]} value={iCusto} onChangeText={setICusto}
                      placeholder="Custo R$" placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />
                    <TextInput style={[s.input, { flex: 1 }]} value={iQtd} onChangeText={setIQtd}
                      placeholder="Quantidade" placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {UNIDADES.map(u => (
                      <TouchableOpacity key={u} onPress={() => setIUn(u)} style={[s.unidBtn, iUn === u && s.unidBtnActive]}>
                        <Text style={[s.unidText, iUn === u && { color: "#fff" }]}>{u}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <TouchableOpacity style={s.btnAdd} onPress={addIng}>
                    <Text style={s.btnAddText}>+ Adicionar ingrediente</Text>
                  </TouchableOpacity>
                </View>

                {/* Lista de ingredientes adicionados */}
                {ings.length > 0 && (
                  <View style={{ gap: 6 }}>
                    <View style={s.tabelaHeader}>
                      <Text style={[s.tabelaCol, { flex: 2 }]}>Ingrediente</Text>
                      <Text style={[s.tabelaCol, { textAlign: "right" }]}>Custo</Text>
                      <Text style={[s.tabelaCol, { textAlign: "right" }]}>Qtd</Text>
                      <Text style={[s.tabelaCol, { textAlign: "right" }]}>Subtotal</Text>
                    </View>
                    {ings.map(i => (
                      <View key={i.localId} style={s.tabelaRow}>
                        <Text style={[s.tabelaCell, { flex: 2 }]} numberOfLines={1}>{i.nome} <Text style={{ color: C.TEXT_MUTED }}>({i.unidade})</Text></Text>
                        <Text style={s.tabelaCell}>{fmt(i.custo_por_unidade)}</Text>
                        <Text style={s.tabelaCell}>{i.quantidade}{i.unidade}</Text>
                        <Text style={[s.tabelaCell, { color: C.SUCCESS, fontWeight: "700" }]}>{fmt(calcSub(i))}</Text>
                        <TouchableOpacity onPress={() => removeIng(i.localId)} style={{ padding: 4 }}>
                          <Text style={{ color: C.DANGER, fontWeight: "700" }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Custos operacionais */}
              <View style={s.card}>
                <Text style={s.cardTitle}>🏭 Custos Operacionais</Text>
                <Text style={s.cardSub}>Sincronizados das configurações. Edite aqui para ajustar só neste produto.</Text>
                <View style={{ gap: 10 }}>
                  <OpField label="👥 Funcionários por produto (R$)" value={overFunc} onChange={setOverFunc}
                    hint={`Config: ${fmt(funcPorProd)}`} hintColor={C.SUCCESS} />
                  <OpField label="⚡ Gastos variáveis (R$/produto)" value={overGv} onChange={setOverGv}
                    hint={`Config: ${fmt(gastosPorProduto)}/prod · total ${fmt(gastosMensal)}/mês`} hintColor={C.WARNING} />
                  <OpField label="🗑️ Perdas (%)" value={overPerdas} onChange={setOverPerdas}
                    hint={`Config: ${config.perdas_pct}%`} hintColor={C.DANGER} />
                </View>
              </View>

              {/* Precificação (margem ou preço) */}
              <View style={s.card}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <Text style={s.cardTitle}>⚙️ Precificação</Text>
                  <View style={s.modoSwitch}>
                    {(["margem", "preco"] as const).map(m => (
                      <TouchableOpacity key={m} onPress={() => setModoCalc(m)} style={[s.modoBtn, modoCalc === m && s.modoBtnActive]}>
                        <Text style={[s.modoBtnText, modoCalc === m && { color: C.TEXT }]}>{m === "margem" ? "Margem %" : "Preço de venda"}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {modoCalc === "margem" ? (
                  <View>
                    <Text style={{ fontSize: 13, color: C.TEXT_MUTED, marginBottom: 8 }}>Margem: <Text style={{ fontWeight: "800", color: C.TEXT }}>{margem}%</Text></Text>
                    <TextInput style={s.input} value={margem} onChangeText={setMargem}
                      keyboardType="decimal-pad" placeholder="Ex: 30" placeholderTextColor={C.TEXT_MUTED} />
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 13, color: C.TEXT_MUTED }}>Quanto você quer vender? (R$)</Text>
                    <TextInput style={[s.input, { fontSize: 20, fontWeight: "700" }]} value={precoVenda} onChangeText={setPrecoVenda}
                      keyboardType="decimal-pad" placeholder="Ex: 25,00" placeholderTextColor={C.TEXT_MUTED} />
                    {parseFloat(precoVenda) > 0 && (
                      <View style={[s.margemBadge, { backgroundColor: margemEfetiva >= 0 ? "#dcfce7" : "#fee2e2" }]}>
                        <Text style={{ fontWeight: "700", color: margemEfetiva >= 0 ? C.SUCCESS : C.DANGER, fontSize: 13 }}>
                          {margemEfetiva >= 0 ? `✅ Margem implícita: ${margemEfetiva.toFixed(1)}%` : `⚠️ Preço abaixo do custo (${margemEfetiva.toFixed(1)}%)`}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Resultado */}
              <View style={s.card}>
                <Text style={s.cardTitle}>📊 Resultado</Text>
                {[
                  { l: "🧂 Insumos", v: calc.ins, extra: "" },
                  { l: "🗑️ Perdas", v: calc.perdas, extra: "+" },
                  { l: "👥 Funcionários", v: calc.func, extra: "+" },
                  { l: "⚡ Gastos Variáveis", v: calc.gv, extra: "+" },
                  { l: `🏛️ Imposto (${getRegLabel(config)} ${aliq.toFixed(1)}%)`, v: calc.imposto, extra: "+" },
                ].map(({ l, v, extra }) => (
                  <View key={l} style={s.breakRow}>
                    <Text style={s.breakLabel}>{l}</Text>
                    <Text style={[s.breakValue, extra === "+" && { color: C.DANGER }]}>{extra}{fmt(v)}</Text>
                  </View>
                ))}
                <View style={[s.breakRow, { borderBottomWidth: 2, borderBottomColor: C.TEXT }]}>
                  <Text style={{ fontWeight: "800", color: C.TEXT }}>📦 Custo Total</Text>
                  <Text style={{ fontWeight: "800", color: C.TEXT }}>{fmt(calc.custoTotal)}</Text>
                </View>
                <View style={s.breakRow}>
                  <Text style={{ fontWeight: "700", color: C.SUCCESS }}>💰 Lucro ({margemEfetiva.toFixed(1)}%)</Text>
                  <Text style={{ fontWeight: "800", color: C.SUCCESS }}>{fmt(calc.lucro)}</Text>
                </View>

                {/* Preço destaque */}
                <View style={[s.precoDestaque, { marginTop: 12 }]}>
                  <Text style={{ fontSize: 11, color: C.BRAND, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>💰 Preço Base de Venda</Text>
                  <Text style={{ fontSize: 38, fontWeight: "900", color: C.BRAND, marginTop: 4 }}>{fmt(calc.precoBase)}</Text>
                </View>

                {/* Por forma de pagamento */}
                <Text style={[s.cardTitle, { marginTop: 16, marginBottom: 8 }]}>💳 Por forma de pagamento</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {[
                    { l: `Débito (${config.taxa_debito}%)`, v: calc.debito },
                    { l: `Crédito (${config.taxa_credito}%)`, v: calc.credito },
                    { l: `PIX (${config.taxa_pix}%)`, v: calc.pix },
                    { l: `Dinheiro (${config.taxa_dinheiro}%)`, v: calc.dinheiro },
                  ].map(({ l, v }) => (
                    <View key={l} style={s.pagCard}>
                      <Text style={s.pagLabel}>{l}</Text>
                      <Text style={s.pagValor}>{fmt(v)}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity style={[s.btnSalvar, { marginTop: 16 }]} onPress={salvarProduto}>
                  <Text style={s.btnSalvarText}>{editandoProduto ? "💾 Salvar alterações" : "💾 Salvar produto"}</Text>
                </TouchableOpacity>
                {editandoProduto && (
                  <TouchableOpacity style={[s.btnOutline, { marginTop: 8 }]} onPress={limparForm}>
                    <Text style={s.btnOutlineText}>Cancelar edição</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

          {/* ── ABA: LISTA ── */}
          {aba === "lista" && (
            <>
              {produtos.length === 0 ? (
                <View style={s.empty}><Text style={s.emptyEmoji}>📭</Text><Text style={s.emptyText}>Nenhum produto salvo ainda</Text></View>
              ) : (
                produtos.map(p => {
                  const isOpen = prodDetail?.id === p.id;
                  const cProd = isOpen ? calcular(
                    (prodDetail.ingredientes ?? []).map(i => ({ ...i, localId: 0 })),
                    p.margem, config, funcPorProd, gastosPorProduto, config.perdas_pct
                  ) : null;
                  return (
                    <View key={p.id} style={s.prodCard}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.prodNome}>{p.nome}</Text>
                          <Text style={s.prodSub}>Margem: {p.margem}% · {getRegLabel(config)}</Text>
                        </View>
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          <TouchableOpacity style={s.btnSmall} onPress={() => isOpen ? setProdDetail(null) : loadProdDetail(p)}>
                            <Text style={s.btnSmallText}>{isOpen ? "Fechar" : "Detalhes"}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[s.btnSmall, { backgroundColor: "#fffbeb" }]} onPress={() => iniciarEdicao(p)}>
                            <Text style={[s.btnSmallText, { color: "#b45309" }]}>✏️</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[s.btnSmall, { backgroundColor: "#fff5f5" }]} onPress={() => deletarProduto(p)}>
                            <Text style={[s.btnSmallText, { color: C.DANGER }]}>🗑️</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {isOpen && cProd && (
                        <View style={{ marginTop: 12, gap: 6 }}>
                          {[
                            { l: "🧂 Insumos", v: cProd.ins }, { l: "🗑️ Perdas", v: cProd.perdas },
                            { l: "👥 Funcionários", v: cProd.func }, { l: "⚡ Gastos Var.", v: cProd.gv },
                            { l: `🏛️ Imposto ${aliq.toFixed(1)}%`, v: cProd.imposto },
                          ].map(({ l, v }) => (
                            <View key={l} style={s.breakRow}><Text style={s.breakLabel}>{l}</Text><Text style={s.breakValue}>{fmt(v)}</Text></View>
                          ))}
                          <View style={s.breakRow}><Text style={{ fontWeight: "800", color: C.TEXT }}>📦 Custo Total</Text><Text style={{ fontWeight: "800" }}>{fmt(cProd.custoTotal)}</Text></View>
                          <View style={s.breakRow}><Text style={{ fontWeight: "700", color: C.SUCCESS }}>💰 Lucro ({p.margem}%)</Text><Text style={{ fontWeight: "800", color: C.SUCCESS }}>{fmt(cProd.lucro)}</Text></View>
                          <View style={s.precoDestaque}>
                            <Text style={{ fontSize: 11, color: C.BRAND, fontWeight: "700" }}>💰 Preço Base</Text>
                            <Text style={{ fontSize: 26, fontWeight: "900", color: C.BRAND }}>{fmt(cProd.precoBase)}</Text>
                          </View>
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {[{ l: "Débito", v: cProd.debito }, { l: "Crédito", v: cProd.credito }, { l: "PIX", v: cProd.pix }, { l: "Dinheiro", v: cProd.dinheiro }].map(({ l, v }) => (
                              <View key={l} style={s.pagCard}><Text style={s.pagLabel}>{l}</Text><Text style={s.pagValor}>{fmt(v)}</Text></View>
                            ))}
                          </View>
                          {(prodDetail?.ingredientes?.length ?? 0) > 0 && (
                            <View style={{ marginTop: 8 }}>
                              <Text style={[s.cardTitle, { marginBottom: 6 }]}>🧂 Ingredientes</Text>
                              {prodDetail!.ingredientes.map(i => (
                                <View key={i.id} style={s.tabelaRow}>
                                  <Text style={[s.tabelaCell, { flex: 2 }]}>{i.nome} ({i.unidade})</Text>
                                  <Text style={s.tabelaCell}>{i.quantidade}{i.unidade}</Text>
                                  <Text style={[s.tabelaCell, { color: C.SUCCESS, fontWeight: "700" }]}>{fmt(calcSub(i))}</Text>
                                </View>
                              ))}
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </>
          )}

          {/* ── ABA: INGREDIENTES (catálogo) ── */}
          {aba === "ingredientes" && (
            <>
              <View style={s.infoBanner}>
                <Text style={s.infoText}>💡 Cadastre ingredientes com custos. Na hora de criar um produto, basta digitar o nome e os valores preenchem automaticamente.</Text>
              </View>

              <View style={s.card}>
                <Text style={s.cardTitle}>+ Novo ingrediente</Text>
                <TextInput style={s.input} value={novoCat.nome} onChangeText={v => setNovoCat({ ...novoCat, nome: v })}
                  placeholder="Nome (ex: Farinha de trigo)" placeholderTextColor={C.TEXT_MUTED} />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <TextInput style={[s.input, { flex: 1 }]} value={novoCat.custo_por_unidade} onChangeText={v => setNovoCat({ ...novoCat, custo_por_unidade: v })}
                    placeholder="Custo R$" placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {UNIDADES.map(u => (
                      <TouchableOpacity key={u} onPress={() => setNovoCat({ ...novoCat, unidade: u })} style={[s.unidBtn, novoCat.unidade === u && s.unidBtnActive]}>
                        <Text style={[s.unidText, novoCat.unidade === u && { color: "#fff" }]}>{u}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
                <TouchableOpacity style={[s.btnSalvar, { marginTop: 12 }]} onPress={addCatalogo}>
                  <Text style={s.btnSalvarText}>+ Adicionar ao catálogo</Text>
                </TouchableOpacity>
              </View>

              {catalogo.length === 0 ? (
                <View style={s.empty}><Text style={s.emptyEmoji}>🧂</Text><Text style={s.emptyText}>Nenhum ingrediente cadastrado</Text></View>
              ) : (
                catalogo.map(c => (
                  <View key={c.id} style={s.prodCard}>
                    {editandoCat?.id === c.id ? (
                      <View style={{ gap: 8 }}>
                        <TextInput style={s.input} value={editandoCat.nome} onChangeText={v => setEditandoCat({ ...editandoCat, nome: v })} />
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TextInput style={[s.input, { flex: 1 }]} value={String(editandoCat.custo_por_unidade)}
                            onChangeText={v => setEditandoCat({ ...editandoCat, custo_por_unidade: parseFloat(v) || 0 })} keyboardType="decimal-pad" />
                          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                            {UNIDADES.map(u => (
                              <TouchableOpacity key={u} onPress={() => setEditandoCat({ ...editandoCat, unidade: u })} style={[s.unidBtn, editandoCat.unidade === u && s.unidBtnActive]}>
                                <Text style={[s.unidText, editandoCat.unidade === u && { color: "#fff" }]}>{u}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TouchableOpacity style={[s.btnSalvar, { flex: 1 }]} onPress={salvarEdicaoCatalogo}><Text style={s.btnSalvarText}>Salvar</Text></TouchableOpacity>
                          <TouchableOpacity style={[s.btnOutline, { flex: 1 }]} onPress={() => setEditandoCat(null)}><Text style={s.btnOutlineText}>Cancelar</Text></TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.prodNome}>{c.nome}</Text>
                          <Text style={s.prodSub}>{fmt(c.custo_por_unidade)}/{c.unidade}</Text>
                        </View>
                        <TouchableOpacity style={[s.btnSmall, { marginRight: 6 }]} onPress={() => setEditandoCat(c)}><Text style={s.btnSmallText}>✏️</Text></TouchableOpacity>
                        <TouchableOpacity style={[s.btnSmall, { backgroundColor: "#fff5f5" }]} onPress={() => deletarCatalogo(c)}><Text style={[s.btnSmallText, { color: C.DANGER }]}>✕</Text></TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))
              )}
            </>
          )}

          {/* ── ABA: CONFIG ── */}
          {aba === "config" && (
            <>
              <View style={s.infoBanner}>
                <Text style={s.infoText}>💡 Configurações exclusivas desta empresa. Aplicadas automaticamente em todos os produtos.</Text>
              </View>

              {/* Regime tributário */}
              <View style={s.card}>
                <Text style={s.cardTitle}>🏛️ Regime Tributário</Text>
                <View style={{ gap: 8 }}>
                  {[
                    { v: "simples_nacional", l: "Simples Nacional", sub: "Até R$ 4,8M/ano" },
                    { v: "lucro_presumido", l: "Lucro Presumido", sub: "Até R$ 78M/ano · ~13,33%" },
                    { v: "lucro_real", l: "Lucro Real", sub: "Sem limite · ~34%" },
                    { v: "mei", l: "MEI", sub: "Até R$ 81k/ano · 0%" },
                    { v: "custom", l: "✏️ Personalizada", sub: "Informe a alíquota" },
                  ].map(({ v, l, sub }) => (
                    <TouchableOpacity key={v} onPress={() => setCfgForm({ ...cfgForm, regime: v })}
                      style={[s.regimeBtn, cfgForm.regime === v && s.regimeBtnActive]}>
                      <Text style={[s.regimeBtnTitle, cfgForm.regime === v && { color: C.BRAND }]}>{l}</Text>
                      <Text style={s.regimeBtnSub}>{sub}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {cfgForm.regime === "simples_nacional" && (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    <Text style={s.cardTitle}>Selecione o Anexo:</Text>
                    {[
                      { v: "I", l: "Anexo I — Comércio", sub: "4,0%" },
                      { v: "II", l: "Anexo II — Indústria", sub: "4,5%" },
                      { v: "III", l: "Anexo III — Serviços", sub: "6,0%" },
                      { v: "custom", l: "✏️ Personalizada", sub: "Informe a alíquota" },
                    ].map(({ v, l, sub }) => (
                      <TouchableOpacity key={v} onPress={() => setCfgForm({ ...cfgForm, anexo: v })}
                        style={[s.regimeBtn, cfgForm.anexo === v && s.regimeBtnActive]}>
                        <Text style={[s.regimeBtnTitle, cfgForm.anexo === v && { color: C.BRAND }]}>{l}</Text>
                        <Text style={s.regimeBtnSub}>{sub}</Text>
                      </TouchableOpacity>
                    ))}
                    {cfgForm.anexo === "custom" && (
                      <CfgField label="Alíquota personalizada (%)" value={String(cfgForm.aliquota_custom)}
                        onChange={v => setCfgForm({ ...cfgForm, aliquota_custom: parseFloat(v) || 0 })} />
                    )}
                    <View style={{ backgroundColor: "#eff6ff", borderRadius: 10, padding: 10 }}>
                      <Text style={{ color: C.BRAND, fontWeight: "700", fontSize: 13 }}>
                        Alíquota: {(ALIQ[`simples_nacional-${cfgForm.anexo}`] ?? cfgForm.aliquota_custom ?? 0).toFixed(1)}%
                      </Text>
                    </View>
                  </View>
                )}
                {(cfgForm.regime === "lucro_presumido" || cfgForm.regime === "lucro_real" || cfgForm.regime === "custom") && (
                  <View style={{ marginTop: 10 }}>
                    <CfgField label="Alíquota total (%)" value={String(cfgForm.aliquota_custom)}
                      onChange={v => setCfgForm({ ...cfgForm, aliquota_custom: parseFloat(v) || 0 })} />
                  </View>
                )}
              </View>

              {/* Taxas de pagamento */}
              <View style={s.card}>
                <Text style={s.cardTitle}>💳 Taxas de Pagamento</Text>
                <Text style={s.cardSub}>Taxas cobradas por cada forma de recebimento</Text>
                <View style={{ gap: 10 }}>
                  <CfgField label="💳 Débito (%)" value={String(cfgForm.taxa_debito)} onChange={v => setCfgForm({ ...cfgForm, taxa_debito: parseFloat(v) || 0 })} />
                  <CfgField label="💳 Crédito à vista (%)" value={String(cfgForm.taxa_credito)} onChange={v => setCfgForm({ ...cfgForm, taxa_credito: parseFloat(v) || 0 })} />
                  <CfgField label="💰 PIX (%)" value={String(cfgForm.taxa_pix)} onChange={v => setCfgForm({ ...cfgForm, taxa_pix: parseFloat(v) || 0 })} />
                  <CfgField label="💵 Dinheiro (%)" value={String(cfgForm.taxa_dinheiro)} onChange={v => setCfgForm({ ...cfgForm, taxa_dinheiro: parseFloat(v) || 0 })} />
                </View>
              </View>

              {/* Funcionários */}
              <View style={s.card}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <View>
                    <Text style={s.cardTitle}>👥 Funcionários</Text>
                    <Text style={s.cardSub}>Custo real calculado automaticamente com encargos</Text>
                  </View>
                  <TouchableOpacity onPress={() => abrirModalCargo()}
                    style={{ backgroundColor: C.BRAND, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>+ Cargo</Text>
                  </TouchableOpacity>
                </View>

                {cargos.length === 0 ? (
                  <Text style={{ color: C.TEXT_MUTED, fontSize: 13, textAlign: "center", padding: 16 }}>
                    Nenhum cargo cadastrado. Adicione os cargos da sua empresa.
                  </Text>
                ) : (
                  <View style={{ gap: 8, marginBottom: 10 }}>
                    {cargos.map(cargo => {
                      const custoReal = custoRealCargo(cargo);
                      const tipoBadge = cargo.tipo === "clt" ? { label: "CLT", bg: "#dbeafe", cor: "#1d4ed8" }
                        : cargo.tipo === "pj" ? { label: "PJ/MEI", bg: "#fef3c7", cor: "#b45309" }
                        : { label: "Informal", bg: "#f3f4f6", cor: "#6b7280" };
                      return (
                        <TouchableOpacity key={cargo.id} onPress={() => abrirModalCargo(cargo)}
                          style={{ backgroundColor: C.BG, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.BORDER }}>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <Text style={{ fontWeight: "700", color: C.TEXT, fontSize: 14 }}>{cargo.nome}</Text>
                                <View style={{ backgroundColor: tipoBadge.bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                  <Text style={{ color: tipoBadge.cor, fontSize: 10, fontWeight: "700" }}>{tipoBadge.label}</Text>
                                </View>
                              </View>
                              <Text style={{ color: C.TEXT_MUTED, fontSize: 12 }}>
                                {cargo.quantidade}x · Salário {fmt(cargo.salario)}
                                {cargo.tipo === "clt" && ` + encargos`}
                              </Text>
                            </View>
                            <View style={{ alignItems: "flex-end", gap: 4 }}>
                              <Text style={{ fontWeight: "800", color: C.BRAND, fontSize: 14 }}>{fmt(custoReal)}/mês</Text>
                              <TouchableOpacity onPress={() => deletarCargo(cargo)}>
                                <Text style={{ color: C.DANGER, fontSize: 12 }}>✕ remover</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {cargos.length > 0 && (() => {
                  const totalFuncionarios = cargos.reduce((a, c) => a + c.quantidade, 0);
                  const totalCusto = cargos.reduce((a, c) => a + custoRealCargo(c), 0);
                  return (
                    <View style={{ backgroundColor: "#fdf2f8", borderRadius: 10, padding: 12, gap: 4 }}>
                      <Text style={{ color: "#7c3aed", fontWeight: "700", fontSize: 13 }}>
                        👥 {totalFuncionarios} funcionário{totalFuncionarios > 1 ? "s" : ""} · Custo real: {fmt(totalCusto)}/mês
                      </Text>
                      {cargos.some(c => c.tipo === "clt") && (
                        <Text style={{ color: C.TEXT_MUTED, fontSize: 11 }}>
                          CLT inclui 13º, férias, FGTS, INSS patronal, RAT e Sistema S
                        </Text>
                      )}
                    </View>
                  );
                })()}

                <View style={{ marginTop: 12 }}>
                  <CfgField label="Quantidade de produtos produzidos por mês"
                    value={String(cfgForm.funcionarios_qtd)} onChange={v => setCfgForm({ ...cfgForm, funcionarios_qtd: parseInt(v) || 1 })} />
                </View>
                {cargos.length > 0 && cfgForm.funcionarios_qtd > 0 && (
                  <View style={{ backgroundColor: "#f0fdf4", borderRadius: 10, padding: 10, marginTop: 8 }}>
                    <Text style={{ color: C.SUCCESS, fontWeight: "700", fontSize: 13 }}>
                      💡 Por produto: {fmt(cargos.reduce((a, c) => a + custoRealCargo(c), 0) / cfgForm.funcionarios_qtd)}
                    </Text>
                  </View>
                )}
              </View>

              {/* Gastos variáveis */}
              <View style={s.card}>
                <Text style={s.cardTitle}>⚡ Gastos Variáveis</Text>
                <Text style={s.cardSub}>Despesas mensais da empresa (energia, aluguel, embalagens…)</Text>
                {gastos.length === 0 ? (
                  <Text style={{ color: C.TEXT_MUTED, fontSize: 13, textAlign: "center", padding: 16 }}>Nenhum gasto cadastrado ainda</Text>
                ) : (
                  <View style={{ gap: 6, marginBottom: 10 }}>
                    {gastos.map(g => (
                      <View key={g.id} style={{ flexDirection: "row", alignItems: "center", backgroundColor: C.BG, borderRadius: 10, padding: 10 }}>
                        <Text style={{ flex: 1, fontWeight: "600", color: C.TEXT, fontSize: 13 }}>{g.nome}</Text>
                        <Text style={{ fontWeight: "700", color: C.TEXT, marginRight: 10, fontSize: 13 }}>{fmt(g.valor)}/mês</Text>
                        <TouchableOpacity onPress={() => deletarGasto(g)}><Text style={{ color: C.DANGER }}>✕</Text></TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                  <TextInput style={[s.input, { flex: 1 }]} value={novoGasto.nome} onChangeText={v => setNovoGasto({ ...novoGasto, nome: v })}
                    placeholder="Ex: Energia elétrica" placeholderTextColor={C.TEXT_MUTED} />
                  <TextInput style={[s.input, { width: 100 }]} value={novoGasto.valor} onChangeText={v => setNovoGasto({ ...novoGasto, valor: v })}
                    placeholder="R$/mês" placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />
                </View>
                <TouchableOpacity style={s.btnAdd} onPress={addGasto}>
                  <Text style={s.btnAddText}>+ Adicionar gasto</Text>
                </TouchableOpacity>
                {gastos.length > 0 && (
                  <View style={{ backgroundColor: "#fefce8", borderRadius: 10, padding: 12, marginTop: 10 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 13, color: C.TEXT_MUTED }}>Total mensal</Text>
                      <Text style={{ fontWeight: "700", color: C.TEXT }}>{fmt(gastosMensal)}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#fde68a" }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: "#92400e" }}>⚡ Por produto</Text>
                      <Text style={{ fontWeight: "800", color: "#92400e" }}>{fmt(gastosPorProduto)}</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Perdas */}
              <View style={s.card}>
                <Text style={s.cardTitle}>🗑️ Perdas</Text>
                <Text style={s.cardSub}>Vencimento, desperdício e quebras</Text>
                <CfgField label="Taxa sobre insumos (%)" value={String(cfgForm.perdas_pct)}
                  onChange={v => setCfgForm({ ...cfgForm, perdas_pct: parseFloat(v) || 0 })} />
              </View>

              <TouchableOpacity style={s.btnSalvar} onPress={salvarConfig}>
                <Text style={s.btnSalvarText}>💾 Salvar Configurações desta Empresa</Text>
              </TouchableOpacity>
            </>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal Cargo */}
      <Modal visible={modalCargo} animationType="slide" transparent onRequestClose={() => setModalCargo(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
            <View style={{ backgroundColor: C.CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 14 }}>
              <Text style={{ fontSize: 17, fontWeight: "800", color: C.TEXT }}>
                {cargoEditando ? "Editar Cargo" : "Novo Cargo"}
              </Text>

              <TextInput style={s.input} value={cargoForm.nome} onChangeText={v => setCargoForm({ ...cargoForm, nome: v })}
                placeholder="Ex: Cozinheira, Serviços Gerais" placeholderTextColor={C.TEXT_MUTED} />

              {/* Tipo */}
              <View>
                <Text style={{ fontSize: 12, color: C.TEXT_MUTED, marginBottom: 6 }}>Tipo de contratação</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["clt", "pj", "informal"] as const).map(tipo => (
                    <TouchableOpacity key={tipo} onPress={() => setCargoForm({ ...cargoForm, tipo })}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 2,
                        borderColor: cargoForm.tipo === tipo ? C.BRAND : C.BORDER,
                        backgroundColor: cargoForm.tipo === tipo ? C.BRAND + "15" : C.BG,
                        alignItems: "center" }}>
                      <Text style={{ fontSize: 12, fontWeight: "700",
                        color: cargoForm.tipo === tipo ? C.BRAND : C.TEXT_MUTED }}>
                        {tipo === "clt" ? "CLT" : tipo === "pj" ? "PJ / MEI" : "Informal"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {cargoForm.tipo === "clt" && (
                <View style={{ backgroundColor: "#dbeafe", borderRadius: 10, padding: 10 }}>
                  <Text style={{ color: "#1d4ed8", fontSize: 12, fontWeight: "600" }}>
                    ℹ️ CLT: o app calcula automaticamente 13º, férias, FGTS, INSS patronal, RAT e Sistema S (+55,24% sobre o salário)
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 2 }}>
                  <Text style={{ fontSize: 12, color: C.TEXT_MUTED, marginBottom: 4 }}>Salário / pagamento mensal (R$)</Text>
                  <TextInput style={s.input} value={cargoForm.salario} onChangeText={v => setCargoForm({ ...cargoForm, salario: v })}
                    placeholder="0,00" placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: C.TEXT_MUTED, marginBottom: 4 }}>Quantidade</Text>
                  <TextInput style={s.input} value={cargoForm.quantidade} onChangeText={v => setCargoForm({ ...cargoForm, quantidade: v })}
                    placeholder="1" placeholderTextColor={C.TEXT_MUTED} keyboardType="number-pad" />
                </View>
              </View>

              {parseFloat(cargoForm.salario) > 0 && (
                <View style={{ backgroundColor: "#f0fdf4", borderRadius: 10, padding: 12 }}>
                  <Text style={{ color: C.SUCCESS, fontWeight: "700", fontSize: 13 }}>
                    Custo real: {fmt(custoRealCargo({
                      id: 0, nome: "", tipo: cargoForm.tipo,
                      salario: parseFloat(cargoForm.salario) || 0,
                      quantidade: parseInt(cargoForm.quantidade) || 1,
                    }))} /mês
                  </Text>
                  {cargoForm.tipo === "clt" && (
                    <Text style={{ color: C.TEXT_MUTED, fontSize: 11, marginTop: 2 }}>
                      Salário {fmt((parseFloat(cargoForm.salario) || 0) * (parseInt(cargoForm.quantidade) || 1))} + encargos {fmt((parseFloat(cargoForm.salario) || 0) * (parseInt(cargoForm.quantidade) || 1) * ENCARGOS_CLT)}
                    </Text>
                  )}
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity onPress={() => setModalCargo(false)}
                  style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.BORDER, alignItems: "center" }}>
                  <Text style={{ color: C.TEXT_MUTED, fontWeight: "600" }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={salvarCargo}
                  style={{ flex: 2, padding: 14, borderRadius: 12, backgroundColor: C.BRAND, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Salvar Cargo</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

// ── Componentes auxiliares ────────────────────────────────────────────────────

function OpField({ label, value, onChange, hint, hintColor }: { label: string; value: string; onChange: (v: string) => void; hint: string; hintColor: string }) {
  return (
    <View style={{ backgroundColor: "#f8fafc", borderRadius: 12, padding: 12 }}>
      <Text style={{ fontSize: 12, fontWeight: "700", color: C.TEXT_MUTED, marginBottom: 6 }}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange}
        keyboardType="decimal-pad" placeholderTextColor={C.TEXT_MUTED} placeholder="0,00" />
      <Text style={{ fontSize: 11, color: hintColor, marginTop: 4 }}>{hint}</Text>
    </View>
  );
}

function CfgField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View>
      <Text style={{ fontSize: 13, color: C.TEXT_MUTED, fontWeight: "600", marginBottom: 6 }}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange}
        keyboardType="decimal-pad" placeholderTextColor={C.TEXT_MUTED} />
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: C.CARD, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.TEXT },
});

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  header: { flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  backBtn: { padding: 4, marginRight: 8 },
  backText: { fontSize: 28, color: C.BRAND, lineHeight: 28 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: C.TEXT },
  abaBar: { flexDirection: "row", backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  abaBtn: { flex: 1, alignItems: "center", paddingVertical: 8, gap: 2, borderBottomWidth: 2, borderBottomColor: "transparent" },
  abaBtnActive: { borderBottomColor: C.BRAND },
  abaBtnText: { fontSize: 10, fontWeight: "700", color: C.TEXT_MUTED, textTransform: "uppercase" },
  abaBtnTextActive: { color: C.BRAND },
  card: { backgroundColor: C.CARD, borderRadius: 16, padding: 16, gap: 0 },
  cardTitle: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  cardSub: { fontSize: 12, color: C.TEXT_MUTED, marginBottom: 12, marginTop: -4 },
  input: { backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.TEXT },
  infoBanner: { backgroundColor: "#eff6ff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#bfdbfe" },
  infoText: { fontSize: 12, color: "#1d4ed8", lineHeight: 18 },
  editBanner: { backgroundColor: "#fef9c3", borderRadius: 12, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: "#fde68a" },
  editBannerText: { fontSize: 13, fontWeight: "700", color: "#92400e" },
  sugestoes: { position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, backgroundColor: C.CARD, borderRadius: 12, borderWidth: 1, borderColor: C.BORDER, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, elevation: 8 },
  sugItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  sugNome: { fontSize: 14, fontWeight: "600", color: C.TEXT },
  sugCusto: { fontSize: 12, color: C.TEXT_MUTED },
  unidBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, marginRight: 6, height: 34, justifyContent: "center" },
  unidBtnActive: { backgroundColor: C.BRAND, borderColor: C.BRAND },
  unidText: { fontSize: 12, color: C.TEXT_MUTED, fontWeight: "600" },
  btnAdd: { borderStyle: "dashed", borderWidth: 1.5, borderColor: C.BRAND, borderRadius: 10, padding: 10, alignItems: "center" },
  btnAddText: { color: C.BRAND, fontWeight: "700", fontSize: 14 },
  tabelaHeader: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.BORDER, paddingBottom: 6, marginTop: 8 },
  tabelaCol: { fontSize: 11, fontWeight: "700", color: C.TEXT_MUTED, flex: 1, textTransform: "uppercase" },
  tabelaRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  tabelaCell: { fontSize: 12, color: C.TEXT, flex: 1 },
  modoSwitch: { flexDirection: "row", backgroundColor: C.BG, borderRadius: 10, padding: 3, gap: 2 },
  modoBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  modoBtnActive: { backgroundColor: C.CARD, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  modoBtnText: { fontSize: 12, fontWeight: "600", color: C.TEXT_MUTED },
  margemBadge: { borderRadius: 10, padding: 10 },
  breakRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  breakLabel: { fontSize: 13, color: C.TEXT_MUTED },
  breakValue: { fontSize: 13, fontWeight: "700", color: C.TEXT },
  precoDestaque: { backgroundColor: "#eff6ff", borderRadius: 14, padding: 16, alignItems: "center", borderWidth: 2, borderColor: "#bfdbfe" },
  pagCard: { backgroundColor: C.CARD, borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1, borderColor: C.BORDER, minWidth: "47%" },
  pagLabel: { fontSize: 10, color: C.TEXT_MUTED, textAlign: "center" },
  pagValor: { fontSize: 15, fontWeight: "800", color: C.BRAND, marginTop: 2 },
  prodCard: { backgroundColor: C.CARD, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.BORDER },
  prodNome: { fontSize: 15, fontWeight: "700", color: C.TEXT },
  prodSub: { fontSize: 12, color: C.TEXT_MUTED, marginTop: 2 },
  btnSmall: { backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  btnSmallText: { fontSize: 12, fontWeight: "600", color: C.TEXT_MUTED },
  regimeBtn: { borderWidth: 2, borderColor: C.BORDER, borderRadius: 12, padding: 12 },
  regimeBtnActive: { borderColor: C.BRAND, backgroundColor: "#eff6ff" },
  regimeBtnTitle: { fontSize: 14, fontWeight: "700", color: C.TEXT },
  regimeBtnSub: { fontSize: 12, color: C.TEXT_MUTED, marginTop: 2 },
  btnSalvar: { backgroundColor: C.BRAND, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  btnSalvarText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  btnOutline: { borderRadius: 14, paddingVertical: 13, alignItems: "center", borderWidth: 2, borderColor: C.BRAND },
  btnOutlineText: { color: C.BRAND, fontWeight: "700", fontSize: 14 },
  empty: { alignItems: "center", padding: 48 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: C.TEXT_MUTED },
});
