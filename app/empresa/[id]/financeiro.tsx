import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDB } from "@/lib/db";
import * as C from "@/constants/colors";

interface Lancamento {
  id: number; tipo: string; valor: number; descricao: string;
  categoria: string; data: string; obs: string;
}
interface Socio { nome: string; percentual: number; }

type Aba = "dashboard" | "lancamentos" | "socios";

const CATEGORIAS_COMPRA = ["insumos", "embalagens", "limpeza", "pessoal", "equipamentos", "outros"];
const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function maskData(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
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
  const [modalVisible, setModalVisible] = useState(false);
  const [tipo, setTipo] = useState<"venda" | "compra">("venda");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("insumos");
  const [data, setData] = useState(hojeDisplay());
  const [obs, setObs] = useState("");
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
  }, [empresaId, filtroMes]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalVendas = lancamentos.filter(l => l.tipo === "venda").reduce((a, l) => a + l.valor, 0);
  const totalCompras = lancamentos.filter(l => l.tipo === "compra").reduce((a, l) => a + l.valor, 0);
  const lucro = totalVendas - totalCompras;

  const comprasPorCat = CATEGORIAS_COMPRA.map(cat => ({
    cat,
    valor: lancamentos.filter(l => l.tipo === "compra" && l.categoria === cat).reduce((a, l) => a + l.valor, 0),
  })).filter(x => x.valor > 0);

  function salvarLancamento() {
    if (!valor || parseFloat(valor) <= 0) { Alert.alert("Atenção", "Informe um valor válido."); return; }
    const dataISO = displayToISO(data) || data;
    getDB().runSync(
      "INSERT INTO lancamentos (empresa_id, tipo, valor, descricao, categoria, data, obs) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [empresaId, tipo, parseFloat(valor), descricao.trim(), tipo === "compra" ? categoria : "venda", dataISO, obs.trim()]
    );
    setValor(""); setDescricao(""); setObs(""); setData(hojeDisplay()); setCategoria("insumos");
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
        {([["dashboard", "📊 Dashboard"], ["lancamentos", "📋 Lançamentos"], ["socios", "👥 Sócios"]] as const).map(([k, label]) => (
          <TouchableOpacity key={k} onPress={() => setAba(k)} style={[s.abaBtn, aba === k && s.abaBtnActive]}>
            <Text style={[s.abaBtnText, aba === k && s.abaBtnTextActive]}>{label}</Text>
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
                    <Text style={s.lancData}>{new Date(l.data + "T12:00:00").toLocaleDateString("pt-BR")} · {l.categoria}</Text>
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
                    <TextInput style={[s.input, { width: 70 }]} value={String(soc.percentual)} onChangeText={(v) => updateSocio(i, "percentual", v)}
                      keyboardType="decimal-pad" placeholder="%" placeholderTextColor={C.TEXT_MUTED} />
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

                <Text style={[s.configLabel, { marginTop: 12 }]}>Data</Text>
                <TextInput style={s.input} value={data}
                  onChangeText={v => setData(maskData(v))}
                  placeholder="DD/MM/AAAA" placeholderTextColor={C.TEXT_MUTED}
                  keyboardType="number-pad" />

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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  backBtn: { padding: 4, marginRight: 8 },
  backText: { fontSize: 28, color: C.BRAND, lineHeight: 28 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: C.TEXT, flex: 1 },
  btnNovo: { backgroundColor: C.BRAND, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  btnNovoText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  abaBar: { flexDirection: "row", backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  abaBtn: { flex: 1, alignItems: "center", paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: "transparent" },
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
  lancCard: { backgroundColor: C.CARD, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: C.BORDER },
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
});
