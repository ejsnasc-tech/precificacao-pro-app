import { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ativarCodigo } from "@/lib/licenca";
import * as C from "@/constants/colors";
import ComprarScreen from "@/components/ComprarScreen";

export default function AtivarScreen({ onAtivado }: { onAtivado: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [comprando, setComprando] = useState(false);

  const emailValido = email.includes("@") && email.includes(".");
  const podeSalvar = codigo.trim().length >= 4 && emailValido;

  if (comprando) {
    return <ComprarScreen nome={nome} email={email} onAtivado={onAtivado} onVoltar={() => setComprando(false)} />;
  }

  async function ativar() {
    if (!podeSalvar) return;
    setErro("");
    setCarregando(true);
    const resultado = await ativarCodigo(codigo.trim(), nome.trim(), email.trim().toLowerCase());
    setCarregando(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
    } else {
      onAtivado();
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Text style={s.emoji}>🔑</Text>
          <Text style={s.titulo}>Ativar acesso</Text>
          <Text style={s.sub}>Digite o código de acesso fornecido pelo seu consultor.</Text>

          <Text style={s.label}>Código de acesso</Text>
          <TextInput
            style={s.inputCodigo}
            value={codigo}
            onChangeText={(t) => setCodigo(t.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            placeholderTextColor={C.TEXT_MUTED}
            autoCapitalize="characters"
            autoCorrect={false}
          />

          <Text style={s.label}>Seu e-mail *</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="seuemail@email.com"
            placeholderTextColor={C.TEXT_MUTED}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={s.hint}>Para contato e suporte. Não enviamos spam.</Text>

          <Text style={s.label}>Seu nome (opcional)</Text>
          <TextInput
            style={s.input}
            value={nome}
            onChangeText={setNome}
            placeholder="Como prefere ser chamado"
            placeholderTextColor={C.TEXT_MUTED}
          />

          {erro ? <Text style={s.erro}>{erro}</Text> : null}

          <TouchableOpacity
            style={[s.btn, (!podeSalvar || carregando) && { opacity: 0.5 }]}
            onPress={ativar}
            disabled={!podeSalvar || carregando}
          >
            {carregando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Ativar acesso</Text>}
          </TouchableOpacity>

          {/* Compra dentro do app só existe via StoreKit (iOS). No Android a
              venda continua por fora (WhatsApp) até decidirmos implementar o
              Google Play Billing — sem esse botão aqui pra não mostrar uma
              compra que não completa de verdade. */}
          {Platform.OS === "ios" && (
            <TouchableOpacity
              style={[s.btnSecundario, !emailValido && { opacity: 0.5 }]}
              onPress={() => { if (emailValido) setComprando(true); else setErro("Preencha seu e-mail antes de comprar."); }}
            >
              <Text style={s.btnSecundarioText}>Ainda não tem código? Comprar agora</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  scroll: { padding: 24, paddingTop: 40 },
  emoji: { fontSize: 48, textAlign: "center", marginBottom: 12 },
  titulo: { fontSize: 24, fontWeight: "900", color: C.TEXT, textAlign: "center" },
  sub: { fontSize: 14, color: C.TEXT_MUTED, textAlign: "center", marginTop: 8, marginBottom: 28, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: "700", color: C.TEXT, marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: C.CARD, borderWidth: 1, borderColor: C.BORDER, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.TEXT, marginBottom: 4,
  },
  inputCodigo: {
    backgroundColor: C.CARD, borderWidth: 1, borderColor: C.BORDER, borderRadius: 12,
    paddingVertical: 14, fontSize: 18, fontWeight: "800", color: C.TEXT, textAlign: "center",
    letterSpacing: 2, marginBottom: 4,
  },
  hint: { fontSize: 12, color: C.TEXT_MUTED, marginBottom: 12 },
  erro: { color: C.DANGER, fontSize: 13, textAlign: "center", backgroundColor: "#fef2f2", borderRadius: 10, padding: 10, marginTop: 16 },
  btn: { backgroundColor: C.BRAND, borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 24 },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  btnSecundario: { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 12, borderWidth: 1.5, borderColor: C.BRAND },
  btnSecundarioText: { color: C.BRAND, fontWeight: "700", fontSize: 14 },
});
