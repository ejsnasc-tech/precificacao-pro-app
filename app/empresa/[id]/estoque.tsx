import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Modal, KeyboardAvoidingView, Platform, Switch, ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDB } from "@/lib/db";
import * as C from "@/constants/colors";
import { exportarEstoque, importarEstoque } from "@/lib/syncEstoque";
import { parseValorBR } from "@/lib/numero";

interface Item {
  id: number; nome: string; unidade: string; quantidade_atual: number;
  quantidade_minima: number; custo_unitario: number; tem_validade: number; dias_alerta: number;
}
interface Movimento {
  id: number; estoque_id: number; tipo: string; quantidade: number;
  observacao: string | null; data_validade: string | null; criado_at: string;
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const UNIDADES = ["un", "kg", "g", "L", "ml", "cx", "pc", "saco", "fardo"];

function diasParaVencer(iso: string): number {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const vence = new Date(iso + "T00:00:00");
  return Math.ceil((vence.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

// Máscara DD/MM/AAAA conforme o usuário digita
function maskData(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

// DD/MM/AAAA → AAAA-MM-DD para salvar no banco
function displayToISO(display: string): string {
  const parts = display.split("/");
  if (parts.length === 3 && parts[2].length === 4) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return "";
}

const emptyForm = { nome: "", unidade: "un", quantidade_atual: "", quantidade_minima: "", custo_unitario: "", tem_validade: false, dias_alerta: "7", data_validade_inicial: "" };

export default function EstoqueScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const empresaId = Number(id);

  const [itens, setItens] = useState<Item[]>([]);
  const [empresaNome, setEmpresaNome] = useState("");
  const [busca, setBusca] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editando, setEditando] = useState<Item | null>(null);
  const [modalForm, setModalForm] = useState(false);

  // Movimentação
  const [movItem, setMovItem] = useState<Item | null>(null);
  const [movTipo, setMovTipo] = useState<"entrada" | "saida" | "ajuste">("entrada");
  const [movQtd, setMovQtd] = useState("");
  const [movObs, setMovObs] = useState("");
  const [movValidade, setMovValidade] = useState("");
  const [historico, setHistorico] = useState<Movimento[]>([]);
  const [modalMov, setModalMov] = useState(false);

  // Retirada rápida
  const [retiradaItem, setRetiradaItem] = useState<Item | null>(null);
  const [retiradaQtd, setRetiradaQtd] = useState("");
  const [retiradaObs, setRetiradaObs] = useState("");
  const [modalRetirada, setModalRetirada] = useState(false);

  const load = useCallback(() => {
    const db = getDB();
    const rows = db.getAllSync<Item>(
      "SELECT * FROM estoque WHERE empresa_id = ? ORDER BY nome", [empresaId]
    );
    setItens(rows);
    const emp = db.getFirstSync<{ nome: string }>("SELECT nome FROM empresas WHERE id = ?", [empresaId]);
    setEmpresaNome(emp?.nome ?? "");
  }, [empresaId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function loadHistorico(item: Item) {
    const rows = getDB().getAllSync<Movimento>(
      "SELECT * FROM estoque_movimentos WHERE estoque_id = ? ORDER BY criado_at DESC LIMIT 20",
      [item.id]
    );
    setHistorico(rows);
  }

  function salvarItem() {
    if (!form.nome.trim()) return;
    const db = getDB();
    const qtd = parseValorBR(form.quantidade_atual) || 0;
    const body = [
      form.nome.trim(), form.unidade,
      qtd,
      parseValorBR(form.quantidade_minima) || 0,
      parseValorBR(form.custo_unitario) || 0,
      form.tem_validade ? 1 : 0,
      parseInt(form.dias_alerta) || 7,
    ];
    if (editando) {
      db.runSync(
        "UPDATE estoque SET nome=?, unidade=?, quantidade_atual=?, quantidade_minima=?, custo_unitario=?, tem_validade=?, dias_alerta=? WHERE id=?",
        [...body, editando.id]
      );
    } else {
      db.runSync(
        "INSERT INTO estoque (empresa_id, nome, unidade, quantidade_atual, quantidade_minima, custo_unitario, tem_validade, dias_alerta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [empresaId, ...body]
      );
      if (form.tem_validade && qtd > 0 && form.data_validade_inicial) {
        const newId = db.getFirstSync<{ id: number }>("SELECT last_insert_rowid() as id")!.id;
        const iso = displayToISO(form.data_validade_inicial) || form.data_validade_inicial;
        db.runSync(
          "INSERT INTO estoque_movimentos (estoque_id, tipo, quantidade, observacao, data_validade) VALUES (?, ?, ?, ?, ?)",
          [newId, "entrada", qtd, "Estoque inicial", iso]
        );
      }
    }
    setForm(emptyForm); setEditando(null); setModalForm(false); load();
  }

  function deletarItem(item: Item) {
    Alert.alert("Excluir item?", item.nome, [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => { getDB().runSync("DELETE FROM estoque WHERE id = ?", [item.id]); load(); } },
    ]);
  }

  function registrarMovimento() {
    if (!movItem || !movQtd) return;
    const db = getDB();
    const qtd = parseValorBR(movQtd);
    db.runSync(
      "INSERT INTO estoque_movimentos (estoque_id, tipo, quantidade, observacao, data_validade) VALUES (?, ?, ?, ?, ?)",
      [movItem.id, movTipo, qtd, movObs || null, (movTipo === "entrada" && movItem.tem_validade && movValidade) ? (displayToISO(movValidade) || movValidade) : null]
    );
    const delta = movTipo === "saida" ? -qtd : qtd;
    db.runSync("UPDATE estoque SET quantidade_atual = quantidade_atual + ? WHERE id = ?", [delta, movItem.id]);
    setMovQtd(""); setMovObs(""); setMovValidade("");
    load();
    loadHistorico(movItem);
  }

  function registrarRetirada() {
    if (!retiradaItem || !retiradaQtd) return;
    const db = getDB();
    const qtd = parseValorBR(retiradaQtd);
    db.runSync(
      "INSERT INTO estoque_movimentos (estoque_id, tipo, quantidade, observacao) VALUES (?, ?, ?, ?)",
      [retiradaItem.id, "saida", qtd, retiradaObs || null]
    );
    db.runSync("UPDATE estoque SET quantidade_atual = quantidade_atual - ? WHERE id = ?", [qtd, retiradaItem.id]);
    setRetiradaQtd(""); setRetiradaObs(""); setModalRetirada(false);
    load();
  }

  async function compartilharEstoque() {
    setSincronizando(true);
    setSyncMsg("");
    try {
      await exportarEstoque(empresaNome, itens);
      setSyncMsg("Estoque compartilhado.");
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Não foi possível compartilhar o estoque.");
    } finally {
      setSincronizando(false);
    }
  }

  async function importarEstoqueArquivo() {
    setSincronizando(true);
    setSyncMsg("");
    try {
      const resultado = await importarEstoque(empresaId, itens);
      if (!resultado.ok) {
        if (!resultado.cancelado) setSyncMsg(resultado.erro);
        return;
      }
      setSyncMsg(`Estoque atualizado: ${resultado.atualizados} ajustado(s), ${resultado.criados} novo(s), ${resultado.removidos} removido(s).`);
      load();
    } finally {
      setSincronizando(false);
    }
  }

  const itensFiltrados = itens.filter(i => i.nome.toLowerCase().includes(busca.toLowerCase()));
  const abaixoMinimo = itens.filter(i => i.quantidade_minima > 0 && i.quantidade_atual <= i.quantidade_minima);
  const valorTotal = itens.reduce((a, i) => a + i.quantidade_atual * i.custo_unitario, 0);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>📦 Estoque</Text>
        <TouchableOpacity style={s.btnNovo} onPress={() => { setEditando(null); setForm(emptyForm); setModalForm(true); }}>
          <Text style={s.btnNovoText}>+ Item</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        {/* KPIs */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={[s.kpi, { flex: 1 }]}><Text style={s.kpiLabel}>Itens</Text><Text style={s.kpiValor}>{itens.length}</Text></View>
          <View style={[s.kpi, { flex: 1, backgroundColor: abaixoMinimo.length > 0 ? "#fee2e2" : undefined }]}>
            <Text style={s.kpiLabel}>Estoque baixo</Text>
            <Text style={[s.kpiValor, { color: abaixoMinimo.length > 0 ? C.DANGER : C.TEXT }]}>{abaixoMinimo.length}</Text>
          </View>
          <View style={[s.kpi, { flex: 1 }]}><Text style={s.kpiLabel}>Valor total</Text><Text style={[s.kpiValor, { fontSize: 13 }]}>{fmt(valorTotal)}</Text></View>
        </View>

        {/* Sincronizar entre aparelhos */}
        <View style={s.syncCard}>
          <Text style={s.syncTitle}>🔄 Sincronizar estoque entre aparelhos</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity style={[s.syncBtn, { flex: 1 }]} onPress={compartilharEstoque} disabled={sincronizando}>
              <Text style={s.syncBtnText}>📤 Exportar / Compartilhar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.syncBtn, { flex: 1 }]} onPress={importarEstoqueArquivo} disabled={sincronizando}>
              <Text style={s.syncBtnText}>📥 Importar atualização</Text>
            </TouchableOpacity>
          </View>
          {sincronizando && <ActivityIndicator style={{ marginTop: 8 }} color={C.BRAND} />}
          {!!syncMsg && <Text style={s.syncMsg}>{syncMsg}</Text>}
        </View>

        {abaixoMinimo.length > 0 && (
          <View style={s.alertCard}>
            <Text style={s.alertTitle}>🔴 Estoque baixo</Text>
            <Text style={s.alertText}>{abaixoMinimo.map(i => i.nome).join(" · ")}</Text>
          </View>
        )}

        {/* Busca */}
        <TextInput style={s.input} value={busca} onChangeText={setBusca}
          placeholder="Buscar item..." placeholderTextColor={C.TEXT_MUTED} />

        {/* Lista */}
        {itensFiltrados.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>📦</Text>
            <Text style={s.emptyText}>Nenhum item no estoque</Text>
          </View>
        ) : (
          itensFiltrados.map((item) => {
            const abaixo = item.quantidade_minima > 0 && item.quantidade_atual <= item.quantidade_minima;
            return (
              <View key={item.id} style={[s.itemCard, abaixo && s.itemCardAlert]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[s.dot, { backgroundColor: abaixo ? C.DANGER : item.quantidade_atual > item.quantidade_minima * 1.5 ? C.SUCCESS : C.WARNING }]} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={s.itemNome}>{item.nome}</Text>
                      {item.tem_validade === 1 && <Text style={s.badgeValidade}>⏰</Text>}
                    </View>
                    <Text style={s.itemSub}>Mín: {item.quantidade_minima} {item.unidade} · {fmt(item.custo_unitario)}/{item.unidade}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[s.itemQtd, abaixo && { color: C.DANGER }]}>{item.quantidade_atual}</Text>
                    <Text style={s.itemUnid}>{item.unidade}</Text>
                  </View>
                </View>
                <View style={s.itemBtns}>
                  <TouchableOpacity style={s.btnRetirar} onPress={() => { setRetiradaItem(item); setRetiradaQtd(""); setRetiradaObs(""); setModalRetirada(true); }}>
                    <Text style={s.btnRetirarText}>📤 Retirar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btnMov} onPress={() => { setMovItem(item); setMovTipo("entrada"); setMovQtd(""); setMovObs(""); setMovValidade(""); loadHistorico(item); setModalMov(true); }}>
                    <Text style={s.btnMovText}>↕️ Movimentos</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btnEdit} onPress={() => {
                    setEditando(item);
                    setForm({ nome: item.nome, unidade: item.unidade, quantidade_atual: String(item.quantidade_atual), quantidade_minima: String(item.quantidade_minima), custo_unitario: String(item.custo_unitario), tem_validade: item.tem_validade === 1, dias_alerta: String(item.dias_alerta ?? 7), data_validade_inicial: "" });
                    setModalForm(true);
                  }}>
                    <Text>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btnDel} onPress={() => deletarItem(item)}>
                    <Text>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Modal Form (novo/editar item) */}
      <Modal visible={modalForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalForm(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.header}>
              <Text style={s.headerTitle}>{editando ? "✏️ Editar item" : "➕ Novo item"}</Text>
              <TouchableOpacity onPress={() => setModalForm(false)}><Text style={{ fontSize: 20, color: C.TEXT_MUTED }}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              <Field label="Nome do item" value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} placeholder="Ex: Farinha de trigo" />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Unidade</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {UNIDADES.map((u) => (
                      <TouchableOpacity key={u} onPress={() => setForm({ ...form, unidade: u })}
                        style={[s.unidBtn, form.unidade === u && s.unidBtnActive]}>
                        <Text style={[s.unidText, form.unidade === u && { color: "#fff" }]}>{u}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}><Field label="Quantidade atual" value={form.quantidade_atual} onChange={(v) => setForm({ ...form, quantidade_atual: v })} keyboard="decimal-pad" /></View>
                <View style={{ flex: 1 }}><Field label="Estoque mínimo" value={form.quantidade_minima} onChange={(v) => setForm({ ...form, quantidade_minima: v })} keyboard="decimal-pad" /></View>
              </View>
              <Field label="Custo unitário (R$)" value={form.custo_unitario} onChange={(v) => setForm({ ...form, custo_unitario: v })} keyboard="decimal-pad" />

              {/* Toggle validade */}
              <View style={[s.validadeCard, form.tem_validade && s.validadeCardOn]}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View>
                    <Text style={[s.validadeTitle, form.tem_validade && { color: "#7c3aed" }]}>⏰ Controlar validade</Text>
                    <Text style={s.validadeSub}>Registrar vencimento nas entradas</Text>
                  </View>
                  <Switch value={form.tem_validade} onValueChange={(v) => setForm({ ...form, tem_validade: v })}
                    trackColor={{ false: C.BORDER, true: "#7c3aed" }} thumbColor="#fff" />
                </View>
                {form.tem_validade && (
                  <View style={{ marginTop: 12, gap: 10 }}>
                    <Field label="Alertar quantos dias antes do vencimento?" value={form.dias_alerta}
                      onChange={(v) => setForm({ ...form, dias_alerta: v })} keyboard="number-pad" />
                    {!editando && (
                      <Field label="Data de validade do estoque inicial" value={form.data_validade_inicial}
                        onChange={(v) => setForm({ ...form, data_validade_inicial: maskData(v) })}
                        placeholder="DD/MM/AAAA" keyboard="number-pad" />
                    )}
                  </View>
                )}
              </View>

              <TouchableOpacity style={s.btnSalvar} onPress={salvarItem}>
                <Text style={s.btnSalvarText}>{editando ? "💾 Salvar alterações" : "➕ Adicionar ao estoque"}</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Modal Movimentos */}
      <Modal visible={modalMov} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalMov(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
          <View style={s.header}>
            <Text style={s.headerTitle}>↕️ {movItem?.nome}</Text>
            <TouchableOpacity onPress={() => setModalMov(false)}><Text style={{ fontSize: 20, color: C.TEXT_MUTED }}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {/* Tipo */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["entrada", "ajuste"] as const).map((t) => (
                <TouchableOpacity key={t} onPress={() => setMovTipo(t)}
                  style={[s.tipoBtn, movTipo === t && (t === "entrada" ? { backgroundColor: C.SUCCESS, borderColor: C.SUCCESS } : { backgroundColor: C.BRAND, borderColor: C.BRAND })]}>
                  <Text style={[s.tipoBtnText, movTipo === t && { color: "#fff" }]}>
                    {t === "entrada" ? "⬆️ Entrada" : "🔄 Ajuste"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Field label={`Quantidade (${movItem?.unidade ?? ""})`} value={movQtd} onChange={setMovQtd} keyboard="decimal-pad" />
            <Field label="Observação (opcional)" value={movObs} onChange={setMovObs} />

            {movTipo === "entrada" && movItem?.tem_validade === 1 && (
              <View style={s.validadeCard}>
                <Field label="⏰ Data de validade do lote" value={movValidade}
                  onChange={(v) => setMovValidade(maskData(v))}
                  placeholder="DD/MM/AAAA" keyboard="number-pad" />
                {movValidade.length === 10 && displayToISO(movValidade) && (
                  <Text style={{ fontSize: 12, color: "#7c3aed", marginTop: 4 }}>
                    {diasParaVencer(displayToISO(movValidade))} dias para vencer
                  </Text>
                )}
              </View>
            )}

            <TouchableOpacity style={[s.btnSalvar, { backgroundColor: movTipo === "entrada" ? C.SUCCESS : C.BRAND }]}
              onPress={registrarMovimento} disabled={!movQtd}>
              <Text style={s.btnSalvarText}>{movTipo === "entrada" ? "✅ Confirmar entrada" : "✅ Aplicar ajuste"}</Text>
            </TouchableOpacity>

            {historico.length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>Histórico</Text>
                {historico.map((m) => (
                  <View key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.BORDER }}>
                    <View style={[s.dot, { backgroundColor: m.tipo === "entrada" ? C.SUCCESS : m.tipo === "saida" ? C.DANGER : C.BRAND }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: C.TEXT, textTransform: "capitalize" }}>
                        {m.tipo} · {m.quantidade} {movItem?.unidade}
                      </Text>
                      {m.data_validade && <Text style={{ fontSize: 11, color: "#7c3aed" }}>val. {new Date(m.data_validade + "T00:00:00").toLocaleDateString("pt-BR")}</Text>}
                      {m.observacao && <Text style={{ fontSize: 11, color: C.TEXT_MUTED }}>{m.observacao}</Text>}
                    </View>
                    <Text style={{ fontSize: 11, color: C.TEXT_MUTED }}>{new Date(m.criado_at).toLocaleDateString("pt-BR")}</Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal Retirada */}
      <Modal visible={modalRetirada} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setModalRetirada(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.BG }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.header}>
              <Text style={s.headerTitle}>📤 Retirar — {retiradaItem?.nome}</Text>
              <TouchableOpacity onPress={() => setModalRetirada(false)}><Text style={{ fontSize: 20, color: C.TEXT_MUTED }}>✕</Text></TouchableOpacity>
            </View>
            <View style={{ padding: 16, gap: 12 }}>
              <View style={[s.kpi, { backgroundColor: "#fff7ed" }]}>
                <Text style={s.kpiLabel}>Estoque atual</Text>
                <Text style={[s.kpiValor, { color: C.WARNING }]}>{retiradaItem?.quantidade_atual} {retiradaItem?.unidade}</Text>
              </View>
              <Field label={`Quantidade a retirar (${retiradaItem?.unidade ?? ""})`} value={retiradaQtd} onChange={setRetiradaQtd} keyboard="decimal-pad" />
              {retiradaQtd ? (
                <Text style={{ fontSize: 13, color: C.TEXT_MUTED, textAlign: "center" }}>
                  Após retirada: {Math.max(0, (retiradaItem?.quantidade_atual ?? 0) - parseValorBR(retiradaQtd || "0")).toFixed(2)} {retiradaItem?.unidade}
                </Text>
              ) : null}
              <Field label="Motivo / observação (opcional)" value={retiradaObs} onChange={setRetiradaObs} />
              <TouchableOpacity style={[s.btnSalvar, { backgroundColor: "#f97316" }]} onPress={registrarRetirada} disabled={!retiradaQtd}>
                <Text style={s.btnSalvarText}>✅ Confirmar retirada</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, keyboard }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; keyboard?: any }) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.input} value={value} onChangeText={onChange}
        placeholder={placeholder} placeholderTextColor={C.TEXT_MUTED} keyboardType={keyboard ?? "default"} />
    </View>
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
  kpi: { backgroundColor: C.CARD, borderRadius: 14, padding: 14 },
  kpiLabel: { fontSize: 11, fontWeight: "700", color: C.TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  kpiValor: { fontSize: 20, fontWeight: "900", color: C.TEXT, marginTop: 2 },
  alertCard: { backgroundColor: "#fee2e2", borderRadius: 14, padding: 14 },
  alertTitle: { fontSize: 14, fontWeight: "800", color: C.DANGER },
  alertText: { fontSize: 13, color: C.DANGER, marginTop: 4 },
  input: { backgroundColor: C.CARD, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.TEXT },
  label: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, marginBottom: 6 },
  unidBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, marginRight: 6, height: 34, justifyContent: "center" },
  unidBtnActive: { backgroundColor: C.BRAND, borderColor: C.BRAND },
  unidText: { fontSize: 12, color: C.TEXT_MUTED, fontWeight: "600" },
  itemCard: { backgroundColor: C.CARD, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.BORDER, gap: 10 },
  itemCardAlert: { borderColor: "#fca5a5", backgroundColor: "#fff5f5" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  itemNome: { fontSize: 15, fontWeight: "700", color: C.TEXT },
  itemSub: { fontSize: 12, color: C.TEXT_MUTED, marginTop: 2 },
  itemQtd: { fontSize: 22, fontWeight: "900", color: C.TEXT },
  itemUnid: { fontSize: 11, color: C.TEXT_MUTED },
  itemBtns: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  btnRetirar: { backgroundColor: "#fff7ed", borderWidth: 1, borderColor: "#fdba74", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  btnRetirarText: { fontSize: 12, fontWeight: "700", color: "#c2410c" },
  btnMov: { backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  btnMovText: { fontSize: 12, fontWeight: "600", color: C.TEXT_MUTED },
  btnEdit: { backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  btnDel: { backgroundColor: "#fff5f5", borderWidth: 1, borderColor: "#fca5a5", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  validadeCard: { backgroundColor: "#faf5ff", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: C.BORDER },
  validadeCardOn: { borderColor: "#a78bfa" },
  validadeTitle: { fontSize: 14, fontWeight: "700", color: C.TEXT },
  validadeSub: { fontSize: 12, color: C.TEXT_MUTED, marginTop: 2 },
  tipoBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: "center", borderWidth: 2, borderColor: C.BORDER, backgroundColor: C.CARD },
  tipoBtnText: { fontWeight: "700", color: C.TEXT_MUTED, fontSize: 14 },
  badgeValidade: { fontSize: 12 },
  card: { backgroundColor: C.CARD, borderRadius: 16, padding: 14 },
  cardTitle: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  btnSalvar: { backgroundColor: C.BRAND, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  btnSalvarText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  empty: { alignItems: "center", padding: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: C.TEXT_MUTED },
  syncCard: { backgroundColor: C.CARD, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.BORDER, gap: 10 },
  syncTitle: { fontSize: 13, fontWeight: "700", color: C.TEXT },
  syncBtn: { backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, paddingVertical: 9, alignItems: "center" },
  syncBtnText: { fontSize: 12, fontWeight: "700", color: C.TEXT },
  syncMsg: { fontSize: 12, color: C.SUCCESS, backgroundColor: "#f0fdf4", borderRadius: 10, padding: 8, textAlign: "center" },
});
