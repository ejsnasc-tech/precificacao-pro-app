import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDB } from "@/lib/db";
import * as C from "@/constants/colors";

interface Empresa { id: number; nome: string; descricao: string; emoji: string; cor: string; }

const COR_HEX: Record<string, string> = {
  "from-indigo-500 to-purple-600": "#6366f1",
  "from-orange-400 to-red-500": "#fb923c",
  "from-emerald-400 to-teal-600": "#34d399",
  "from-blue-500 to-cyan-600": "#3b82f6",
  "from-pink-400 to-rose-500": "#f472b6",
  "from-amber-400 to-orange-500": "#fbbf24",
};

const MODULOS = [
  { key: "precificacao", emoji: "🧮", titulo: "Precificação", desc: "Calcule o preço ideal dos seus produtos", cor: "#f97316" },
  { key: "financeiro", emoji: "💰", titulo: "Financeiro", desc: "Controle entradas, saídas e sócios", cor: "#3b82f6" },
  { key: "estoque", emoji: "📦", titulo: "Estoque", desc: "Gerencie produtos e movimentações", cor: "#10b981" },
];

export default function EmpresaHub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [empresa, setEmpresa] = useState<Empresa | null>(null);

  useEffect(() => {
    const row = getDB().getFirstSync<Empresa>("SELECT * FROM empresas WHERE id = ?", [Number(id)]);
    if (!row) { router.back(); return; }
    setEmpresa(row);
  }, [id]);

  if (!empresa) return null;

  const corPrimaria = COR_HEX[empresa.cor] ?? C.BRAND;

  return (
    <SafeAreaView style={s.safe}>
      {/* Header colorido */}
      <View style={[s.header, { backgroundColor: corPrimaria }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.back}>
          <Text style={s.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerEmoji}>{empresa.emoji}</Text>
        <Text style={s.headerNome}>{empresa.nome}</Text>
        {empresa.descricao ? <Text style={s.headerDesc}>{empresa.descricao}</Text> : null}
      </View>

      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.sectionTitle}>Módulos</Text>

        {MODULOS.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={s.card}
            onPress={() => router.push(`/empresa/${id}/${m.key}`)}
            activeOpacity={0.85}
          >
            <View style={[s.cardIcon, { backgroundColor: m.cor + "20" }]}>
              <Text style={{ fontSize: 28 }}>{m.emoji}</Text>
            </View>
            <View style={s.cardBody}>
              <Text style={s.cardTitulo}>{m.titulo}</Text>
              <Text style={s.cardDesc}>{m.desc}</Text>
            </View>
            <Text style={[s.cardArrow, { color: m.cor }]}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  header: { padding: 24, paddingTop: 16 },
  back: { marginBottom: 12 },
  backText: { fontSize: 28, color: "rgba(255,255,255,0.8)", lineHeight: 28 },
  headerEmoji: { fontSize: 40, marginBottom: 8 },
  headerNome: { fontSize: 26, fontWeight: "900", color: "#fff" },
  headerDesc: { fontSize: 14, color: "rgba(255,255,255,0.7)", marginTop: 4 },
  body: { padding: 20, gap: 12 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: C.TEXT_MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  card: { backgroundColor: C.CARD, borderRadius: 18, padding: 18, flexDirection: "row", alignItems: "center", gap: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardIcon: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1 },
  cardTitulo: { fontSize: 17, fontWeight: "800", color: C.TEXT },
  cardDesc: { fontSize: 13, color: C.TEXT_MUTED, marginTop: 2 },
  cardArrow: { fontSize: 24, fontWeight: "700" },
});
