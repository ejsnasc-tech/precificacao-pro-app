import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Modal, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { getDB } from "@/lib/db";
import * as C from "@/constants/colors";
import { parseValorBR } from "@/lib/numero";

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Lancamento {
  id: number; tipo: "receita" | "despesa";
  valor: number; descricao: string; categoria: string; data: string;
  forma_pagamento?: string; cartao_id?: number; parcelas?: number;
}
interface Meta {
  id: number; nome: string; valor_alvo: number; valor_atual: number;
  emoji: string; concluida: number;
}
interface Cartao {
  id: number; nome: string; bandeira: string; limite: number;
  dia_vencimento: number; dia_fechamento: number; cor: string;
  pontua: number; pontos_atuais: number; limite_alerta_pct: number;
  meta_fatura: number;
}
interface GastoCartao {
  id: number; cartao_id: number; descricao: string; valor: number;
  categoria: string; data: string;
}

type Aba = "resumo" | "lancamentos" | "metas" | "cartoes";

// ── Constantes ─────────────────────────────────────────────────────────────────

const CATEGORIAS_RECEITA = [
  { k: "salario", l: "💼 Salário", cor: "#10b981" },
  { k: "freelance", l: "🎯 Freelance", cor: "#3b82f6" },
  { k: "investimentos", l: "📈 Investimentos", cor: "#8b5cf6" },
  { k: "outros_rec", l: "💰 Outros", cor: "#6366f1" },
];
const CATEGORIAS_DESPESA = [
  { k: "moradia", l: "🏠 Moradia", cor: "#ef4444" },
  { k: "alimentacao", l: "🍔 Alimentação", cor: "#f97316" },
  { k: "transporte", l: "🚗 Transporte", cor: "#f59e0b" },
  { k: "saude", l: "🏥 Saúde", cor: "#ec4899" },
  { k: "lazer", l: "🎮 Lazer", cor: "#8b5cf6" },
  { k: "educacao", l: "📚 Educação", cor: "#3b82f6" },
  { k: "vestuario", l: "👕 Vestuário", cor: "#06b6d4" },
  { k: "outros", l: "📌 Outros", cor: "#64748b" },
];
const TODAS_CATS = [...CATEGORIAS_RECEITA, ...CATEGORIAS_DESPESA];
const EMOJIS_META = ["🎯", "🏠", "🚗", "✈️", "📱", "💎", "🎓", "🏋️", "💻", "🎸", "🐶", "💰"];
const BANDEIRAS = ["Visa", "Mastercard", "Elo", "Amex", "Hipercard", "Outros"];
const CORES_CARTAO = [
  "#6366f1", "#0f172a", "#1e40af", "#7c3aed",
  "#b45309", "#065f46", "#9f1239", "#374151",
];

function getCatInfo(k: string) {
  return TODAS_CATS.find(c => c.k === k) ?? { l: k, cor: "#64748b" };
}
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
function getMeses(): { label: string; value: string }[] {
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i + 1);
    const value = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    return { value, label };
  });
}
function getCicloInicio(diaFechamento: number): string {
  const hoje = new Date();
  const dia = hoje.getDate();
  let ano = hoje.getFullYear(), mes = hoje.getMonth();
  if (dia <= diaFechamento) { mes -= 1; if (mes < 0) { mes = 11; ano -= 1; } }
  const d = new Date(ano, mes, diaFechamento + 1);
  return d.toISOString().slice(0, 10);
}
function getProxVencimento(diaVenc: number): string {
  const hoje = new Date();
  let ano = hoje.getFullYear(), mes = hoje.getMonth();
  if (hoje.getDate() > diaVenc) { mes += 1; if (mes > 11) { mes = 0; ano += 1; } }
  const d = new Date(ano, mes, diaVenc);
  return d.toLocaleDateString("pt-BR");
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (v: number) => `${v.toFixed(0)}%`;

// ── Componente ─────────────────────────────────────────────────────────────────

const emptyCartao = {
  nome: "", bandeira: "Visa", limite: "", dia_vencimento: "10",
  dia_fechamento: "3", cor: "#6366f1", pontua: false,
  pontos_atuais: "0", limite_alerta_pct: "50", meta_fatura: "",
};

export default function FinanceiroPessoalScreen() {
  const [aba, setAba] = useState<Aba>("resumo");
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [cartoes, setCartoes] = useState<Cartao[]>([]);
  const [gastosCartao, setGastosCartao] = useState<Record<number, GastoCartao[]>>({});

  const meses = getMeses();
  const [mesSel, setMesSel] = useState(new Date().toISOString().slice(0, 7));

  // Modal lançamento
  const [modalLanc, setModalLanc] = useState(false);
  const [tipo, setTipo] = useState<"receita" | "despesa">("despesa");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [catSel, setCatSel] = useState("outros");
  const [dataSel, setDataSel] = useState(hojeDisplay());
  const [formaPgto, setFormaPgto] = useState<"dinheiro" | "pix" | "cartao">("dinheiro");
  const [cartaoSel, setCartaoSel] = useState<number | null>(null);
  const [parcelas, setParcelas] = useState("1");

  // Modal meta
  const [modalMeta, setModalMeta] = useState(false);
  const [metaNome, setMetaNome] = useState("");
  const [metaAlvo, setMetaAlvo] = useState("");
  const [metaAtual, setMetaAtual] = useState("");
  const [metaEmoji, setMetaEmoji] = useState("🎯");
  const [metaEditando, setMetaEditando] = useState<Meta | null>(null);
  const [modalAporte, setModalAporte] = useState(false);
  const [metaAportando, setMetaAportando] = useState<Meta | null>(null);
  const [aporteValor, setAporteValor] = useState("");

  // Modal cartão
  const [modalCartao, setModalCartao] = useState(false);
  const [cartaoForm, setCartaoForm] = useState(emptyCartao);
  const [cartaoEditando, setCartaoEditando] = useState<Cartao | null>(null);

  // Modal gasto no cartão
  const [modalGasto, setModalGasto] = useState(false);
  const [cartaoGasto, setCartaoGasto] = useState<Cartao | null>(null);
  const [gastoValor, setGastoValor] = useState("");
  const [gastoDesc, setGastoDesc] = useState("");
  const [gastoCat, setGastoCat] = useState("outros");
  const [gastoData, setGastoData] = useState(hojeDisplay());

  // Detalhe cartão
  const [cartaoDetalhe, setCartaoDetalhe] = useState<Cartao | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(() => {
    const db = getDB();
    setLancamentos(db.getAllSync<Lancamento>(
      "SELECT * FROM lancamentos_pessoais WHERE strftime('%Y-%m', data) = ? ORDER BY data DESC, criado_at DESC",
      [mesSel]
    ));
    setMetas(db.getAllSync<Meta>("SELECT * FROM metas_pessoais ORDER BY concluida ASC, criado_at DESC"));
    const cs = db.getAllSync<Cartao>("SELECT * FROM cartoes_pessoais ORDER BY criado_at ASC");
    setCartoes(cs);
    const gc: Record<number, GastoCartao[]> = {};
    for (const c of cs) {
      const inicio = getCicloInicio(c.dia_fechamento);
      gc[c.id] = db.getAllSync<GastoCartao>(
        "SELECT * FROM gastos_cartao WHERE cartao_id = ? AND data >= ? ORDER BY data DESC, criado_at DESC",
        [c.id, inicio]
      );
    }
    setGastosCartao(gc);
  }, [mesSel]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Cálculos gerais ─────────────────────────────────────────────────────────

  const totalReceita = lancamentos.filter(l => l.tipo === "receita").reduce((a, l) => a + l.valor, 0);
  const totalDespesa = lancamentos.filter(l => l.tipo === "despesa").reduce((a, l) => a + l.valor, 0);
  const despesasPagas = lancamentos.filter(l => l.tipo === "despesa" && l.forma_pagamento !== "cartao").reduce((a, l) => a + l.valor, 0);
  const despesasCartao = lancamentos.filter(l => l.tipo === "despesa" && l.forma_pagamento === "cartao").reduce((a, l) => a + l.valor, 0);
  const saldo = totalReceita - despesasPagas;
  const pctGasto = totalReceita > 0 ? (totalDespesa / totalReceita) * 100 : 0;
  const pctEconomia = totalReceita > 0 ? Math.max(0, ((totalReceita - totalDespesa) / totalReceita) * 100) : 0;
  const catTotais = CATEGORIAS_DESPESA.map(cat => ({
    ...cat,
    total: lancamentos.filter(l => l.tipo === "despesa" && l.categoria === cat.k).reduce((a, l) => a + l.valor, 0),
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  // ── Lançamento ────────────────────────────────────────────────────────────────

  function salvarLanc() {
    if (!valor || parseValorBR(valor) <= 0) { Alert.alert("Digite um valor válido."); return; }
    if (tipo === "despesa" && formaPgto === "cartao" && !cartaoSel) {
      Alert.alert("Selecione o cartão utilizado."); return;
    }
    const db = getDB();
    const dataISO = displayToISO(dataSel) || dataSel;
    const vlr = parseValorBR(valor);
    const fp = tipo === "despesa" ? formaPgto : "dinheiro";
    const nParc = tipo === "despesa" && formaPgto === "cartao" ? parseInt(parcelas) || 1 : 1;

    db.runSync(
      "INSERT INTO lancamentos_pessoais (tipo, valor, descricao, categoria, data, forma_pagamento, cartao_id, parcelas) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [tipo, vlr, descricao.trim(), catSel, dataISO, fp, tipo === "despesa" && formaPgto === "cartao" ? cartaoSel : null, nParc]
    );

    // Se for cartão: cria uma entrada em gastos_cartao para cada parcela no mês correto
    if (tipo === "despesa" && formaPgto === "cartao" && cartaoSel) {
      const valorParcela = vlr / nParc;
      const baseDate = new Date(dataISO);
      for (let p = 0; p < nParc; p++) {
        const d = new Date(baseDate);
        d.setMonth(d.getMonth() + p);
        const dataParc = d.toISOString().slice(0, 10);
        const descParc = nParc > 1
          ? `${descricao.trim() || "Despesa"} (${p + 1}/${nParc})`
          : descricao.trim() || "Despesa";
        db.runSync(
          "INSERT INTO gastos_cartao (cartao_id, descricao, valor, categoria, data) VALUES (?, ?, ?, ?, ?)",
          [cartaoSel, descParc, valorParcela, catSel, dataParc]
        );
      }
    }

    setValor(""); setDescricao(""); setCatSel("outros");
    setDataSel(hojeDisplay()); setFormaPgto("dinheiro"); setCartaoSel(null); setParcelas("1");
    setModalLanc(false); load();
  }

  function deletarLanc(l: Lancamento) {
    Alert.alert("Excluir lançamento?", l.descricao || fmt(l.valor), [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => { getDB().runSync("DELETE FROM lancamentos_pessoais WHERE id = ?", [l.id]); load(); } },
    ]);
  }

  // ── Meta ──────────────────────────────────────────────────────────────────────

  function salvarMeta() {
    if (!metaNome.trim() || !metaAlvo) { Alert.alert("Preencha nome e valor alvo."); return; }
    const db = getDB();
    if (metaEditando) {
      db.runSync("UPDATE metas_pessoais SET nome=?, valor_alvo=?, valor_atual=?, emoji=? WHERE id=?",
        [metaNome.trim(), parseValorBR(metaAlvo), parseValorBR(metaAtual) || 0, metaEmoji, metaEditando.id]);
    } else {
      db.runSync("INSERT INTO metas_pessoais (nome, valor_alvo, valor_atual, emoji) VALUES (?, ?, ?, ?)",
        [metaNome.trim(), parseValorBR(metaAlvo), parseValorBR(metaAtual) || 0, metaEmoji]);
    }
    fecharModalMeta(); load();
  }

  function fecharModalMeta() {
    setMetaNome(""); setMetaAlvo(""); setMetaAtual(""); setMetaEmoji("🎯");
    setMetaEditando(null); setModalMeta(false);
  }

  function editarMeta(m: Meta) {
    setMetaEditando(m); setMetaNome(m.nome); setMetaAlvo(String(m.valor_alvo));
    setMetaAtual(String(m.valor_atual)); setMetaEmoji(m.emoji); setModalMeta(true);
  }

  function aportarMeta(m: Meta, aporte: number) {
    const novo = Math.min(m.valor_atual + aporte, m.valor_alvo);
    getDB().runSync("UPDATE metas_pessoais SET valor_atual=?, concluida=? WHERE id=?",
      [novo, novo >= m.valor_alvo ? 1 : 0, m.id]);
    load();
  }

  function deletarMeta(m: Meta) {
    Alert.alert("Excluir meta?", m.nome, [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => { getDB().runSync("DELETE FROM metas_pessoais WHERE id = ?", [m.id]); load(); } },
    ]);
  }

  function toggleConcluida(m: Meta) {
    getDB().runSync("UPDATE metas_pessoais SET concluida=? WHERE id=?", [m.concluida ? 0 : 1, m.id]);
    load();
  }

  // ── Cartão ────────────────────────────────────────────────────────────────────

  function salvarCartao() {
    if (!cartaoForm.nome.trim() || !cartaoForm.limite) { Alert.alert("Preencha nome e limite."); return; }
    const db = getDB();
    const vals = [
      cartaoForm.nome.trim(), cartaoForm.bandeira,
      parseValorBR(cartaoForm.limite) || 0,
      parseInt(cartaoForm.dia_vencimento) || 10,
      parseInt(cartaoForm.dia_fechamento) || 3,
      cartaoForm.cor, cartaoForm.pontua ? 1 : 0,
      parseValorBR(cartaoForm.pontos_atuais) || 0,
      parseInt(cartaoForm.limite_alerta_pct) || 50,
      parseValorBR(cartaoForm.meta_fatura) || 0,
    ];
    if (cartaoEditando) {
      db.runSync("UPDATE cartoes_pessoais SET nome=?,bandeira=?,limite=?,dia_vencimento=?,dia_fechamento=?,cor=?,pontua=?,pontos_atuais=?,limite_alerta_pct=?,meta_fatura=? WHERE id=?",
        [...vals, cartaoEditando.id]);
    } else {
      db.runSync("INSERT INTO cartoes_pessoais (nome,bandeira,limite,dia_vencimento,dia_fechamento,cor,pontua,pontos_atuais,limite_alerta_pct,meta_fatura) VALUES (?,?,?,?,?,?,?,?,?,?)", vals);
    }
    setCartaoForm(emptyCartao); setCartaoEditando(null); setModalCartao(false); load();
  }

  function editarCartao(c: Cartao) {
    setCartaoEditando(c);
    setCartaoForm({
      nome: c.nome, bandeira: c.bandeira, limite: String(c.limite),
      dia_vencimento: String(c.dia_vencimento), dia_fechamento: String(c.dia_fechamento),
      cor: c.cor, pontua: c.pontua === 1, pontos_atuais: String(c.pontos_atuais),
      limite_alerta_pct: String(c.limite_alerta_pct),
      meta_fatura: c.meta_fatura > 0 ? String(c.meta_fatura) : "",
    });
    setModalCartao(true);
  }

  function deletarCartao(c: Cartao) {
    Alert.alert("Excluir cartão?", c.nome, [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => { getDB().runSync("DELETE FROM cartoes_pessoais WHERE id = ?", [c.id]); load(); } },
    ]);
  }

  function salvarGasto() {
    if (!gastoValor || !cartaoGasto) return;
    const gastoDataISO = displayToISO(gastoData) || gastoData;
    getDB().runSync(
      "INSERT INTO gastos_cartao (cartao_id, descricao, valor, categoria, data) VALUES (?, ?, ?, ?, ?)",
      [cartaoGasto.id, gastoDesc.trim(), parseValorBR(gastoValor), gastoCat, gastoDataISO]
    );
    setGastoValor(""); setGastoDesc(""); setGastoCat("outros");
    setGastoData(hojeDisplay());
    setModalGasto(false); load();
  }

  function deletarGasto(g: GastoCartao) {
    getDB().runSync("DELETE FROM gastos_cartao WHERE id = ?", [g.id]);
    load();
  }

  function atualizarPontos(c: Cartao, pontos: number) {
    getDB().runSync("UPDATE cartoes_pessoais SET pontos_atuais = pontos_atuais + ? WHERE id = ?", [pontos, c.id]);
    load();
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const catsAtivas = tipo === "receita" ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>💰 Finanças Pessoais</Text>
          <Text style={s.headerSub}>Controle do seu dinheiro</Text>
        </View>
        <TouchableOpacity style={s.btnAdd} onPress={() => {
          if (aba === "cartoes") setModalCartao(true);
          else if (aba === "metas") setModalMeta(true);
          else setModalLanc(true);
        }}>
          <Text style={s.btnAddText}>+ {aba === "cartoes" ? "Cartão" : aba === "metas" ? "Meta" : "Lançar"}</Text>
        </TouchableOpacity>
      </View>

      {/* Filtro de mês (só para resumo e lançamentos) */}
      {(aba === "resumo" || aba === "lancamentos") && (
        <View style={s.mesBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: "center", height: 44 }}>
            {meses.map(m => (
              <TouchableOpacity key={m.value} onPress={() => setMesSel(m.value)}
                style={[s.mesBtn, mesSel === m.value && s.mesBtnActive]}>
                <Text style={[s.mesBtnText, mesSel === m.value && { color: "#fff" }]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Abas */}
      <View style={s.abaRow}>
        {([
          ["resumo", "📊", "Resumo"],
          ["lancamentos", "📋", "Gastos"],
          ["cartoes", "💳", "Cartões"],
          ["metas", "🎯", "Metas"],
        ] as const).map(([k, emoji, label]) => (
          <TouchableOpacity key={k} onPress={() => setAba(k)} style={[s.abaBtn, aba === k && s.abaBtnActive]}>
            <Text style={{ fontSize: 16 }}>{emoji}</Text>
            <Text style={[s.abaBtnText, aba === k && s.abaBtnTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}>

        {/* ── ABA RESUMO ── */}
        {aba === "resumo" && (
          <>
            <View style={s.kpiRow}>
              <View style={[s.kpi, { backgroundColor: "#f0fdf4" }]}>
                <Text style={s.kpiLabel}>💼 Receitas</Text>
                <Text style={[s.kpiValor, { color: C.SUCCESS }]}>{fmt(totalReceita)}</Text>
              </View>
              <View style={[s.kpi, { backgroundColor: "#fff5f5" }]}>
                <Text style={s.kpiLabel}>💸 Gastos</Text>
                <Text style={[s.kpiValor, { color: C.DANGER }]}>{fmt(totalDespesa)}</Text>
              </View>
            </View>

            <View style={[s.saldoCard, { backgroundColor: saldo >= 0 ? "#f0fdf4" : "#fff5f5" }]}>
              <Text style={s.saldoLabel}>💰 Saldo disponível</Text>
              <Text style={[s.saldoValor, { color: saldo >= 0 ? C.SUCCESS : C.DANGER }]}>{fmt(saldo)}</Text>
              <Text style={{ fontSize: 11, color: C.TEXT_MUTED, marginTop: 2 }}>Receitas − despesas pagas (dinheiro/pix)</Text>
              {totalReceita > 0 && (
                <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
                  <View style={s.saldoPct}>
                    <Text style={{ fontSize: 11, color: C.TEXT_MUTED }}>Gasto</Text>
                    <Text style={{ fontWeight: "700", color: C.DANGER, fontSize: 14 }}>{fmtPct(pctGasto)}</Text>
                  </View>
                  <View style={s.saldoPct}>
                    <Text style={{ fontSize: 11, color: C.TEXT_MUTED }}>Economizado</Text>
                    <Text style={{ fontWeight: "700", color: C.SUCCESS, fontSize: 14 }}>{fmtPct(pctEconomia)}</Text>
                  </View>
                </View>
              )}
            </View>
            {despesasCartao > 0 && (
              <View style={{ backgroundColor: "#fdf2f8", borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ fontSize: 22 }}>💳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", color: "#7c3aed", fontSize: 14 }}>A pagar no cartão</Text>
                  <Text style={{ color: C.TEXT_MUTED, fontSize: 12 }}>Lançamentos deste mês no cartão</Text>
                </View>
                <Text style={{ fontWeight: "800", color: "#7c3aed", fontSize: 16 }}>{fmt(despesasCartao)}</Text>
              </View>
            )}

            {totalReceita > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>📊 Gastos vs Receita</Text>
                <View style={s.barBg}>
                  <View style={[s.barFill, {
                    width: `${Math.min(100, pctGasto)}%`,
                    backgroundColor: pctGasto > 90 ? C.DANGER : pctGasto > 70 ? C.WARNING : C.SUCCESS
                  }]} />
                </View>
                <Text style={{ fontSize: 12, color: C.TEXT_MUTED, marginTop: 4 }}>
                  {pctGasto > 90 ? "⚠️ Gastos muito altos!" : pctGasto > 70 ? "⚠️ Atenção com os gastos" : "✅ Finanças equilibradas"}
                </Text>
              </View>
            )}

            {catTotais.length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>💸 Gastos por categoria</Text>
                <View style={{ gap: 10 }}>
                  {catTotais.map(cat => {
                    const pct = totalDespesa > 0 ? (cat.total / totalDespesa) * 100 : 0;
                    return (
                      <View key={cat.k}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text style={{ fontSize: 13, fontWeight: "600", color: C.TEXT }}>{cat.l}</Text>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: cat.cor }}>{fmt(cat.total)}</Text>
                        </View>
                        <View style={s.barBg}>
                          <View style={[s.barFill, { width: `${pct}%`, backgroundColor: cat.cor }]} />
                        </View>
                        <Text style={{ fontSize: 11, color: C.TEXT_MUTED, marginTop: 2 }}>{fmtPct(pct)} dos gastos</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Alertas de cartão no resumo */}
            {cartoes.some(c => {
              const gastos = gastosCartao[c.id] ?? [];
              const fatura = gastos.reduce((a, g) => a + g.valor, 0);
              return c.limite > 0 && (fatura / c.limite) * 100 >= c.limite_alerta_pct;
            }) && (
              <View style={[s.card, { backgroundColor: "#fff7ed", borderWidth: 1.5, borderColor: "#fdba74" }]}>
                <Text style={[s.cardTitle, { color: "#c2410c" }]}>⚠️ Alertas de cartão</Text>
                {cartoes.filter(c => {
                  const fatura = (gastosCartao[c.id] ?? []).reduce((a, g) => a + g.valor, 0);
                  return c.limite > 0 && (fatura / c.limite) * 100 >= c.limite_alerta_pct;
                }).map(c => {
                  const fatura = (gastosCartao[c.id] ?? []).reduce((a, g) => a + g.valor, 0);
                  const pct = (fatura / c.limite) * 100;
                  return (
                    <Text key={c.id} style={{ fontSize: 13, color: "#c2410c", marginBottom: 4 }}>
                      {c.nome} · {fmt(fatura)} de {fmt(c.limite)} ({fmtPct(pct)})
                    </Text>
                  );
                })}
              </View>
            )}

            {lancamentos.length === 0 && cartoes.length === 0 && (
              <View style={s.empty}><Text style={s.emptyEmoji}>📭</Text><Text style={s.emptyText}>Nenhum dado ainda</Text></View>
            )}
          </>
        )}

        {/* ── ABA LANÇAMENTOS ── */}
        {aba === "lancamentos" && (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 13, color: C.TEXT_MUTED, fontWeight: "600" }}>
                {lancamentos.length} lançamento{lancamentos.length !== 1 ? "s" : ""}
              </Text>
              <TouchableOpacity style={s.btnAdd} onPress={() => setModalLanc(true)}>
                <Text style={s.btnAddText}>+ Novo</Text>
              </TouchableOpacity>
            </View>
            <View style={s.kpiRow}>
              <View style={[s.kpi, { backgroundColor: "#f0fdf4" }]}>
                <Text style={s.kpiLabel}>Receitas</Text>
                <Text style={[s.kpiValor, { color: C.SUCCESS, fontSize: 15 }]}>{fmt(totalReceita)}</Text>
              </View>
              <View style={[s.kpi, { backgroundColor: "#fff5f5" }]}>
                <Text style={s.kpiLabel}>Despesas</Text>
                <Text style={[s.kpiValor, { color: C.DANGER, fontSize: 15 }]}>{fmt(totalDespesa)}</Text>
              </View>
            </View>

            {lancamentos.length === 0 ? (
              <View style={s.empty}><Text style={s.emptyEmoji}>📭</Text><Text style={s.emptyText}>Nenhum lançamento neste mês</Text></View>
            ) : (
              lancamentos.map(l => {
                const cat = getCatInfo(l.categoria);
                return (
                  <View key={l.id} style={[s.card, { padding: 14 }]}>
                    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                      <View style={[s.tipoBadge, { backgroundColor: l.tipo === "receita" ? "#dcfce7" : "#fee2e2" }]}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: l.tipo === "receita" ? C.SUCCESS : C.DANGER }}>
                          {l.tipo === "receita" ? "▲ RECEITA" : "▼ DESPESA"}
                        </Text>
                      </View>
                      <View style={[s.catBadge, { backgroundColor: cat.cor + "20" }]}>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: cat.cor }}>{cat.l}</Text>
                      </View>
                      {l.tipo === "despesa" && l.forma_pagamento && (
                        <View style={[s.catBadge, { backgroundColor: l.forma_pagamento === "cartao" ? "#f3e8ff" : l.forma_pagamento === "pix" ? "#eff6ff" : "#f0fdf4" }]}>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: l.forma_pagamento === "cartao" ? "#7c3aed" : l.forma_pagamento === "pix" ? "#1d4ed8" : "#166534" }}>
                            {l.forma_pagamento === "cartao" ? `💳${l.parcelas && l.parcelas > 1 ? ` ${l.parcelas}x` : ""}` : l.forma_pagamento === "pix" ? "⚡ PIX" : "💵 Dinheiro"}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 8 }}>
                      <View style={{ flex: 1 }}>
                        {l.descricao ? <Text style={{ fontSize: 14, fontWeight: "700", color: C.TEXT }}>{l.descricao}</Text> : null}
                        <Text style={{ fontSize: 12, color: C.TEXT_MUTED }}>{l.data}</Text>
                        {l.forma_pagamento === "cartao" && l.cartao_id && (
                          <Text style={{ fontSize: 11, color: "#7c3aed", marginTop: 2 }}>
                            {cartoes.find(c => c.id === l.cartao_id)?.nome ?? "Cartão"}
                          </Text>
                        )}
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontSize: 18, fontWeight: "900", color: l.tipo === "receita" ? C.SUCCESS : C.DANGER }}>
                          {l.tipo === "receita" ? "+" : "-"}{fmt(l.valor)}
                        </Text>
                        <TouchableOpacity onPress={() => deletarLanc(l)}>
                          <Text style={{ fontSize: 12, color: C.DANGER, marginTop: 4 }}>🗑️ Excluir</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}

        {/* ── ABA CARTÕES ── */}
        {aba === "cartoes" && (
          <>
            {cartoes.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyEmoji}>💳</Text>
                <Text style={s.emptyText}>Nenhum cartão cadastrado</Text>
                <TouchableOpacity style={[s.btnAdd, { marginTop: 12 }]} onPress={() => setModalCartao(true)}>
                  <Text style={s.btnAddText}>+ Adicionar cartão</Text>
                </TouchableOpacity>
              </View>
            ) : (
              cartoes.map(c => {
                const gastos = gastosCartao[c.id] ?? [];
                const fatura = gastos.reduce((a, g) => a + g.valor, 0);
                const disponivel = Math.max(0, c.limite - fatura);
                const pct = c.limite > 0 ? Math.min(100, (fatura / c.limite) * 100) : 0;
                const emAlerta = c.limite > 0 && pct >= c.limite_alerta_pct;
                const temMetaFatura = c.meta_fatura > 0;
                const pctMeta = temMetaFatura ? Math.min(100, (fatura / c.meta_fatura) * 100) : 0;
                const metaAtingida = temMetaFatura && fatura >= c.meta_fatura;
                const isDetalhe = cartaoDetalhe?.id === c.id;

                return (
                  <View key={c.id}>
                    {/* Card visual */}
                    <View style={[s.cartaoCard, { backgroundColor: c.cor }]}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <View>
                          <Text style={s.cartaoNome}>{c.nome}</Text>
                          <Text style={s.cartaoBandeira}>{c.bandeira}</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          {emAlerta && <View style={s.alertaBadge}><Text style={{ color: "#92400e", fontSize: 10, fontWeight: "800" }}>⚠️ ALERTA</Text></View>}
                          {c.pontua === 1 && <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, marginTop: 4 }}>⭐ {c.pontos_atuais.toLocaleString("pt-BR")} pts</Text>}
                        </View>
                      </View>

                      <View style={{ marginTop: 16 }}>
                        <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, marginBottom: 4 }}>
                          Fatura atual · ciclo desde {new Date(getCicloInicio(c.dia_fechamento) + "T00:00:00").toLocaleDateString("pt-BR")}
                        </Text>
                        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "900" }}>{fmt(fatura)}</Text>
                        <View style={[s.barBg, { backgroundColor: "rgba(255,255,255,0.3)", marginTop: 8 }]}>
                          <View style={[s.barFill, {
                            width: `${pct}%`,
                            backgroundColor: pct >= 90 ? "#ef4444" : pct >= c.limite_alerta_pct ? "#f59e0b" : "#4ade80"
                          }]} />
                        </View>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                          <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>
                            Disponível: {fmt(disponivel)}
                          </Text>
                          <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>
                            Limite: {fmt(c.limite)} · {fmtPct(pct)}
                          </Text>
                        </View>

                        {/* Barra de meta de fatura */}
                        {temMetaFatura && (
                          <View style={{ marginTop: 12 }}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                              <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "600" }}>
                                🎯 Meta de fatura
                              </Text>
                              <Text style={{ color: metaAtingida ? "#fca5a5" : "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "700" }}>
                                {fmt(fatura)} / {fmt(c.meta_fatura)} · {fmtPct(pctMeta)}
                              </Text>
                            </View>
                            <View style={[s.barBg, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                              <View style={[s.barFill, {
                                width: `${pctMeta}%`,
                                backgroundColor: metaAtingida ? "#ef4444" : pctMeta >= 80 ? "#f59e0b" : "#a78bfa"
                              }]} />
                            </View>
                            {metaAtingida && (
                              <Text style={{ color: "#fca5a5", fontSize: 11, fontWeight: "700", marginTop: 4 }}>
                                🚫 Meta de fatura atingida! Evite novos gastos neste cartão.
                              </Text>
                            )}
                          </View>
                        )}
                      </View>

                      <View style={{ flexDirection: "row", marginTop: 16, gap: 8 }}>
                        <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
                          Fecha dia {c.dia_fechamento} · Vence dia {c.dia_vencimento}
                        </Text>
                      </View>
                      <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 2 }}>
                        Próximo vencimento: {getProxVencimento(c.dia_vencimento)}
                      </Text>
                    </View>

                    {/* Botões de ação */}
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                      <TouchableOpacity style={[s.btnAcao, { flex: 2, backgroundColor: "#f0fdf4" }]}
                        onPress={() => { setCartaoGasto(c); setGastoValor(""); setGastoDesc(""); setGastoCat("outros"); setGastoData(hojeDisplay()); setModalGasto(true); }}>
                        <Text style={{ color: C.SUCCESS, fontWeight: "700", fontSize: 13 }}>+ Lançar gasto</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.btnAcao, { flex: 1 }]} onPress={() => setCartaoDetalhe(isDetalhe ? null : c)}>
                        <Text style={{ color: C.TEXT_MUTED, fontWeight: "600", fontSize: 12 }}>{isDetalhe ? "Fechar" : "📋 Fatura"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.btnAcao, { backgroundColor: "#fffbeb" }]} onPress={() => editarCartao(c)}>
                        <Text style={{ fontSize: 14 }}>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.btnAcao, { backgroundColor: "#fff5f5" }]} onPress={() => deletarCartao(c)}>
                        <Text style={{ fontSize: 14 }}>🗑️</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Detalhes da fatura */}
                    {isDetalhe && (
                      <View style={[s.card, { marginTop: 8 }]}>
                        <Text style={s.cardTitle}>📋 Fatura atual ({gastos.length} lançamentos)</Text>
                        {gastos.length === 0 ? (
                          <Text style={{ color: C.TEXT_MUTED, fontSize: 13, textAlign: "center", padding: 12 }}>Nenhum gasto neste ciclo</Text>
                        ) : (
                          gastos.map(g => {
                            const cat = getCatInfo(g.categoria);
                            return (
                              <View key={g.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.BORDER, gap: 8 }}>
                                <View style={[s.catBadge, { backgroundColor: cat.cor + "20" }]}>
                                  <Text style={{ fontSize: 10, color: cat.cor, fontWeight: "700" }}>{cat.l}</Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                  {g.descricao ? <Text style={{ fontSize: 13, fontWeight: "600", color: C.TEXT }}>{g.descricao}</Text> : null}
                                  <Text style={{ fontSize: 11, color: C.TEXT_MUTED }}>{g.data}</Text>
                                </View>
                                <Text style={{ fontSize: 14, fontWeight: "800", color: C.DANGER }}>{fmt(g.valor)}</Text>
                                <TouchableOpacity onPress={() => deletarGasto(g)}>
                                  <Text style={{ color: C.DANGER, fontSize: 13 }}>✕</Text>
                                </TouchableOpacity>
                              </View>
                            );
                          })
                        )}
                        {gastos.length > 0 && (
                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTopWidth: 2, borderTopColor: C.TEXT }}>
                            <Text style={{ fontWeight: "800", color: C.TEXT }}>Total da fatura</Text>
                            <Text style={{ fontWeight: "900", color: C.DANGER, fontSize: 16 }}>{fmt(fatura)}</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Alerta de limite */}
                    {emAlerta && (
                      <View style={[s.card, { backgroundColor: "#fffbeb", borderWidth: 1.5, borderColor: "#fcd34d", marginTop: 6 }]}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: "#92400e" }}>
                          ⚠️ Você atingiu {fmtPct(pct)} do limite (alerta em {c.limite_alerta_pct}%)
                        </Text>
                        <Text style={{ fontSize: 12, color: "#b45309", marginTop: 4 }}>
                          Disponível: {fmt(disponivel)} de {fmt(c.limite)}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </>
        )}

        {/* ── ABA METAS ── */}
        {aba === "metas" && (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 13, color: C.TEXT_MUTED, fontWeight: "600" }}>
                {metas.filter(m => !m.concluida).length} ativa{metas.filter(m => !m.concluida).length !== 1 ? "s" : ""}
              </Text>
              <TouchableOpacity style={s.btnAdd} onPress={() => setModalMeta(true)}>
                <Text style={s.btnAddText}>+ Nova meta</Text>
              </TouchableOpacity>
            </View>

            {metas.length === 0 ? (
              <View style={s.empty}><Text style={s.emptyEmoji}>🎯</Text><Text style={s.emptyText}>Nenhuma meta cadastrada</Text></View>
            ) : (
              metas.map(m => {
                const pct = m.valor_alvo > 0 ? Math.min(100, (m.valor_atual / m.valor_alvo) * 100) : 0;
                return (
                  <View key={m.id} style={[s.card, m.concluida ? { opacity: 0.7 } : {}]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <Text style={{ fontSize: 30 }}>{m.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: "800", color: C.TEXT }}>{m.nome}</Text>
                        <Text style={{ fontSize: 13, color: C.TEXT_MUTED }}>Meta: {fmt(m.valor_alvo)}</Text>
                      </View>
                      {m.concluida ? <Text style={{ fontSize: 22 }}>✅</Text> : null}
                    </View>
                    <View style={s.barBg}>
                      <View style={[s.barFill, { width: `${pct}%`, backgroundColor: m.concluida ? C.SUCCESS : C.BRAND }]} />
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: C.BRAND }}>{fmt(m.valor_atual)} guardado</Text>
                      <Text style={{ fontSize: 12, color: C.TEXT_MUTED }}>
                        {m.concluida ? "✅ Concluída!" : `Falta ${fmt(Math.max(0, m.valor_alvo - m.valor_atual))}`} · {pct.toFixed(0)}%
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                      {!m.concluida && (
                        <TouchableOpacity style={[s.metaBtn, { backgroundColor: "#f0fdf4", flex: 1 }]}
                          onPress={() => { setMetaAportando(m); setAporteValor(""); setModalAporte(true); }}>
                          <Text style={{ color: C.SUCCESS, fontWeight: "700", fontSize: 12 }}>+ Aportar</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={[s.metaBtn, { flex: 1 }]} onPress={() => editarMeta(m)}>
                        <Text style={{ color: C.TEXT_MUTED, fontWeight: "700", fontSize: 12 }}>✏️ Editar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.metaBtn, { flex: 1 }]} onPress={() => toggleConcluida(m)}>
                        <Text style={{ color: m.concluida ? C.WARNING : C.SUCCESS, fontWeight: "700", fontSize: 12 }}>
                          {m.concluida ? "↩️ Reabrir" : "✅ Concluir"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.metaBtn, { backgroundColor: "#fff5f5" }]} onPress={() => deletarMeta(m)}>
                        <Text style={{ color: C.DANGER, fontWeight: "700", fontSize: 12 }}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}

      </ScrollView>

      {/* ── Modal Lançamento ── */}
      <Modal visible={modalLanc} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalLanc(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Novo Lançamento</Text>
              <TouchableOpacity onPress={() => setModalLanc(false)}><Text style={s.modalClose}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
              <View style={s.tipoSwitch}>
                <TouchableOpacity style={[s.tipoBtn, tipo === "receita" && { backgroundColor: C.SUCCESS }]}
                  onPress={() => { setTipo("receita"); setCatSel("salario"); }}>
                  <Text style={[s.tipoBtnText, tipo === "receita" && { color: "#fff" }]}>▲ Receita</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.tipoBtn, tipo === "despesa" && { backgroundColor: C.DANGER }]}
                  onPress={() => { setTipo("despesa"); setCatSel("outros"); }}>
                  <Text style={[s.tipoBtnText, tipo === "despesa" && { color: "#fff" }]}>▼ Despesa</Text>
                </TouchableOpacity>
              </View>
              <FLabel label="Valor (R$)">
                <TextInput style={[s.input, { fontSize: 22, fontWeight: "700" }]} value={valor} onChangeText={setValor}
                  keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={C.TEXT_MUTED} autoFocus />
              </FLabel>
              <FLabel label="Descrição (opcional)">
                <TextInput style={s.input} value={descricao} onChangeText={setDescricao} placeholderTextColor={C.TEXT_MUTED} />
              </FLabel>
              <FLabel label="Data">
                <TextInput style={s.input} value={dataSel}
                  onChangeText={v => setDataSel(maskData(v))}
                  placeholder="DD/MM/AAAA" placeholderTextColor={C.TEXT_MUTED} keyboardType="number-pad" />
              </FLabel>
              <FLabel label="Categoria">
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                  {catsAtivas.map(c => (
                    <TouchableOpacity key={c.k} onPress={() => setCatSel(c.k)}
                      style={[s.catBtn, catSel === c.k && { backgroundColor: c.cor, borderColor: c.cor }]}>
                      <Text style={[s.catBtnText, catSel === c.k && { color: "#fff" }]}>{c.l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FLabel>

              {/* Forma de pagamento — só para despesas */}
              {tipo === "despesa" && (
                <FLabel label="Forma de pagamento">
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {([
                      { k: "dinheiro", l: "💵 Dinheiro" },
                      { k: "pix", l: "⚡ PIX" },
                      { k: "cartao", l: "💳 Cartão" },
                    ] as const).map(fp => (
                      <TouchableOpacity key={fp.k} onPress={() => { setFormaPgto(fp.k); if (fp.k !== "cartao") setCartaoSel(null); }}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 2, alignItems: "center",
                          borderColor: formaPgto === fp.k ? C.BRAND : C.BORDER,
                          backgroundColor: formaPgto === fp.k ? C.BRAND + "15" : C.BG }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: formaPgto === fp.k ? C.BRAND : C.TEXT_MUTED }}>
                          {fp.l}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Seletor de cartão */}
                  {formaPgto === "cartao" && (
                    <View style={{ marginTop: 10, gap: 8 }}>
                      {cartoes.length === 0 ? (
                        <Text style={{ color: C.TEXT_MUTED, fontSize: 12, textAlign: "center" }}>
                          Nenhum cartão cadastrado. Adicione um na aba Cartões.
                        </Text>
                      ) : (
                        <>
                          <Text style={{ fontSize: 12, color: C.TEXT_MUTED }}>Qual cartão?</Text>
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                            {cartoes.map(c => (
                              <TouchableOpacity key={c.id} onPress={() => setCartaoSel(c.id)}
                                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 2,
                                  borderColor: cartaoSel === c.id ? c.cor : C.BORDER,
                                  backgroundColor: cartaoSel === c.id ? c.cor + "20" : C.BG }}>
                                <Text style={{ fontWeight: "700", fontSize: 12,
                                  color: cartaoSel === c.id ? c.cor : C.TEXT }}>
                                  {c.nome}
                                </Text>
                                <Text style={{ fontSize: 10, color: C.TEXT_MUTED }}>{c.bandeira}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 }}>
                            <Text style={{ fontSize: 12, color: C.TEXT_MUTED }}>Parcelas:</Text>
                            {["1", "2", "3", "6", "10", "12"].map(p => (
                              <TouchableOpacity key={p} onPress={() => setParcelas(p)}
                                style={{ width: 36, height: 36, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center",
                                  borderColor: parcelas === p ? C.BRAND : C.BORDER,
                                  backgroundColor: parcelas === p ? C.BRAND + "15" : C.BG }}>
                                <Text style={{ fontWeight: "700", fontSize: 12, color: parcelas === p ? C.BRAND : C.TEXT_MUTED }}>{p}x</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          {parseValorBR(valor) > 0 && parseInt(parcelas) > 1 && (
                            <View style={{ backgroundColor: "#fdf2f8", borderRadius: 8, padding: 8 }}>
                              <Text style={{ color: "#7c3aed", fontWeight: "600", fontSize: 12 }}>
                                {parcelas}x de {fmt(parseValorBR(valor) / (parseInt(parcelas) || 1))}
                              </Text>
                            </View>
                          )}
                        </>
                      )}
                    </View>
                  )}

                  {(formaPgto === "dinheiro" || formaPgto === "pix") && (
                    <View style={{ backgroundColor: "#f0fdf4", borderRadius: 8, padding: 8, marginTop: 8 }}>
                      <Text style={{ color: C.SUCCESS, fontSize: 12, fontWeight: "600" }}>
                        ✅ Já pago — será descontado do seu saldo
                      </Text>
                    </View>
                  )}
                </FLabel>
              )}

              <TouchableOpacity style={[s.btnSalvar, !valor && { opacity: 0.5 }]} onPress={salvarLanc} disabled={!valor}>
                <Text style={s.btnSalvarText}>💾 Salvar</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Modal Cartão ── */}
      <Modal visible={modalCartao} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setModalCartao(false); setCartaoEditando(null); setCartaoForm(emptyCartao); }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{cartaoEditando ? "Editar Cartão" : "Novo Cartão"}</Text>
              <TouchableOpacity onPress={() => { setModalCartao(false); setCartaoEditando(null); setCartaoForm(emptyCartao); }}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
              {/* Preview do cartão */}
              <View style={[s.cartaoCard, { backgroundColor: cartaoForm.cor }]}>
                <Text style={s.cartaoNome}>{cartaoForm.nome || "Nome do cartão"}</Text>
                <Text style={s.cartaoBandeira}>{cartaoForm.bandeira}</Text>
                <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 12, fontSize: 13 }}>
                  Fecha dia {cartaoForm.dia_fechamento} · Vence dia {cartaoForm.dia_vencimento}
                </Text>
                <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 15, fontWeight: "700", marginTop: 4 }}>
                  Limite: {fmt(parseValorBR(cartaoForm.limite) || 0)}
                </Text>
              </View>

              <FLabel label="Nome do cartão">
                <TextInput style={s.input} value={cartaoForm.nome} onChangeText={v => setCartaoForm({ ...cartaoForm, nome: v })}
                  placeholder="Ex: Nubank, Inter, BB" placeholderTextColor={C.TEXT_MUTED} />
              </FLabel>

              <FLabel label="Bandeira">
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {BANDEIRAS.map(b => (
                    <TouchableOpacity key={b} onPress={() => setCartaoForm({ ...cartaoForm, bandeira: b })}
                      style={[s.catBtn, cartaoForm.bandeira === b && { backgroundColor: C.BRAND, borderColor: C.BRAND }]}>
                      <Text style={[s.catBtnText, cartaoForm.bandeira === b && { color: "#fff" }]}>{b}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FLabel>

              <FLabel label="Cor do cartão">
                <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                  {CORES_CARTAO.map(cor => (
                    <TouchableOpacity key={cor} onPress={() => setCartaoForm({ ...cartaoForm, cor })}
                      style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: cor, borderWidth: 3, borderColor: cartaoForm.cor === cor ? C.TEXT : "transparent" }} />
                  ))}
                </View>
              </FLabel>

              <FLabel label="Limite (R$)">
                <TextInput style={s.input} value={cartaoForm.limite} onChangeText={v => setCartaoForm({ ...cartaoForm, limite: v })}
                  keyboardType="decimal-pad" placeholder="Ex: 5000" placeholderTextColor={C.TEXT_MUTED} />
              </FLabel>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <FLabel label="Dia fechamento">
                    <TextInput style={s.input} value={cartaoForm.dia_fechamento} onChangeText={v => setCartaoForm({ ...cartaoForm, dia_fechamento: v })}
                      keyboardType="number-pad" placeholder="Ex: 3" placeholderTextColor={C.TEXT_MUTED} />
                  </FLabel>
                </View>
                <View style={{ flex: 1 }}>
                  <FLabel label="Dia vencimento">
                    <TextInput style={s.input} value={cartaoForm.dia_vencimento} onChangeText={v => setCartaoForm({ ...cartaoForm, dia_vencimento: v })}
                      keyboardType="number-pad" placeholder="Ex: 10" placeholderTextColor={C.TEXT_MUTED} />
                  </FLabel>
                </View>
              </View>

              <FLabel label={`⚠️ Alertar ao atingir (%) do limite`}>
                <TextInput style={s.input} value={cartaoForm.limite_alerta_pct} onChangeText={v => setCartaoForm({ ...cartaoForm, limite_alerta_pct: v })}
                  keyboardType="number-pad" placeholder="Ex: 50" placeholderTextColor={C.TEXT_MUTED} />
                <Text style={{ fontSize: 12, color: C.TEXT_MUTED, marginTop: 4 }}>
                  Alerta quando gastar mais de {cartaoForm.limite_alerta_pct || "50"}% do limite ({fmt((parseValorBR(cartaoForm.limite) || 0) * ((parseInt(cartaoForm.limite_alerta_pct) || 50) / 100))})
                </Text>
              </FLabel>

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: C.CARD, borderRadius: 12, padding: 14 }}>
                <View>
                  <Text style={{ fontWeight: "700", color: C.TEXT, fontSize: 14 }}>⭐ Pontua</Text>
                  <Text style={{ fontSize: 12, color: C.TEXT_MUTED }}>Este cartão acumula pontos/milhas</Text>
                </View>
                <TouchableOpacity onPress={() => setCartaoForm({ ...cartaoForm, pontua: !cartaoForm.pontua })}
                  style={[{ width: 48, height: 28, borderRadius: 14, justifyContent: "center", paddingHorizontal: 3 }, cartaoForm.pontua ? { backgroundColor: C.BRAND } : { backgroundColor: C.BORDER }]}>
                  <View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" }, cartaoForm.pontua ? { alignSelf: "flex-end" } : { alignSelf: "flex-start" }]} />
                </TouchableOpacity>
              </View>

              {cartaoForm.pontua && (
                <FLabel label="Pontos atuais">
                  <TextInput style={s.input} value={cartaoForm.pontos_atuais} onChangeText={v => setCartaoForm({ ...cartaoForm, pontos_atuais: v })}
                    keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.TEXT_MUTED} />
                </FLabel>
              )}

              <View style={{ height: 1, backgroundColor: C.BORDER, marginVertical: 4 }} />
              <FLabel label="🎯 Meta de gasto por fatura (R$)">
                <TextInput style={s.input} value={cartaoForm.meta_fatura}
                  onChangeText={v => setCartaoForm({ ...cartaoForm, meta_fatura: v })}
                  keyboardType="decimal-pad" placeholder="Ex: 2000,00 (deixe vazio para não usar)"
                  placeholderTextColor={C.TEXT_MUTED} />
                <Text style={{ fontSize: 11, color: C.TEXT_MUTED, marginTop: 4 }}>
                  Quando a fatura atingir este valor você receberá um alerta para não gastar mais neste cartão.
                </Text>
              </FLabel>

              <TouchableOpacity style={s.btnSalvar} onPress={salvarCartao}>
                <Text style={s.btnSalvarText}>{cartaoEditando ? "💾 Salvar alterações" : "💳 Adicionar cartão"}</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Modal Gasto no Cartão ── */}
      <Modal visible={modalGasto} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalGasto(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>💳 Gasto em {cartaoGasto?.nome}</Text>
              <TouchableOpacity onPress={() => setModalGasto(false)}><Text style={s.modalClose}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
              {cartaoGasto && (() => {
                const gastos = gastosCartao[cartaoGasto.id] ?? [];
                const fatura = gastos.reduce((a, g) => a + g.valor, 0);
                const disponivel = Math.max(0, cartaoGasto.limite - fatura);
                return (
                  <View style={[s.card, { backgroundColor: "#f0fdf4" }]}>
                    <Text style={{ fontSize: 12, color: C.TEXT_MUTED }}>Disponível neste ciclo</Text>
                    <Text style={{ fontSize: 22, fontWeight: "900", color: C.SUCCESS }}>{fmt(disponivel)}</Text>
                    <Text style={{ fontSize: 11, color: C.TEXT_MUTED }}>Fatura: {fmt(fatura)} / {fmt(cartaoGasto.limite)}</Text>
                  </View>
                );
              })()}
              <FLabel label="Valor (R$)">
                <TextInput style={[s.input, { fontSize: 22, fontWeight: "700" }]} value={gastoValor} onChangeText={setGastoValor}
                  keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={C.TEXT_MUTED} autoFocus />
              </FLabel>
              <FLabel label="Descrição (opcional)">
                <TextInput style={s.input} value={gastoDesc} onChangeText={setGastoDesc}
                  placeholder="Ex: Supermercado" placeholderTextColor={C.TEXT_MUTED} />
              </FLabel>
              <FLabel label="Data">
                <TextInput style={s.input} value={gastoData}
                  onChangeText={v => setGastoData(maskData(v))}
                  placeholder="DD/MM/AAAA" placeholderTextColor={C.TEXT_MUTED} keyboardType="number-pad" />
              </FLabel>
              <FLabel label="Categoria">
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                  {CATEGORIAS_DESPESA.map(c => (
                    <TouchableOpacity key={c.k} onPress={() => setGastoCat(c.k)}
                      style={[s.catBtn, gastoCat === c.k && { backgroundColor: c.cor, borderColor: c.cor }]}>
                      <Text style={[s.catBtnText, gastoCat === c.k && { color: "#fff" }]}>{c.l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FLabel>
              <TouchableOpacity style={[s.btnSalvar, !gastoValor && { opacity: 0.5 }]} onPress={salvarGasto} disabled={!gastoValor}>
                <Text style={s.btnSalvarText}>💳 Registrar gasto</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Modal Aporte ── */}
      <Modal visible={modalAporte} animationType="fade" transparent onRequestClose={() => setModalAporte(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 32 }}>
          <View style={{ backgroundColor: C.CARD, borderRadius: 20, padding: 24, gap: 14 }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: C.TEXT }}>+ Aportar em {metaAportando?.nome}</Text>
            <Text style={{ fontSize: 13, color: C.TEXT_MUTED }}>
              Guardado: {fmt(metaAportando?.valor_atual ?? 0)} · Falta: {fmt(Math.max(0, (metaAportando?.valor_alvo ?? 0) - (metaAportando?.valor_atual ?? 0)))}
            </Text>
            <TextInput style={s.input} value={aporteValor} onChangeText={setAporteValor}
              keyboardType="decimal-pad" placeholder="Valor a aportar (R$)" placeholderTextColor={C.TEXT_MUTED} autoFocus />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity style={[s.btnSalvar, { flex: 1, paddingVertical: 12 }]}
                onPress={() => {
                  const n = parseValorBR(aporteValor) || 0;
                  if (n > 0 && metaAportando) aportarMeta(metaAportando, n);
                  setModalAporte(false);
                }}>
                <Text style={s.btnSalvarText}>Confirmar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.metaBtn, { paddingVertical: 12, paddingHorizontal: 20 }]} onPress={() => setModalAporte(false)}>
                <Text style={{ fontWeight: "700", color: C.TEXT_MUTED }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal Meta ── */}
      <Modal visible={modalMeta} animationType="slide" presentationStyle="pageSheet" onRequestClose={fecharModalMeta}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{metaEditando ? "Editar Meta" : "Nova Meta"}</Text>
              <TouchableOpacity onPress={fecharModalMeta}><Text style={s.modalClose}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
              <FLabel label="Emoji">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {EMOJIS_META.map(e => (
                    <TouchableOpacity key={e} onPress={() => setMetaEmoji(e)}
                      style={[s.emojiBtn, metaEmoji === e && { borderColor: C.BRAND }]}>
                      <Text style={{ fontSize: 24 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </FLabel>
              <FLabel label="Nome da meta">
                <TextInput style={s.input} value={metaNome} onChangeText={setMetaNome}
                  placeholder="Ex: Comprar notebook" placeholderTextColor={C.TEXT_MUTED} />
              </FLabel>
              <FLabel label="Valor alvo (R$)">
                <TextInput style={s.input} value={metaAlvo} onChangeText={setMetaAlvo}
                  keyboardType="decimal-pad" placeholder="Ex: 3000" placeholderTextColor={C.TEXT_MUTED} />
              </FLabel>
              <FLabel label="Já tenho guardado (R$)">
                <TextInput style={s.input} value={metaAtual} onChangeText={setMetaAtual}
                  keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.TEXT_MUTED} />
              </FLabel>
              <TouchableOpacity style={s.btnSalvar} onPress={salvarMeta}>
                <Text style={s.btnSalvarText}>{metaEditando ? "💾 Salvar" : "🎯 Criar meta"}</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

// ── Componente auxiliar ────────────────────────────────────────────────────────
function FLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={{ fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      {children}
    </View>
  );
}

// ── Estilos ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.BORDER, backgroundColor: C.CARD },
  headerTitle: { fontSize: 20, fontWeight: "800", color: C.TEXT },
  headerSub: { fontSize: 12, color: C.TEXT_MUTED, marginTop: 1 },
  mesBar: { height: 44, backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  mesBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, height: 32, justifyContent: "center" as const },
  mesBtnActive: { backgroundColor: C.BRAND, borderColor: C.BRAND },
  mesBtnText: { fontSize: 12, fontWeight: "600" as const, color: C.TEXT_MUTED },
  abaRow: { flexDirection: "row", backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  abaBtn: { flex: 1, paddingVertical: 8, alignItems: "center", gap: 2, borderBottomWidth: 2, borderBottomColor: "transparent" },
  abaBtnActive: { borderBottomColor: C.BRAND },
  abaBtnText: { fontSize: 10, fontWeight: "700", color: C.TEXT_MUTED, textTransform: "uppercase" },
  abaBtnTextActive: { color: C.BRAND },
  kpiRow: { flexDirection: "row", gap: 10 },
  kpi: { flex: 1, borderRadius: 14, padding: 14 },
  kpiLabel: { fontSize: 12, color: C.TEXT_MUTED, fontWeight: "600", marginBottom: 4 },
  kpiValor: { fontSize: 18, fontWeight: "900" },
  saldoCard: { borderRadius: 16, padding: 20, alignItems: "center" },
  saldoLabel: { fontSize: 13, color: C.TEXT_MUTED, fontWeight: "700", textTransform: "uppercase" },
  saldoValor: { fontSize: 40, fontWeight: "900", marginTop: 4 },
  saldoPct: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.6)", borderRadius: 10, padding: 10, minWidth: 90 },
  card: { backgroundColor: C.CARD, borderRadius: 16, padding: 16 },
  cardTitle: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  barBg: { height: 8, backgroundColor: C.BORDER, borderRadius: 4, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  tipoBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  catBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  metaBtn: { backgroundColor: C.BG, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, alignItems: "center", borderWidth: 1, borderColor: C.BORDER },
  // Cartão
  cartaoCard: { borderRadius: 20, padding: 20, minHeight: 160 },
  cartaoNome: { fontSize: 20, fontWeight: "900", color: "#fff" },
  cartaoBandeira: { fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  alertaBadge: { backgroundColor: "#fef3c7", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  btnAcao: { backgroundColor: C.BG, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignItems: "center", borderWidth: 1, borderColor: C.BORDER },
  // Geral
  empty: { alignItems: "center", padding: 48 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: C.TEXT_MUTED },
  btnAdd: { backgroundColor: C.BRAND, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  btnAddText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: C.BORDER, backgroundColor: C.CARD },
  modalTitle: { fontSize: 18, fontWeight: "800", color: C.TEXT },
  modalClose: { fontSize: 18, color: C.TEXT_MUTED, padding: 4 },
  input: { backgroundColor: C.CARD, borderWidth: 1, borderColor: C.BORDER, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: C.TEXT },
  tipoSwitch: { flexDirection: "row", gap: 10 },
  tipoBtn: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 14, backgroundColor: C.CARD, borderWidth: 2, borderColor: C.BORDER },
  tipoBtnText: { fontSize: 15, fontWeight: "800", color: C.TEXT_MUTED },
  catBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: C.CARD, borderWidth: 1.5, borderColor: C.BORDER },
  catBtnText: { fontSize: 12, fontWeight: "600", color: C.TEXT },
  btnSalvar: { backgroundColor: C.BRAND, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  btnSalvarText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  emojiBtn: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.CARD, borderWidth: 2, borderColor: "transparent" },
});
