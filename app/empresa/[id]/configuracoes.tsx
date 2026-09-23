import { useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  Alert, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDB } from "@/lib/db";
import * as C from "@/constants/colors";
import { parseValorBR } from "@/lib/numero";

interface Config {
  regime: string; anexo: string; aliquota_custom: number;
  taxa_debito: number; taxa_credito: number; taxa_pix: number; taxa_dinheiro: number;
  funcionarios_custo: number; funcionarios_qtd: number; perdas_pct: number;
  funcionarios_metodo: "producao_mensal" | "tempo_preparo" | "percentual_ingredientes";
  funcionarios_modo_custo: "cargos" | "manual";
  funcionarios_qtd_pessoas: number;
  funcionarios_dias_trabalhados: number; funcionarios_horas_dia: number;
  funcionarios_percentual_ingredientes: number;
}
interface GastoItem { id: number; nome: string; valor: number; }
interface Cargo { id: number; nome: string; tipo: "clt" | "pj" | "informal"; salario: number; quantidade: number; }

// Encargos CLT sobre salário bruto: 13º (8.33%) + férias+1/3 (11.11%) + FGTS (8%) + INSS patronal (20%) + RAT (2%) + Sistema S (5.8%)
const ENCARGOS_CLT = 0.5524;
function custoRealCargo(cargo: Cargo): number {
  const base = cargo.salario * cargo.quantidade;
  return cargo.tipo === "clt" ? base * (1 + ENCARGOS_CLT) : base;
}

const ALIQ: Record<string, number> = {
  "simples_nacional-I": 4.0, "simples_nacional-II": 4.5, "simples_nacional-III": 6.0,
  "simples_nacional-IV": 6.0, "simples_nacional-V": 15.5, "simples_nacional-VI": 16.93,
  lucro_presumido: 13.33, lucro_real: 34, mei: 0,
};

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ConfiguracoesScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const empresaId = Number(id);

  const [cfgForm, setCfgForm] = useState<Config>({
    regime: "simples_nacional", anexo: "I", aliquota_custom: 6,
    taxa_debito: 2, taxa_credito: 3.5, taxa_pix: 0, taxa_dinheiro: 0,
    funcionarios_custo: 0, funcionarios_qtd: 100, perdas_pct: 5,
    funcionarios_metodo: "producao_mensal", funcionarios_dias_trabalhados: 30, funcionarios_horas_dia: 8,
    funcionarios_modo_custo: "cargos", funcionarios_qtd_pessoas: 1,
    funcionarios_percentual_ingredientes: 30,
  });
  const [gastos, setGastos] = useState<GastoItem[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [novoGasto, setNovoGasto] = useState({ nome: "", valor: "" });
  const [modalCargo, setModalCargo] = useState(false);
  const [cargoForm, setCargoForm] = useState<{ nome: string; tipo: "clt" | "pj" | "informal"; salario: string; quantidade: string }>({ nome: "", tipo: "clt", salario: "", quantidade: "1" });
  const [cargoEditando, setCargoEditando] = useState<Cargo | null>(null);

  const gastosMensal = gastos.reduce((a, g) => a + g.valor, 0);
  const gastosPorProduto = cfgForm.funcionarios_qtd > 0 ? gastosMensal / cfgForm.funcionarios_qtd : 0;
  const modoManual = cfgForm.funcionarios_modo_custo === "manual";
  // No modo "cargos", custo e quantidade de gente vêm da soma dos cargos
  // cadastrados. No modo "manual", vêm dos campos digitados direto.
  const totalFuncionarios = modoManual ? (cfgForm.funcionarios_qtd_pessoas || 1) : cargos.reduce((a, c) => a + c.quantidade, 0);
  const totalCustoFuncionarios = modoManual ? cfgForm.funcionarios_custo : cargos.reduce((a, c) => a + custoRealCargo(c), 0);
  const custoHoraFuncionario = cfgForm.funcionarios_dias_trabalhados > 0 && cfgForm.funcionarios_horas_dia > 0 && totalFuncionarios > 0
    ? totalCustoFuncionarios / cfgForm.funcionarios_dias_trabalhados / (cfgForm.funcionarios_horas_dia * totalFuncionarios)
    : 0;

  const load = useCallback(() => {
    const db = getDB();
    const c = db.getFirstSync<Config>("SELECT * FROM configuracoes_empresa WHERE empresa_id = ?", [empresaId]);
    if (c) setCfgForm(c);
    setGastos(db.getAllSync<GastoItem>("SELECT * FROM gastos_variaveis WHERE empresa_id = ? ORDER BY nome", [empresaId]));
    setCargos(db.getAllSync<Cargo>("SELECT * FROM cargos_funcionarios WHERE empresa_id = ? ORDER BY nome", [empresaId]));
  }, [empresaId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function salvarConfig() {
    getDB().runSync(
      `UPDATE configuracoes_empresa SET regime=?,anexo=?,aliquota_custom=?,taxa_debito=?,taxa_credito=?,taxa_pix=?,taxa_dinheiro=?,funcionarios_qtd=?,perdas_pct=?,funcionarios_metodo=?,funcionarios_modo_custo=?,funcionarios_custo=?,funcionarios_qtd_pessoas=?,funcionarios_dias_trabalhados=?,funcionarios_horas_dia=?,funcionarios_percentual_ingredientes=? WHERE empresa_id=?`,
      [cfgForm.regime, cfgForm.anexo, cfgForm.aliquota_custom, cfgForm.taxa_debito, cfgForm.taxa_credito, cfgForm.taxa_pix, cfgForm.taxa_dinheiro, cfgForm.funcionarios_qtd, cfgForm.perdas_pct,
       cfgForm.funcionarios_metodo, cfgForm.funcionarios_modo_custo, cfgForm.funcionarios_custo, cfgForm.funcionarios_qtd_pessoas, cfgForm.funcionarios_dias_trabalhados, cfgForm.funcionarios_horas_dia, cfgForm.funcionarios_percentual_ingredientes, empresaId]);
    Alert.alert("✅ Configurações salvas!");
  }

  function addGasto() {
    if (!novoGasto.nome.trim() || !novoGasto.valor) return;
    getDB().runSync("INSERT INTO gastos_variaveis (empresa_id, nome, valor) VALUES (?, ?, ?)", [empresaId, novoGasto.nome.trim(), parseValorBR(novoGasto.valor)]);
    setNovoGasto({ nome: "", valor: "" }); load();
  }

  function deletarGasto(g: GastoItem) {
    getDB().runSync("DELETE FROM gastos_variaveis WHERE id = ?", [g.id]);
    load();
  }

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
    const sal = parseValorBR(cargoForm.salario) || 0;
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

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>‹</Text></TouchableOpacity>
        <Text style={s.headerTitle}>⚙️ Configurações</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={s.infoBanner}>
            <Text style={s.infoText}>💡 Configurações exclusivas desta empresa. Aplicadas automaticamente em Precificação e no DRE.</Text>
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
                  <CfgField label="Alíquota personalizada (%)" value={cfgForm.aliquota_custom}
                    onChange={v => setCfgForm({ ...cfgForm, aliquota_custom: v })} />
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
                <CfgField label="Alíquota total (%)" value={cfgForm.aliquota_custom}
                  onChange={v => setCfgForm({ ...cfgForm, aliquota_custom: v })} />
              </View>
            )}
          </View>

          {/* Taxas de pagamento */}
          <View style={s.card}>
            <Text style={s.cardTitle}>💳 Taxas de Pagamento</Text>
            <Text style={s.cardSub}>Taxas cobradas por cada forma de recebimento</Text>
            <View style={{ gap: 10 }}>
              <CfgField label="💳 Débito (%)" value={cfgForm.taxa_debito} onChange={v => setCfgForm({ ...cfgForm, taxa_debito: v })} />
              <CfgField label="💳 Crédito à vista (%)" value={cfgForm.taxa_credito} onChange={v => setCfgForm({ ...cfgForm, taxa_credito: v })} />
              <CfgField label="💰 PIX (%)" value={cfgForm.taxa_pix} onChange={v => setCfgForm({ ...cfgForm, taxa_pix: v })} />
              <CfgField label="💵 Dinheiro (%)" value={cfgForm.taxa_dinheiro} onChange={v => setCfgForm({ ...cfgForm, taxa_dinheiro: v })} />
            </View>
          </View>

          {/* Funcionários */}
          <View style={s.card}>
            <Text style={s.cardTitle}>👥 Funcionários</Text>
            <Text style={s.cardSub}>Como você quer informar o custo?</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              <TouchableOpacity onPress={() => setCfgForm({ ...cfgForm, funcionarios_modo_custo: "cargos" })}
                style={[s.regimeBtn, { flex: 1 }, !modoManual && s.regimeBtnActive]}>
                <Text style={[s.regimeBtnTitle, !modoManual && { color: C.BRAND }]}>Por cargos</Text>
                <Text style={s.regimeBtnSub}>Cadastra cada cargo, calcula os encargos sozinho</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setCfgForm({ ...cfgForm, funcionarios_modo_custo: "manual" })}
                style={[s.regimeBtn, { flex: 1 }, modoManual && s.regimeBtnActive]}>
                <Text style={[s.regimeBtnTitle, modoManual && { color: C.BRAND }]}>Valor total direto</Text>
                <Text style={s.regimeBtnSub}>Digita um valor mensal já pronto</Text>
              </TouchableOpacity>
            </View>

            {modoManual ? (
              <CfgField label="Custo mensal total (R$)" value={cfgForm.funcionarios_custo}
                onChange={v => setCfgForm({ ...cfgForm, funcionarios_custo: v })} />
            ) : (
              <>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 4 }}>
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

            {cargos.length > 0 && (
              <View style={{ backgroundColor: "#fdf2f8", borderRadius: 10, padding: 12, gap: 4 }}>
                <Text style={{ color: "#7c3aed", fontWeight: "700", fontSize: 13 }}>
                  👥 {totalFuncionarios} funcionário{totalFuncionarios > 1 ? "s" : ""} · Custo real: {fmt(totalCustoFuncionarios)}/mês
                </Text>
                {cargos.some(c => c.tipo === "clt") && (
                  <Text style={{ color: C.TEXT_MUTED, fontSize: 11 }}>
                    CLT inclui 13º, férias, FGTS, INSS patronal, RAT e Sistema S
                  </Text>
                )}
              </View>
            )}
              </>
            )}

            <View style={{ marginTop: 12, gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: C.TEXT }}>Como ratear esse custo em cada produto?</Text>
              <Text style={{ fontSize: 11, color: C.TEXT_MUTED, marginTop: -4 }}>Vale pra Funcionários e pra Gastos Variáveis, logo abaixo</Text>
              <View style={{ gap: 8 }}>
                {([
                  { v: "producao_mensal" as const, l: "Pela produção mensal", sub: "Simples, mas varia se vender mais ou menos que o estimado" },
                  { v: "tempo_preparo" as const, l: "Pelo tempo de preparo", sub: "Mais preciso — não depende de quanto você vende no mês" },
                  { v: "percentual_ingredientes" as const, l: "% sobre ingredientes", sub: "Escala com o custo de cada receita (estilo Prime Cost)" },
                ]).map(({ v, l, sub }) => (
                  <TouchableOpacity key={v} onPress={() => setCfgForm({ ...cfgForm, funcionarios_metodo: v })}
                    style={[s.regimeBtn, cfgForm.funcionarios_metodo === v && s.regimeBtnActive]}>
                    <Text style={[s.regimeBtnTitle, cfgForm.funcionarios_metodo === v && { color: C.BRAND }]}>{l}</Text>
                    <Text style={s.regimeBtnSub}>{sub}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {cfgForm.funcionarios_metodo === "tempo_preparo" && (
                <View style={{ gap: 8 }}>
                  <CfgField label="Horas trabalhadas/dia (por pessoa)" value={cfgForm.funcionarios_horas_dia}
                    onChange={v => setCfgForm({ ...cfgForm, funcionarios_horas_dia: v })} />
                  {modoManual ? (
                    <CfgField integer label="Quantidade de funcionários" value={cfgForm.funcionarios_qtd_pessoas}
                      onChange={v => setCfgForm({ ...cfgForm, funcionarios_qtd_pessoas: v || 1 })} />
                  ) : (
                    <Text style={{ fontSize: 11, color: C.TEXT_MUTED }}>Quantidade de funcionários vem da soma dos cargos cadastrados acima ({totalFuncionarios})</Text>
                  )}
                  {custoHoraFuncionario > 0 && (
                    <View style={{ backgroundColor: "#f0fdf4", borderRadius: 10, padding: 10 }}>
                      <Text style={{ color: C.SUCCESS, fontWeight: "700", fontSize: 13 }}>💡 Custo por hora (de 1 pessoa): {fmt(custoHoraFuncionario)}</Text>
                      <Text style={{ color: C.TEXT_MUTED, fontSize: 11, marginTop: 2 }}>Defina o tempo de preparo de cada produto na tela de Precificação.</Text>
                    </View>
                  )}
                </View>
              )}

              {cfgForm.funcionarios_metodo === "percentual_ingredientes" && (
                <View style={{ gap: 4 }}>
                  <CfgField label="Mão de obra = qual % do custo de ingredientes?" value={cfgForm.funcionarios_percentual_ingredientes}
                    onChange={v => setCfgForm({ ...cfgForm, funcionarios_percentual_ingredientes: v })} />
                  <Text style={{ fontSize: 11, color: C.TEXT_MUTED }}>
                    Ex: se os ingredientes de um produto custam R$ 10 e você colocar 30%, a mão de obra desse produto é R$ 3.
                  </Text>
                </View>
              )}

              {cfgForm.funcionarios_metodo === "producao_mensal" && (
                <View style={{ gap: 8 }}>
                  <CfgField label="Quantidade de produtos produzidos por mês" integer
                    value={cfgForm.funcionarios_qtd} onChange={v => setCfgForm({ ...cfgForm, funcionarios_qtd: v || 1 })} />
                  <Text style={{ fontSize: 11, color: C.TEXT_MUTED }}>Esse mesmo número também é usado pra ratear os Gastos Variáveis, ali embaixo</Text>
                  {totalCustoFuncionarios > 0 && cfgForm.funcionarios_qtd > 0 && (
                    <View style={{ backgroundColor: "#f0fdf4", borderRadius: 10, padding: 10 }}>
                      <Text style={{ color: C.SUCCESS, fontWeight: "700", fontSize: 13 }}>
                        💡 Por produto: {fmt(totalCustoFuncionarios / cfgForm.funcionarios_qtd)}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
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
            {gastos.length > 0 && cfgForm.funcionarios_metodo !== "tempo_preparo" && (
              <View style={{ backgroundColor: "#fefce8", borderRadius: 10, padding: 12, marginTop: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 13, color: C.TEXT_MUTED }}>Total mensal</Text>
                  <Text style={{ fontWeight: "700", color: C.TEXT }}>{fmt(gastosMensal)}</Text>
                </View>
                <Text style={{ fontSize: 11, color: C.TEXT_MUTED, marginTop: 4 }}>Ratado pela "Produção mensal" (definida em Funcionários, {cfgForm.funcionarios_qtd} un.)</Text>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#fde68a" }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#92400e" }}>⚡ Por produto</Text>
                  <Text style={{ fontWeight: "800", color: "#92400e" }}>{fmt(gastosPorProduto)}</Text>
                </View>
              </View>
            )}
            {gastos.length > 0 && cfgForm.funcionarios_metodo === "tempo_preparo" && (
              <View style={{ backgroundColor: "#fefce8", borderRadius: 10, padding: 12, marginTop: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 13, color: C.TEXT_MUTED }}>Total mensal</Text>
                  <Text style={{ fontWeight: "700", color: C.TEXT }}>{fmt(gastosMensal)}</Text>
                </View>
                {cfgForm.funcionarios_dias_trabalhados > 0 && cfgForm.funcionarios_horas_dia > 0 && (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#fde68a" }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: "#92400e" }}>⚡ Por hora</Text>
                    <Text style={{ fontWeight: "800", color: "#92400e" }}>{fmt(gastosMensal / cfgForm.funcionarios_dias_trabalhados / cfgForm.funcionarios_horas_dia)}</Text>
                  </View>
                )}
                <Text style={{ fontSize: 11, color: "#92400e", marginTop: 4 }}>O custo por produto usa o tempo de preparo dele, definido na tela de Precificação.</Text>
              </View>
            )}
          </View>

          {/* Perdas */}
          <View style={s.card}>
            <Text style={s.cardTitle}>🗑️ Perdas</Text>
            <Text style={s.cardSub}>Vencimento, desperdício e quebras</Text>
            <CfgField label="Taxa sobre insumos (%)" value={cfgForm.perdas_pct}
              onChange={v => setCfgForm({ ...cfgForm, perdas_pct: v })} />
          </View>

          <TouchableOpacity style={s.btnSalvar} onPress={salvarConfig}>
            <Text style={s.btnSalvarText}>💾 Salvar Configurações desta Empresa</Text>
          </TouchableOpacity>
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

              {parseValorBR(cargoForm.salario) > 0 && (
                <View style={{ backgroundColor: "#f0fdf4", borderRadius: 10, padding: 12 }}>
                  <Text style={{ color: C.SUCCESS, fontWeight: "700", fontSize: 13 }}>
                    Custo real: {fmt(custoRealCargo({
                      id: 0, nome: "", tipo: cargoForm.tipo,
                      salario: parseValorBR(cargoForm.salario) || 0,
                      quantidade: parseInt(cargoForm.quantidade) || 1,
                    }))} /mês
                  </Text>
                  {cargoForm.tipo === "clt" && (
                    <Text style={{ color: C.TEXT_MUTED, fontSize: 11, marginTop: 2 }}>
                      Salário {fmt((parseValorBR(cargoForm.salario) || 0) * (parseInt(cargoForm.quantidade) || 1))} + encargos {fmt((parseValorBR(cargoForm.salario) || 0) * (parseInt(cargoForm.quantidade) || 1) * ENCARGOS_CLT)}
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

// Guarda o texto digitado num buffer próprio em vez de derivar direto do
// número — se resincronizasse a cada tecla, a vírgula era apagada assim que
// digitada (antes do próximo dígito vir), impedindo decimais.
function CfgField({ label, value, onChange, integer }: { label: string; value: number; onChange: (v: number) => void; integer?: boolean }) {
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
    const num = integer ? (parseInt(v) || 0) : parseValorBR(v);
    ultimoEmitido.current = num;
    onChange(num);
  }

  return (
    <View>
      <Text style={{ fontSize: 13, color: C.TEXT_MUTED, fontWeight: "600", marginBottom: 6 }}>{label}</Text>
      <TextInput style={s.input} value={texto} onChangeText={handleChange}
        keyboardType={integer ? "number-pad" : "decimal-pad"} placeholderTextColor={C.TEXT_MUTED} />
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  header: { flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  backBtn: { padding: 4, marginRight: 8 },
  backText: { fontSize: 28, color: C.BRAND, lineHeight: 28 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: C.TEXT },
  card: { backgroundColor: C.CARD, borderRadius: 16, padding: 16, gap: 0 },
  cardTitle: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  cardSub: { fontSize: 12, color: C.TEXT_MUTED, marginBottom: 12, marginTop: -4 },
  input: { backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.TEXT },
  infoBanner: { backgroundColor: "#eff6ff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#bfdbfe" },
  infoText: { fontSize: 12, color: "#1d4ed8", lineHeight: 18 },
  btnAdd: { borderStyle: "dashed", borderWidth: 1.5, borderColor: C.BRAND, borderRadius: 10, padding: 10, alignItems: "center" },
  btnAddText: { color: C.BRAND, fontWeight: "700", fontSize: 14 },
  regimeBtn: { borderWidth: 2, borderColor: C.BORDER, borderRadius: 12, padding: 12 },
  regimeBtnActive: { borderColor: C.BRAND, backgroundColor: "#eff6ff" },
  regimeBtnTitle: { fontSize: 14, fontWeight: "700", color: C.TEXT },
  regimeBtnSub: { fontSize: 12, color: C.TEXT_MUTED, marginTop: 2 },
  btnSalvar: { backgroundColor: C.BRAND, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  btnSalvarText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
