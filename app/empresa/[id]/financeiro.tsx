import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as C from "@/constants/colors";

export default function FinanceiroScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={s.back}>‹ Voltar</Text></TouchableOpacity>
        <Text style={s.title}>💰 Financeiro</Text>
      </View>
      <View style={s.body}>
        <Text style={s.emoji}>🚧</Text>
        <Text style={s.msg}>Módulo em construção</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  header: { padding: 20, borderBottomWidth: 1, borderBottomColor: C.BORDER, backgroundColor: C.CARD },
  back: { fontSize: 16, color: C.BRAND, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: "800", color: C.TEXT },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 56, marginBottom: 16 },
  msg: { fontSize: 16, color: C.TEXT_MUTED },
});
