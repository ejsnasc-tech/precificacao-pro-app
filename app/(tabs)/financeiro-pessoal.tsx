import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as C from "@/constants/colors";

export default function FinanceiroPessoalScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Text style={s.title}>💰 Finanças Pessoais</Text>
        <Text style={s.sub}>Em breve</Text>
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
  title: { fontSize: 22, fontWeight: "800", color: C.TEXT },
  sub: { fontSize: 13, color: C.TEXT_MUTED, marginTop: 2 },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 56, marginBottom: 16 },
  msg: { fontSize: 16, color: C.TEXT_MUTED },
});
