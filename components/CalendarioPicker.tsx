import { useState } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView } from "react-native";
import * as C from "@/constants/colors";

// Calendário próprio, sem depender de módulo nativo (não exige build novo pra
// aparecer no app — só JS, entra por atualização OTA). Trabalha com o mesmo
// formato DD/MM/AAAA que as telas já usam.

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

function parseDisplay(v: string): Date {
  const p = v.split("/");
  if (p.length === 3 && p[2].length === 4) {
    const d = Number(p[0]), m = Number(p[1]), y = Number(p[2]);
    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m - 1, d, 12);
  }
  return new Date();
}
function toDisplay(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

interface Props {
  value: string; // DD/MM/AAAA
  onChange: (v: string) => void;
}

export default function CalendarioPicker({ value, onChange }: Props) {
  const [aberto, setAberto] = useState(false);
  const [modoAno, setModoAno] = useState(false);
  const [mesRef, setMesRef] = useState(() => { const d = parseDisplay(value); d.setDate(1); return d; });

  function abrir() {
    const d = parseDisplay(value);
    d.setDate(1);
    setMesRef(d);
    setModoAno(false);
    setAberto(true);
  }

  function selecionarDia(dia: number) {
    onChange(toDisplay(new Date(ano, mes, dia, 12)));
    setAberto(false);
  }

  function irParaHoje() {
    onChange(toDisplay(new Date()));
    setAberto(false);
  }

  function mudarMes(delta: number) {
    setMesRef(new Date(ano, mes + delta, 1));
  }

  function mudarAno(delta: number) {
    setMesRef(new Date(ano + delta, mes, 1));
  }

  function selecionarAno(anoEscolhido: number) {
    setMesRef(new Date(anoEscolhido, mes, 1));
    setModoAno(false);
  }

  const selecionado = parseDisplay(value);
  const ano = mesRef.getFullYear();
  const mes = mesRef.getMonth();
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const celulas: (number | null)[] = [
    ...Array(primeiroDiaSemana).fill(null),
    ...Array.from({ length: diasNoMes }, (_, i) => i + 1),
  ];

  const hoje = new Date();
  const ehHoje = (dia: number) => hoje.getFullYear() === ano && hoje.getMonth() === mes && hoje.getDate() === dia;
  const ehSelecionado = (dia: number) => selecionado.getFullYear() === ano && selecionado.getMonth() === mes && selecionado.getDate() === dia;

  // Janela de anos pra escolher rápido (de 10 anos atrás até 1 no futuro),
  // pensado pra quem for lançar dado retroativo de anos anteriores.
  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: 12 }, (_, i) => anoAtual + 1 - i);

  return (
    <>
      <TouchableOpacity style={st.campo} onPress={abrir}>
        <Text style={st.campoTexto}>{value || "Selecionar data"}</Text>
        <Text style={st.icone}>📅</Text>
      </TouchableOpacity>

      <Modal visible={aberto} transparent animationType="fade" onRequestClose={() => setAberto(false)}>
        <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={() => setAberto(false)}>
          <TouchableOpacity activeOpacity={1} style={st.painel} onPress={(e) => e.stopPropagation()}>
            <View style={st.cabecalho}>
              <View style={{ flexDirection: "row", gap: 4 }}>
                <TouchableOpacity onPress={() => mudarAno(-1)} style={st.setaBtn} hitSlop={8}>
                  <Text style={st.setaDupla}>«</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => mudarMes(-1)} style={st.setaBtn} hitSlop={8}>
                  <Text style={st.seta}>‹</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setModoAno((v) => !v)} hitSlop={6}>
                <Text style={st.mesAno}>{MESES[mes]} {ano} {modoAno ? "▲" : "▼"}</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: "row", gap: 4 }}>
                <TouchableOpacity onPress={() => mudarMes(1)} style={st.setaBtn} hitSlop={8}>
                  <Text style={st.seta}>›</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => mudarAno(1)} style={st.setaBtn} hitSlop={8}>
                  <Text style={st.setaDupla}>»</Text>
                </TouchableOpacity>
              </View>
            </View>

            {modoAno ? (
              <ScrollView style={{ maxHeight: 260 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                  {anos.map((a) => (
                    <TouchableOpacity
                      key={a}
                      onPress={() => selecionarAno(a)}
                      style={[st.anoBtn, a === ano && st.diaBtnSelecionado]}
                    >
                      <Text style={[st.anoTexto, a === ano && st.diaTextoSelecionado]}>{a}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            ) : (
              <>
                <View style={st.linhaSemana}>
                  {DIAS_SEMANA.map((d, i) => <Text key={i} style={st.diaSemanaTexto}>{d}</Text>)}
                </View>

                <View style={st.grade}>
                  {celulas.map((dia, i) => (
                    <View key={i} style={st.celula}>
                      {dia !== null && (
                        <TouchableOpacity
                          onPress={() => selecionarDia(dia)}
                          style={[
                            st.diaBtn,
                            ehSelecionado(dia) && st.diaBtnSelecionado,
                            ehHoje(dia) && !ehSelecionado(dia) && st.diaBtnHoje,
                          ]}
                        >
                          <Text style={[st.diaTexto, ehSelecionado(dia) && st.diaTextoSelecionado]}>{dia}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>

                <TouchableOpacity style={st.hojeBtn} onPress={irParaHoje}>
                  <Text style={st.hojeBtnText}>Hoje</Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const st = StyleSheet.create({
  campo: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderColor: C.BORDER, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: "#fff",
  },
  campoTexto: { fontSize: 15, color: C.TEXT },
  icone: { fontSize: 16 },
  overlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  painel: { width: "100%", maxWidth: 340, backgroundColor: "#fff", borderRadius: 16, padding: 16 },
  cabecalho: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  setaBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: C.BG },
  seta: { fontSize: 20, color: C.BRAND, fontWeight: "700" },
  setaDupla: { fontSize: 15, color: C.BRAND, fontWeight: "700" },
  mesAno: { fontSize: 15, fontWeight: "700", color: C.TEXT, textTransform: "capitalize" },
  linhaSemana: { flexDirection: "row" },
  diaSemanaTexto: { flex: 1, textAlign: "center", fontSize: 12, fontWeight: "700", color: C.TEXT_MUTED, marginBottom: 4 },
  grade: { flexDirection: "row", flexWrap: "wrap" },
  celula: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  diaBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  diaBtnSelecionado: { backgroundColor: C.BRAND },
  diaBtnHoje: { borderWidth: 1.5, borderColor: C.BRAND },
  diaTexto: { fontSize: 14, color: C.TEXT },
  diaTextoSelecionado: { color: "#fff", fontWeight: "700" },
  hojeBtn: { marginTop: 8, alignSelf: "center", paddingVertical: 8, paddingHorizontal: 16 },
  hojeBtnText: { color: C.BRAND, fontWeight: "700", fontSize: 13 },
  anoBtn: { width: 70, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: C.BG },
  anoTexto: { fontSize: 14, fontWeight: "600", color: C.TEXT },
});
