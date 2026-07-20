import { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Modal, Pressable, Alert, ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDB } from "@/lib/db";
import * as C from "@/constants/colors";

interface Empresa { id: number; nome: string; descricao: string; emoji: string; cor: string; }

const EMOJIS = ["🏪", "🍔", "🍕", "🍗", "🥗", "🍰", "☕", "🛒", "💈", "🏭", "🧁", "🌮"];
const CORES = [
  "from-indigo-500 to-purple-600",
  "from-orange-400 to-red-500",
  "from-emerald-400 to-teal-600",
  "from-blue-500 to-cyan-600",
  "from-pink-400 to-rose-500",
  "from-amber-400 to-orange-500",
];
const COR_HEX: Record<string, [string, string]> = {
  "from-indigo-500 to-purple-600": ["#6366f1", "#9333ea"],
  "from-orange-400 to-red-500": ["#fb923c", "#ef4444"],
  "from-emerald-400 to-teal-600": ["#34d399", "#0d9488"],
  "from-blue-500 to-cyan-600": ["#3b82f6", "#0891b2"],
  "from-pink-400 to-rose-500": ["#f472b6", "#f43f5e"],
  "from-amber-400 to-orange-500": ["#fbbf24", "#f97316"],
};

export default function EmpresasScreen() {
  const router = useRouter();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [cor, setCor] = useState(CORES[0]);
  const [salvando, setSalvando] = useState(false);

  const load = useCallback(async () => {
    const db = getDB();
    const rows = db.getAllSync<Empresa>("SELECT * FROM empresas ORDER BY criado_at DESC");
    setEmpresas(rows);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function salvar() {
    if (!nome.trim()) return;
    setSalvando(true);
    const db = getDB();
    db.runSync(
      "INSERT INTO empresas (nome, descricao, emoji, cor) VALUES (?, ?, ?, ?)",
      [nome.trim(), descricao.trim(), emoji, cor]
    );
    const newId = db.getFirstSync<{ id: number }>("SELECT last_insert_rowid() as id")!.id;
    db.runSync(
      "INSERT INTO configuracoes_empresa (empresa_id) VALUES (?)",
      [newId]
    );
    setNome(""); setDescricao(""); setEmoji(EMOJIS[0]); setCor(CORES[0]);
    setSalvando(false);
    setModalVisible(false);
    void load();
  }

  function confirmarDeletar(item: Empresa) {
    Alert.alert(
      "Excluir empresa",
      `Excluir "${item.nome}" e todos os dados? Esta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir", style: "destructive",
          onPress: () => {
            getDB().runSync("DELETE FROM empresas WHERE id = ?", [item.id]);
            void load();
          },
        },
      ]
    );
  }

  const colors = COR_HEX[cor] ?? ["#6366f1", "#9333ea"];

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Minhas Empresas</Text>
          <Text style={s.headerSub}>{empresas.length} empresa{empresas.length !== 1 ? "s" : ""} cadastrada{empresas.length !== 1 ? "s" : ""}</Text>
        </View>
        <TouchableOpacity style={s.btnNova} onPress={() => setModalVisible(true)}>
          <Text style={s.btnNovaText}>+ Nova</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={C.BRAND} />
      ) : empresas.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyEmoji}>🏪</Text>
          <Text style={s.emptyTitle}>Nenhuma empresa ainda</Text>
          <Text style={s.emptySub}>Toque em "+ Nova" para começar</Text>
        </View>
      ) : (
        <FlatList
          data={empresas}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => {
            const [c1, c2] = COR_HEX[item.cor] ?? ["#6366f1", "#9333ea"];
            return (
              <TouchableOpacity
                style={[s.card, { backgroundColor: c1 }]}
                onPress={() => router.push(`/empresa/${item.id}`)}
                onLongPress={() => confirmarDeletar(item)}
                activeOpacity={0.85}
              >
                <View style={[s.cardGlow, { backgroundColor: c2 }]} />
                <Text style={s.cardEmoji}>{item.emoji}</Text>
                <Text style={s.cardNome}>{item.nome}</Text>
                {item.descricao ? <Text style={s.cardDesc}>{item.descricao}</Text> : null}
                <Text style={s.cardHint}>Ver detalhes →</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Modal nova empresa */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <SafeAreaView style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Nova Empresa</Text>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={s.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={s.modalBody}>
            {/* Preview */}
            <View style={[s.preview, { backgroundColor: colors[0] }]}>
              <Text style={s.previewEmoji}>{emoji}</Text>
              <Text style={s.previewNome}>{nome || "Nome da empresa"}</Text>
            </View>

            <Text style={s.label}>Nome</Text>
            <TextInput style={s.input} value={nome} onChangeText={setNome} placeholder="Ex: Lanchonete da Maria" placeholderTextColor={C.TEXT_MUTED} />

            <Text style={s.label}>Descrição (opcional)</Text>
            <TextInput style={s.input} value={descricao} onChangeText={setDescricao} placeholder="Breve descrição" placeholderTextColor={C.TEXT_MUTED} />

            <Text style={s.label}>Ícone</Text>
            <View style={s.emojiGrid}>
              {EMOJIS.map((e) => (
                <Pressable key={e} onPress={() => setEmoji(e)}
                  style={[s.emojiBtn, emoji === e && s.emojiBtnActive]}>
                  <Text style={{ fontSize: 24 }}>{e}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>Cor</Text>
            <View style={s.corGrid}>
              {CORES.map((c) => {
                const [hex] = COR_HEX[c];
                return (
                  <Pressable key={c} onPress={() => setCor(c)}
                    style={[s.corBtn, { backgroundColor: hex }, cor === c && s.corBtnActive]} />
                );
              })}
            </View>

            <TouchableOpacity style={[s.btnSalvar, salvando && { opacity: 0.6 }]} onPress={salvar} disabled={salvando || !nome.trim()}>
              <Text style={s.btnSalvarText}>{salvando ? "Salvando..." : "➕ Adicionar empresa"}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.BORDER, backgroundColor: C.CARD },
  headerTitle: { fontSize: 22, fontWeight: "800", color: C.TEXT },
  headerSub: { fontSize: 13, color: C.TEXT_MUTED, marginTop: 2 },
  btnNova: { backgroundColor: C.BRAND, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
  btnNovaText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: C.TEXT, marginBottom: 8 },
  emptySub: { fontSize: 14, color: C.TEXT_MUTED },
  card: { borderRadius: 20, padding: 20, minHeight: 120, overflow: "hidden", position: "relative" },
  cardGlow: { position: "absolute", width: 120, height: 120, borderRadius: 60, right: -20, top: -20, opacity: 0.5 },
  cardEmoji: { fontSize: 32, marginBottom: 8 },
  cardNome: { fontSize: 20, fontWeight: "800", color: "#fff" },
  cardDesc: { fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 4 },
  cardHint: { fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 12 },
  modal: { flex: 1, backgroundColor: C.BG },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: C.BORDER, backgroundColor: C.CARD },
  modalTitle: { fontSize: 18, fontWeight: "800", color: C.TEXT },
  modalClose: { fontSize: 18, color: C.TEXT_MUTED, padding: 4 },
  modalBody: { padding: 20, gap: 8 },
  preview: { borderRadius: 16, padding: 20, alignItems: "flex-start", marginBottom: 8 },
  previewEmoji: { fontSize: 32, marginBottom: 4 },
  previewNome: { fontSize: 18, fontWeight: "800", color: "#fff" },
  label: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, marginTop: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { backgroundColor: C.CARD, borderWidth: 1, borderColor: C.BORDER, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: C.TEXT },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  emojiBtn: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.CARD, borderWidth: 2, borderColor: "transparent" },
  emojiBtnActive: { borderColor: C.BRAND },
  corGrid: { flexDirection: "row", gap: 12, marginTop: 4 },
  corBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 3, borderColor: "transparent" },
  corBtnActive: { borderColor: C.TEXT },
  btnSalvar: { backgroundColor: C.BRAND, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  btnSalvarText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
