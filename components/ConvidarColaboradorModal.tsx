import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, Share, ActivityIndicator, Alert } from "react-native";
import * as C from "@/constants/colors";
import { useLicenca } from "@/lib/LicencaContext";

const API_BASE = "https://topprecificacao.com.br";

const MODULOS = [
  { key: "precificacao", emoji: "🧮", titulo: "Precificação" },
  { key: "financeiro", emoji: "💰", titulo: "Financeiro" },
  { key: "estoque", emoji: "📦", titulo: "Estoque" },
  { key: "configuracoes", emoji: "⚙️", titulo: "Configurações" },
  { key: "fornecedores", emoji: "🚚", titulo: "Fornecedores" },
] as const;

export default function ConvidarColaboradorModal({
  visible, empresaNome, onClose,
}: { visible: boolean; empresaNome: string; onClose: () => void }) {
  const { licenca } = useLicenca();
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");
  const [codigoGerado, setCodigoGerado] = useState("");
  const [status, setStatus] = useState<{ limite: number; usados: number } | null>(null);

  useEffect(() => {
    if (!visible || !licenca) return;
    setSelecionados([]); setErro(""); setCodigoGerado("");
    fetch(`${API_BASE}/api/codigo/convidar?codigo=${encodeURIComponent(licenca.codigo)}`)
      .then((r) => r.json() as Promise<{ limite?: number; usados?: number }>)
      .then((data) => { if (typeof data.limite === "number") setStatus({ limite: data.limite, usados: data.usados ?? 0 }); })
      .catch(() => {});
  }, [visible, licenca]);

  const limiteAtingido = !!status && status.usados >= status.limite;

  function toggle(key: string) {
    setSelecionados((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  }

  async function gerar() {
    if (selecionados.length === 0 || !licenca) return;
    setGerando(true);
    setErro("");
    try {
      const res = await fetch(`${API_BASE}/api/codigo/convidar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: licenca.codigo, permissoes: selecionados }),
      });
      const data = await res.json() as { codigo?: string; erro?: string };
      if (!res.ok || !data.codigo) {
        setErro(data.erro || "Não foi possível gerar o código.");
      } else {
        setCodigoGerado(data.codigo);
      }
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setGerando(false);
    }
  }

  async function compartilhar() {
    const areas = MODULOS.filter((m) => selecionados.includes(m.key)).map((m) => m.titulo).join(", ");
    const texto = `Você foi convidado a acessar o Top Precificação (${empresaNome} — área: ${areas}).\n\nBaixe/abra o app e ative com este código:\n${codigoGerado}\n\nhttps://topprecificacao.com.br`;
    try {
      await Share.share({ message: texto });
    } catch {
      Alert.alert("Convite", texto);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          {!codigoGerado ? (
            <>
              <Text style={s.titulo}>👥 Convidar colaborador</Text>
              <Text style={s.sub}>
                Escolha quais áreas de <Text style={{ fontWeight: "700" }}>{empresaNome}</Text> essa pessoa vai poder acessar. Ela instala o app no aparelho dela e ativa com um código próprio, sem ver o resto do sistema.
              </Text>
              {status && (
                <View style={[s.statusBox, limiteAtingido && s.statusBoxAlerta]}>
                  <Text style={[s.statusText, limiteAtingido && s.statusTextAlerta]}>
                    {status.usados} de {status.limite} colaborador{status.limite !== 1 ? "es" : ""} do seu plano em uso
                    {limiteAtingido && " — limite atingido, fale com o suporte pra liberar mais."}
                  </Text>
                </View>
              )}
              <View style={{ gap: 8, marginVertical: 12 }}>
                {MODULOS.map((m) => {
                  const ativo = selecionados.includes(m.key);
                  return (
                    <TouchableOpacity key={m.key} onPress={() => toggle(m.key)}
                      style={[s.moduloRow, ativo && s.moduloRowAtivo]}>
                      <View style={[s.checkbox, ativo && s.checkboxAtivo]}>
                        {ativo && <Text style={s.checkboxMark}>✓</Text>}
                      </View>
                      <Text style={{ fontSize: 16 }}>{m.emoji}</Text>
                      <Text style={s.moduloTexto}>{m.titulo}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {erro ? <Text style={s.erro}>{erro}</Text> : null}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <TouchableOpacity onPress={onClose} style={s.btnCancelar}>
                  <Text style={s.btnCancelarTexto}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={gerar} disabled={gerando || selecionados.length === 0 || limiteAtingido}
                  style={[s.btnGerar, (gerando || selecionados.length === 0 || limiteAtingido) && { opacity: 0.5 }]}>
                  {gerando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnGerarTexto}>Gerar código</Text>}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={s.titulo}>✅ Código gerado</Text>
              <Text style={s.sub}>Envie este código pro seu colaborador. Ele instala o app e ativa com ele — vai ver só as áreas escolhidas.</Text>
              <View style={s.codigoBox}>
                <Text style={s.codigoTexto}>{codigoGerado}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <TouchableOpacity onPress={onClose} style={s.btnCancelar}>
                  <Text style={s.btnCancelarTexto}>Fechar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={compartilhar} style={s.btnGerar}>
                  <Text style={s.btnGerarTexto}>📤 Compartilhar</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 },
  card: { backgroundColor: C.CARD, borderRadius: 20, padding: 20 },
  titulo: { fontSize: 18, fontWeight: "800", color: C.TEXT, marginBottom: 4 },
  sub: { fontSize: 13, color: C.TEXT_MUTED, marginBottom: 8, lineHeight: 18 },
  statusBox: { backgroundColor: C.BG, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 4 },
  statusBoxAlerta: { backgroundColor: "#fffbeb" },
  statusText: { fontSize: 11, fontWeight: "600", color: C.TEXT_MUTED },
  statusTextAlerta: { color: "#b45309" },
  moduloRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: C.BORDER, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  moduloRowAtivo: { borderColor: C.BRAND, backgroundColor: C.BRAND + "10" },
  checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: C.BORDER, alignItems: "center", justifyContent: "center" },
  checkboxAtivo: { backgroundColor: C.BRAND, borderColor: C.BRAND },
  checkboxMark: { color: "#fff", fontSize: 12, fontWeight: "900" },
  moduloTexto: { fontSize: 13, fontWeight: "600", color: C.TEXT },
  erro: { color: C.DANGER, fontSize: 13, textAlign: "center", backgroundColor: "#fef2f2", borderRadius: 10, paddingVertical: 8, marginBottom: 8 },
  btnCancelar: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  btnCancelarTexto: { fontSize: 14, fontWeight: "700", color: C.TEXT_MUTED },
  btnGerar: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center", backgroundColor: C.BRAND },
  btnGerarTexto: { fontSize: 14, fontWeight: "800", color: "#fff" },
  codigoBox: { backgroundColor: C.BRAND + "12", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginBottom: 8 },
  codigoTexto: { fontSize: 24, fontWeight: "900", letterSpacing: 3, color: C.BRAND, fontFamily: "monospace" },
});
