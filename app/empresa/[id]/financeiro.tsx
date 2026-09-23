import { useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDB } from "@/lib/db";
import * as C from "@/constants/colors";
import { parseValorBR } from "@/lib/numero";
import CalendarioPicker from "@/components/CalendarioPicker";

interface Lancamento {
  id: number; tipo: string; valor: number; descricao: string;
  categoria: string; data: string; obs: string; forma_pagamento: string | null;
}
interface Socio { nome: string; percentual: number; }
interface ConfigDRE {
  regime: string; anexo: string; aliquota_custom: number;
  taxa_debito: number; taxa_credito: number; taxa_pix: number; taxa_dinheiro: number;
}

const FORMAS_PAGAMENTO = [
  { key: "dinheiro", label: "💵 Dinheiro" },
  { key: "debito", label: "💳 Débito" },
  { key: "credito", label: "💳 Crédito" },
  { key: "pix", label: "📱 Pix" },
] as const;

type Aba = "dashboard" | "lancamentos" | "socios" | "dre";

const CATEGORIAS_COMPRA = ["insumos", "embalagens", "limpeza", "pessoal", "equipamentos", "outros"];
const CATEGORIAS_CMV = ["insumos", "embalagens"];
const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (v: number) => v.toFixed(1) + "%";

const ALIQ: Record<string, number> = {
  "simples_nacional-I": 4.0, "simples_nacional-II": 4.5, "simples_nacional-III": 6.0,
  "simples_nacional-IV": 6.0, "simples_nacional-V": 15.5, "simples_nacional-VI": 16.93,
  lucro_presumido: 13.33, lucro_real: 34, mei: 0,
};

function getAliquotaDRE(config: ConfigDRE): number {
  if (config.regime === "custom") return config.aliquota_custom;
  if (config.regime === "simples_nacional") {
    if (config.anexo === "custom") return config.aliquota_custom;
    return ALIQ[`simples_nacional-${config.anexo}`] ?? 4.0;
  }
  return ALIQ[config.regime] ?? 0;
}

function displayToISO(d: string): string {
  const p = d.split("/");
  return p.length === 3 && p[2].length === 4 ? `${p[2]}-${p[1]}-${p[0]}` : "";
}
function hojeDisplay(): string {
  const iso = new Date().toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export default function FinanceiroScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const empresaId = Number(id);

  const [aba, setAba] = useState<Aba>("dashboard");
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [configDRE, setConfigDRE] = useState<ConfigDRE | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [tipo, setTipo] = useState<"venda" | "compra">("venda");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("insumos");
  const [data, setData] = useState(hojeDisplay());
  const [obs, setObs] = useState("");
  const [formaPagamento, setFormaPagamento] = useState<string>("dinheiro");
  const [filtroMes, setFiltroMes] = useState(new Date().toISOString().slice(0, 7));

  const load = useCallback(() => {
    const db = getDB();
    const rows = db.getAllSync<Lancamento>(
      "SELECT * FROM lancamentos WHERE empresa_id = ? AND data LIKE ? ORDER BY data DESC, criado_at DESC",
      [empresaId, `${filtroMes}%`]
    );
    setLancamentos(rows);
    const socRow = db.getFirstSync<{ dados: string }>(
      "SELECT dados FROM socios WHERE empresa_id = ?", [empresaId]
    );
    setSocios(socRow ? JSON.parse(socRow.dados) as Socio[] : []);
    const cfgRow = db.getFirstSync<ConfigDRE>(
      "SELECT regime, anexo, aliquota_custom, taxa_debito, taxa_credito, taxa_pix, taxa_dinheiro FROM configuracoes_empresa WHERE empresa_id = ?", [empresaId]
    );
    setConfigDRE(cfgRow ?? null);
  }, [empresaId, filtroMes]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalVendas = lancamentos.filter(l => l.tipo === "venda").reduce((a, l) => a + l.valor, 0);
  const totalCompras = lancamentos.filter(l => l.tipo === "compra").reduce((a, l) => a + l.valor, 0);
  const lucro = totalVendas - totalCompras;

  const comprasPorCat = CATEGORIAS_COMPRA.map(cat => ({
    cat,
    valor: lancamentos.filter(l => l.tipo === "compra" && l.categoria === cat).reduce((a, l) => a + l.valor, 0),
  })).filter(x => x.valor > 0);

  // ── DRE ──
  const dreCMV = lancamentos.filter(l => l.tipo === "compra" && CATEGORIAS_CMV.includes(l.categoria)).reduce((a, l) => a + l.valor, 0);
  const dreCustosFixos = lancamentos.filter(l => l.tipo === "compra" && !CATEGORIAS_CMV.includes(l.categoria)).reduce((a, l) => a + l.valor, 0);
  const dreAliquota = configDRE ? getAliquotaDRE(configDRE) : 0;
  const dreImpostos = totalVendas * (dreAliquota / 100);
  const vendasPorForma = (forma: string) => lancamentos.filter(l => l.tipo === "venda" && l.forma_pagamento === forma).reduce((a, l) => a + l.valor, 0);
  const dreTaxaCartao = configDRE
    ? vendasPorForma("debito") * (configDRE.taxa_debito / 100)
      + vendasPorForma("credito") * (configDRE.taxa_credito / 100)
      + vendasPorForma("pix") * (configDRE.taxa_pix / 100)
    : 0;
  const dreMargemContribuicao = totalVendas - dreImpostos - dreTaxaCartao - dreCMV;
  const dreResultado = dreMargemContribuicao - dreCustosFixos;
  const drePct = (v: number) => (totalVendas > 0 ? (v / totalVendas) * 100 : 0);
  const dreMargemBruta = totalVendas > 0 ? ((totalVendas - dreCMV) / totalVendas) * 100 : 0;
  const dreMargemContribuicaoPct = drePct(dreMargemContribuicao);
  const dreMargemLiquida = drePct(dreResultado);
  const drePontoEquilibrio = dreMargemContribuicaoPct > 0 ? dreCustosFixos / (dreMargemContribuicaoPct / 100) : null;

  function salvarLancamento() {
    if (!valor || parseValorBR(valor) <= 0) { Alert.alert("Atenção", "Informe um valor válido."); return; }
    const dataISO = displayToISO(data) || data;
    getDB().runSync(
      "INSERT INTO lancamentos (empresa_id, tipo, valor, descricao, categoria, data, obs, forma_pagamento) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [empresaId, tipo, parseValorBR(valor), descricao.trim(), tipo === "compra" ? categoria : "venda", dataISO, obs.trim(), tipo === "venda" ? formaPagamento : null]
    );
    setValor(""); setDescricao(""); setObs(""); setData(hojeDisplay()); setCategoria("insumos"); setFormaPagamento("dinheiro");
    setModalVisible(false);
    load();
  }

  function deletarLancamento(l: Lancamento) {
    Alert.alert("Excluir lançamento?", l.descricao || fmt(l.valor), [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => { getDB().runSync("DELETE FROM lancamentos WHERE id = ?", [l.id]); load(); } },
    ]);
  }

  function salvarSocios() {
    const total = socios.reduce((a, s) => a + s.percentual, 0);
    if (total !== 100 && socios.length > 0) { Alert.alert("Atenção", `Total dos percentuais: ${total}%. Deve ser 100%.`); return; }
    const db = getDB();
    const exists = db.getFirstSync("SELECT id FROM socios WHERE empresa_id = ?", [empresaId]);
    if (exists) {
      db.runSync("UPDATE socios SET dados = ? WHERE empresa_id = ?", [JSON.stringify(socios), empresaId]);
    } else {
      db.runSync("INSERT INTO socios (empresa_id, dados) VALUES (?, ?)", [empresaId, JSON.stringify(socios)]);
    }
    Alert.alert("✅ Sócios salvos!");
  }

  function addSocio() { setSocios([...socios, { nome: "", percentual: 0 }]); }
  function removeSocio(i: number) { setSocios(socios.filter((_, idx) => idx !== i)); }
  function updateSocio(i: number, field: keyof Socio, value: string) {
    setSocios(socios.map((s, idx) => idx === i ? { ...s, [field]: field === "percentual" ? parseFloat(value) || 0 : value } : s));
  }

  // 3 meses futuros + mês atual + 24 meses passados = 28 meses
  const meses = Array.from({ length: 8 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i + 1);
    const value = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    return { value, label };
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>💰 Financeiro</Text>
        <TouchableOpacity style={s.btnNovo} onPress={() => setModalVisible(true)}>
          <Text style={s.btnNovoText}>+ Lançar</Text>
        </TouchableOpacity>
      </View>

      {/* Abas */}
      <View style={s.abaBar}>
        {([["dashboard", "📊 Dashboard"], ["lancamentos", "📋 Lançamentos"], ["dre", "🧾 DRE"], ["socios", "👥 Sócios"]] as const).map(([k, label]) => (
          <TouchableOpacity key={k} onPress={() => setAba(k)} style={[s.abaBtn, aba === k && s.abaBtnActive]}>
            <Text style={[s.abaBtnText, aba === k && s.abaBtnTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Filtro de mês */}
      <View style={s.mesBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: "center", height: 44 }}>
          {meses.map((m) => (
            <TouchableOpacity key={m.value} onPress={() => setFiltroMes(m.value)}
              style={[s.mesBtn, filtroMes === m.value && s.mesBtnActive]}>
              <Text style={[s.mesBtnText, filtroMes === m.value && { color: "#fff" }]}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>

        {/* ── DASHBOARD ── */}
        {aba === "dashboard" && (
          <>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={[s.kpi, { backgroundColor: "#dcfce7", flex: 1 }]}>
                <Text style={s.kpiLabel}>Vendas</Text>
                <Text style={[s.kpiValor, { color: C.SUCCESS }]}>{fmt(totalVendas)}</Text>
              </View>
              <View style={[s.kpi, { backgroundColor: "#fee2e2", flex: 1 }]}>
                <Text style={s.kpiLabel}>Compras</Text>
                <Text style={[s.kpiValor, { color: C.DANGER }]}>{fmt(totalCompras)}</Text>
              </View>
            </View>
            <View style={[s.kpi, { backgroundColor: lucro >= 0 ? "#eff6ff" : "#fff1f2" }]}>
              <Text style={s.kpiLabel}>Lucro líquido</Text>
              <Text style={[s.kpiValor, { color: lucro >= 0 ? C.BRAND : C.DANGER, fontSize: 28 }]}>{fmt(lucro)}</Text>
            </View>

            {comprasPorCat.length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>Gastos por categoria</Text>
                {comprasPorCat.sort((a, b) => b.valor - a.valor).map(({ cat, valor: v }) => (
                  <View key={cat} style={{ marginBottom: 10 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, color: C.TEXT, textTransform: "capitalize" }}>{cat}</Text>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: C.TEXT }}>{fmt(v)}</Text>
                    </View>
                    <View style={{ height: 6, backgroundColor: C.BORDER, borderRadius: 3 }}>
                      <View style={{ height: 6, backgroundColor: C.BRAND, borderRadius: 3, width: `${Math.min(100, (v / totalCompras) * 100)}%` as any }} />
                    </View>
                  </View>
                ))}
              </View>
            )}

            {socios.length > 0 && lucro > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>Distribuição entre sócios</Text>
                {socios.map((soc, i) => (
                  <View key={i} style={s.breakRow}>
                    <Text style={s.breakLabel}>{soc.nome || `Sócio ${i + 1}`} ({soc.percentual}%)</Text>
                    <Text style={[s.breakValue, { color: C.SUCCESS }]}>{fmt(lucro * soc.percentual / 100)}</Text>
                  </View>
                ))}
              </View>
            )}

            {lancamentos.length === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyEmoji}>📊</Text>
                <Text style={s.emptyText}>Nenhum lançamento neste mês</Text>
                <TouchableOpacity style={[s.btnSalvar, { marginTop: 16 }]} onPress={() => setModalVisible(true)}>
                  <Text style={s.btnSalvarText}>+ Fazer primeiro lançamento</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {/* ── LANÇAMENTOS ── */}
        {aba === "lancamentos" && (
          <>
            {lancamentos.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyEmoji}>📋</Text>
                <Text style={s.emptyText}>Nenhum lançamento neste mês</Text>
              </View>
            ) : (
              lancamentos.map((l) => (
                <View key={l.id} style={s.lancCard}>
                  <View style={[s.lancDot, { backgroundColor: l.tipo === "venda" ? C.SUCCESS : C.DANGER }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.lancDesc}>{l.descricao || (l.tipo === "venda" ? "Venda" : l.categoria)}</Text>
                    <Text style={s.lancData}>
                      {new Date(l.data + "T12:00:00").toLocaleDateString("pt-BR")} · {l.tipo === "venda" ? (FORMAS_PAGAMENTO.find(f => f.key === l.forma_pagamento)?.label ?? l.categoria) : l.categoria}
                    </Text>
                    {l.obs ? <Text style={s.lancObs}>{l.obs}</Text> : null}
                  </View>
                  <Text style={[s.lancValor, { color: l.tipo === "venda" ? C.SUCCESS : C.DANGER }]}>
                    {l.tipo === "venda" ? "+" : "-"}{fmt(l.valor)}
                  </Text>
                  <TouchableOpacity onPress={() => deletarLancamento(l)} style={{ padding: 6 }}>
                    <Text style={{ color: C.DANGER, fontSize: 14 }}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </>
        )}

        {/* ── DRE ── */}
        {aba === "dre" && (
          <>
            {!configDRE && (
              <View style={s.avisoBox}>
                <Text style={s.avisoText}>⚠️ Configure o regime tributário na tela de Precificação para os impostos entrarem no cálculo.</Text>
              </View>
            )}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <View style={[s.dreKpi, { backgroundColor: "#d1fae5" }]}>
                <Text style={s.kpiLabel}>Margem Bruta</Text>
                <Text style={[s.kpiValor, { color: "#065f46", fontSize: 18 }]}>{fmtPct(dreMargemBruta)}</Text>
              </View>
              <View style={[s.dreKpi, { backgroundColor: "#e0f2fe" }]}>
                <Text style={s.kpiLabel}>Margem Contrib.</Text>
                <Text style={[s.kpiValor, { color: "#075985", fontSize: 18 }]}>{fmtPct(dreMargemContribuicaoPct)}</Text>
              </View>
              <View style={[s.dreKpi, { backgroundColor: dreResultado >= 0 ? "#dbeafe" : "#fee2e2" }]}>
                <Text style={s.kpiLabel}>Margem Líquida</Text>
                <Text style={[s.kpiValor, { color: dreResultado >= 0 ? "#1e40af" : C.DANGER, fontSize: 18 }]}>{fmtPct(dreMargemLiquida)}</Text>
              </View>
              <View style={[s.dreKpi, { backgroundColor: "#ede9fe" }]}>
                <Text style={s.kpiLabel}>Ponto de Equilíbrio</Text>
                <Text style={[s.kpiValor, { color: "#5b21b6", fontSize: 15 }]}>{drePontoEquilibrio !== null ? fmt(drePontoEquilibrio) : "—"}</Text>
              </View>
            </View>

            <View style={s.card}>
              <DreLinha label="Venda total" valor={fmt(totalVendas)} pct={fmtPct(drePct(totalVendas))} destaque />
              <DreLinha label={`(-) Impostos${configDRE ? ` (${dreAliquota.toFixed(2)}%)` : ""}`} valor={fmt(dreImpostos)} pct={fmtPct(drePct(dreImpostos))} cor={C.DANGER} />
              <DreLinha label="(-) Taxa de cartão/maquininha" valor={fmt(dreTaxaCartao)} pct={fmtPct(drePct(dreTaxaCartao))} cor={C.DANGER} />
              <DreLinha label="(-) CMV (insumos + embalagens)" valor={fmt(dreCMV)} pct={fmtPct(drePct(dreCMV))} cor={C.DANGER} />
              <DreLinha label="(=) Margem de Contribuição" valor={fmt(dreMargemContribuicao)} pct={fmtPct(dreMargemContribuicaoPct)} destaque cor="#075985" fundo="#f0f9ff" />
              <DreLinha label="(-) Custos fixos" valor={fmt(dreCustosFixos)} pct={fmtPct(drePct(dreCustosFixos))} cor={C.DANGER} />
              <DreLinha label="(=) Resultado" valor={fmt(dreResultado)} pct={fmtPct(dreMargemLiquida)} destaque
                cor={dreResultado >= 0 ? "#1e40af" : C.DANGER} fundo={dreResultado >= 0 ? "#eff6ff" : "#fef2f2"} ultima />
            </View>

            <Text style={s.dreNota}>
              CMV e custos fixos vêm das categorias marcadas em cada gasto lançado. Impostos são calculados sobre a venda total usando o regime tributário configurado em Precificação → Configurações.
            </Text>
          </>
        )}

        {/* ── SÓCIOS ── */}
        {aba === "socios" && (
          <>
            <View style={s.card}>
              <Text style={s.cardTitle}>Distribuição de lucro</Text>
              {socios.map((soc, i) => (
                <View key={i} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                    <TextInput style={[s.input, { flex: 1 }]} value={soc.nome} onChangeText={(v) => updateSocio(i, "nome", v)}
                      placeholder={`Nome do sócio ${i + 1}`} placeholderTextColor={C.TEXT_MUTED} />
                    <CampoPercentual value={soc.percentual} onChange={(v) => updateSocio(i, "percentual", String(v))} />
                    <TouchableOpacity onPress={() => removeSocio(i)} style={{ justifyContent: "center", padding: 4 }}>
                      <Text style={{ color: C.DANGER }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                <TouchableOpacity style={[s.btnOutline, { flex: 1 }]} onPress={addSocio}>
                  <Text style={s.btnOutlineText}>+ Adicionar sócio</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btnSalvar, { flex: 1 }]} onPress={salvarSocios}>
                  <Text style={s.btnSalvarText}>💾 Salvar</Text>
                </TouchableOpacity>
              </View>
              {socios.length > 0 && (
                <Text style={{ textAlign: "center", marginTop: 8, fontSize: 13, color: C.TEXT_MUTED }}>
                  Total: {socios.reduce((a, s) => a + s.percentual, 0)}%
                  {socios.reduce((a, s) => a + s.percentual, 0) === 100 ? " ✅" : " (deve ser 100%)"}
                </Text>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Modal novo lançamento */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.header}>
              <Text style={s.headerTitle}>Novo Lançamento</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={{ fontSize: 20, color: C.TEXT_MUTED }}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
              {/* Tipo */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                {(["venda", "compra"] as const).map((t) => (
                  <TouchableOpacity key={t} onPress={() => setTipo(t)}
                    style={[s.tipoBtn, tipo === t && (t === "venda" ? s.tipoBtnVenda : s.tipoBtnCompra)]}>
                    <Text style={[s.tipoBtnText, tipo === t && { color: "#fff" }]}>
                      {t === "venda" ? "💚 Venda" : "🔴 Compra"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.card}>
                <Text style={s.configLabel}>Valor (R$)</Text>
                <TextInput style={s.input} value={valor} onChangeText={setValor}
                  placeholder="0,00" placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />

                <Text style={[s.configLabel, { marginTop: 12 }]}>Descrição</Text>
                <TextInput style={s.input} value={descricao} onChangeText={setDescricao}
                  placeholder={tipo === "venda" ? "Ex: Venda do dia" : "Ex: Compra de farinha"} placeholderTextColor={C.TEXT_MUTED} />

                {tipo === "compra" && (
                  <>
                    <Text style={[s.configLabel, { marginTop: 12 }]}>Categoria</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                      {CATEGORIAS_COMPRA.map((cat) => (
                        <TouchableOpacity key={cat} onPress={() => setCategoria(cat)}
                          style={[s.unidBtn, categoria === cat && s.unidBtnActive, { marginRight: 6 }]}>
                          <Text style={[s.unidText, categoria === cat && { color: "#fff" }]}>{cat}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}

                {tipo === "venda" && (
                  <>
                    <Text style={[s.configLabel, { marginTop: 12 }]}>Forma de pagamento</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                      {FORMAS_PAGAMENTO.map((f) => (
                        <TouchableOpacity key={f.key} onPress={() => setFormaPagamento(f.key)}
                          style={[s.unidBtn, formaPagamento === f.key && s.unidBtnActive]}>
                          <Text style={[s.unidText, formaPagamento === f.key && { color: "#fff" }]}>{f.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                <Text style={[s.configLabel, { marginTop: 12 }]}>Data</Text>
                <CalendarioPicker value={data} onChange={setData} />

                <Text style={[s.configLabel, { marginTop: 12 }]}>Observação (opcional)</Text>
                <TextInput style={s.input} value={obs} onChangeText={setObs}
                  placeholder="Obs..." placeholderTextColor={C.TEXT_MUTED} />
              </View>

              <TouchableOpacity style={s.btnSalvar} onPress={salvarLancamento}>
                <Text style={s.btnSalvarText}>✅ Confirmar lançamento</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function DreLinha({ label, valor, pct, cor, destaque, fundo, ultima }: {
  label: string; valor: string; pct: string; cor?: string; destaque?: boolean; fundo?: string; ultima?: boolean;
}) {
  return (
    <View style={[s.dreRow, fundo ? { backgroundColor: fundo, marginHorizontal: -16, paddingHorizontal: 16, borderRadius: 8 } : null, ultima && { borderBottomWidth: 0 }]}>
      <Text style={[s.dreLabel, destaque && { fontWeight: "800", color: cor ?? C.TEXT }]}>{label}</Text>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[s.dreValor, { color: cor ?? C.TEXT }, destaque && { fontWeight: "800" }]}>{valor}</Text>
        <Text style={s.drePctText}>{pct}</Text>
      </View>
    </View>
  );
}

// Buffer de texto próprio — se resincronizasse a cada tecla, a vírgula era
// apagada assim que digitada (antes do próximo dígito vir).
function CampoPercentual({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [texto, setTexto] = useState(() => String(value).replace(".", ","));
  const ultimoEmitido = useRef(value);

  useEffect(() => {
    if (value !== ultimoEmitido.current) {
      setTexto(String(value).replace(".", ","));
      ultimoEmitido.current = value;
    }
  }, [value]);

  function handleChange(v: string) {
    setTexto(v);
    const num = parseValorBR(v);
    ultimoEmitido.current = num;
    onChange(num);
  }

  return (
    <TextInput style={[s.input, { width: 70 }]} value={texto} onChangeText={handleChange}
      keyboardType="decimal-pad" placeholder="%" placeholderTextColor={C.TEXT_MUTED} />
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  backBtn: { padding: 4, marginRight: 8 },
  backText: { fontSize: 28, color: C.BRAND, lineHeight: 28 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: C.TEXT, flex: 1 },
  btnNovo: { backgroundColor: C.BRAND, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  btnNovoText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  abaBar: { flexDirection: "row", backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  abaBtn: { flex: 1, alignItems: "center", paddingVertical: 11, paddingHorizontal: 2, borderBottomWidth: 2, borderBottomColor: "transparent" },
  abaBtnActive: { borderBottomColor: C.BRAND },
  abaBtnText: { fontSize: 12, fontWeight: "700", color: C.TEXT_MUTED },
  abaBtnTextActive: { color: C.BRAND },
  mesBar: { height: 44, backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  mesBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, height: 32, justifyContent: "center" as const },
  mesBtnActive: { backgroundColor: C.BRAND, borderColor: C.BRAND },
  mesBtnText: { fontSize: 12, fontWeight: "600" as const, color: C.TEXT_MUTED, textTransform: "capitalize" as const },
  kpi: { borderRadius: 16, padding: 16 },
  kpiLabel: { fontSize: 12, fontWeight: "700", color: C.TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  kpiValor: { fontSize: 22, fontWeight: "900", marginTop: 4 },
  card: { backgroundColor: C.CARD, borderRadius: 16, padding: 16 },
  cardTitle: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  lancCard: { backgroundColor: C.CARD, borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  lancDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  lancDesc: { fontSize: 14, fontWeight: "700", color: C.TEXT },
  lancData: { fontSize: 12, color: C.TEXT_MUTED, marginTop: 2, textTransform: "capitalize" },
  lancObs: { fontSize: 12, color: C.TEXT_MUTED, fontStyle: "italic", marginTop: 2 },
  lancValor: { fontSize: 14, fontWeight: "800" },
  tipoBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center", borderWidth: 2, borderColor: C.BORDER, backgroundColor: C.CARD },
  tipoBtnVenda: { backgroundColor: C.SUCCESS, borderColor: C.SUCCESS },
  tipoBtnCompra: { backgroundColor: C.DANGER, borderColor: C.DANGER },
  tipoBtnText: { fontWeight: "700", color: C.TEXT_MUTED, fontSize: 15 },
  input: { backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.TEXT },
  configLabel: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, marginBottom: 6 },
  unidBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, height: 34, justifyContent: "center" },
  unidBtnActive: { backgroundColor: C.BRAND, borderColor: C.BRAND },
  unidText: { fontSize: 12, color: C.TEXT_MUTED, fontWeight: "600" },
  breakRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  breakLabel: { fontSize: 13, color: C.TEXT_MUTED },
  breakValue: { fontSize: 13, fontWeight: "700", color: C.TEXT },
  btnSalvar: { backgroundColor: C.BRAND, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  btnSalvarText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  btnOutline: { borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 2, borderColor: C.BRAND },
  btnOutlineText: { color: C.BRAND, fontWeight: "700", fontSize: 14 },
  empty: { alignItems: "center", padding: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: C.TEXT_MUTED },
  dreKpi: { flexBasis: "47%", flexGrow: 1, borderRadius: 14, padding: 12 },
  avisoBox: { backgroundColor: "#fffbeb", borderRadius: 12, padding: 12 },
  avisoText: { color: "#b45309", fontSize: 12, lineHeight: 17 },
  dreRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  dreLabel: { fontSize: 13, color: C.TEXT, flex: 1, paddingRight: 8 },
  dreValor: { fontSize: 14, fontWeight: "700" },
  drePctText: { fontSize: 11, color: C.TEXT_MUTED, marginTop: 1 },
  dreNota: { fontSize: 11, color: C.TEXT_MUTED, lineHeight: 16, paddingHorizontal: 4 },
});
