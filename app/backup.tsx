import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as C from "@/constants/colors";
import { exportarBackup, importarBackup, AREAS } from "@/lib/backup";
import { useLicenca } from "@/lib/LicencaContext";

export default function BackupScreen() {
  const router = useRouter();
  const { ehColaborador } = useLicenca();
  const [exportando, setExportando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [areasSelecionadas, setAreasSelecionadas] = useState<string[]>(AREAS.map((a) => a.key));

  function toggleArea(key: string) {
    setAreasSelecionadas((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  }

  async function compartilhar() {
    setExportando(true);
    try {
      await exportarBackup(areasSelecionadas);
    } catch (e) {
      Alert.alert("Erro", e instanceof Error ? e.message : "Não foi possível gerar o backup.");
    } finally {
      setExportando(false);
    }
  }

  function confirmarImportar() {
    Alert.alert(
      "Importar backup",
      "Importar vai substituir, neste aparelho, os dados das áreas presentes no arquivo. Continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Importar", style: "destructive", onPress: () => void importar() },
      ]
    );
  }

  async function importar() {
    setImportando(true);
    try {
      const resultado = await importarBackup();
      if (!resultado.ok) {
        if (!resultado.cancelado) Alert.alert("Erro", resultado.erro);
        return;
      }
      Alert.alert("✅ Pronto", "Dados importados com sucesso! Volte pra tela de Empresas pra conferir.");
    } finally {
      setImportando(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}><Text style={s.backText}>‹</Text></TouchableOpacity>
        <Text style={s.headerTitle}>💾 Backup</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <Text style={s.intro}>
          {ehColaborador
            ? "Peça pro dono da empresa te mandar o arquivo de backup e importe abaixo."
            : "Seus dados ficam salvos só neste aparelho. Use isso pra levá-los pra um celular ou computador novo, ou pra compartilhar com um colaborador."}
        </Text>

        {!ehColaborador && (
          <View style={s.card}>
            <Text style={s.cardTitle}>1. Exportar deste aparelho</Text>
            <Text style={s.cardSub}>
              Escolha quais áreas entram no arquivo — não precisa ser tudo. Compartilhe por WhatsApp, e-mail ou salve num serviço de nuvem.
            </Text>
            <View style={s.areasGrid}>
              {AREAS.map((a) => {
                const marcado = areasSelecionadas.includes(a.key);
                return (
                  <TouchableOpacity key={a.key} onPress={() => toggleArea(a.key)} style={[s.areaChip, marcado && s.areaChipAtivo]}>
                    <Text style={[s.areaChipText, marcado && s.areaChipTextAtivo]}>{a.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {areasSelecionadas.length === 0 && (
              <View style={s.avisoBox}><Text style={s.avisoText}>Selecione ao menos uma área.</Text></View>
            )}
            <TouchableOpacity
              style={[s.btnPrimary, (exportando || areasSelecionadas.length === 0) && { opacity: 0.6 }]}
              onPress={compartilhar}
              disabled={exportando || areasSelecionadas.length === 0}
            >
              {exportando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>📤 Compartilhar backup</Text>}
            </TouchableOpacity>
          </View>
        )}

        <View style={s.card}>
          <Text style={s.cardTitle}>{ehColaborador ? "Importar backup" : "2. Importar no aparelho novo"}</Text>
          <Text style={s.cardSub}>
            {ehColaborador
              ? "Escolha o arquivo que o dono da empresa te mandou."
              : "No celular novo, ative seu código de acesso primeiro, depois volte nesta tela e escolha o arquivo de backup."}
          </Text>
          <View style={s.avisoBox}>
            <Text style={s.avisoText}>⚠️ Importar substitui, neste aparelho, só as áreas que estiverem dentro do arquivo (se for um backup parcial, o resto não é afetado).</Text>
          </View>
          <TouchableOpacity style={[s.btnOutline, importando && { opacity: 0.6 }]} onPress={confirmarImportar} disabled={importando}>
            {importando ? <ActivityIndicator color={C.BRAND} /> : <Text style={s.btnOutlineText}>Escolher arquivo de backup</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  header: { flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: C.CARD, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  backBtn: { padding: 4, marginRight: 8 },
  backText: { fontSize: 28, color: C.BRAND, lineHeight: 28 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: C.TEXT },
  intro: { fontSize: 13, color: C.TEXT_MUTED, lineHeight: 19 },
  card: { backgroundColor: C.CARD, borderRadius: 16, padding: 16, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: C.TEXT, marginBottom: 4 },
  cardSub: { fontSize: 13, color: C.TEXT_MUTED, lineHeight: 18, marginBottom: 12 },
  avisoBox: { backgroundColor: "#fffbeb", borderRadius: 10, padding: 10, marginBottom: 12 },
  avisoText: { color: "#b45309", fontSize: 12, lineHeight: 16 },
  areasGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  areaChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.BG, borderWidth: 1, borderColor: C.BORDER },
  areaChipAtivo: { backgroundColor: "#eef2ff", borderColor: C.BRAND },
  areaChipText: { fontSize: 12, fontWeight: "600", color: C.TEXT_MUTED },
  areaChipTextAtivo: { color: C.BRAND, fontWeight: "700" },
  btnPrimary: { backgroundColor: C.BRAND, borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  btnPrimaryText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  btnOutline: { borderRadius: 14, paddingVertical: 13, alignItems: "center", borderWidth: 2, borderColor: C.BRAND },
  btnOutlineText: { color: C.BRAND, fontWeight: "700", fontSize: 14 },
});
