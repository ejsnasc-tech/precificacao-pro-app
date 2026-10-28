import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView } from "react-native";
import * as C from "@/constants/colors";
import { parseValorBR } from "@/lib/numero";
import { custoPorEmbalagem, arredondar4, UNIDADES_INGREDIENTE } from "@/lib/embalagem";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Calculadora "comprei uma embalagem de X por R$ Y": devolve o preço por
// unidade do ingrediente (kg, L, un...) pro campo de custo do formulário.
export default function EmbalagemCalc({ unidade, onCusto }: { unidade: string; onCusto: (custo: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [preco, setPreco] = useState("");
  const [qtd, setQtd] = useState("");
  const [un, setUn] = useState(unidade);

  const precoN = parseValorBR(preco);
  const qtdN = parseValorBR(qtd);
  const resultado = custoPorEmbalagem(precoN, qtdN, un, unidade);
  const incompativel = precoN > 0 && qtdN > 0 && resultado === null;

  function atualizar(p: string, q: string, u: string) {
    setPreco(p); setQtd(q); setUn(u);
    const r = custoPorEmbalagem(parseValorBR(p), parseValorBR(q), u, unidade);
    if (r !== null) onCusto(String(arredondar4(r)));
  }

  if (!aberto) {
    return (
      <TouchableOpacity onPress={() => setAberto(true)} style={{ paddingVertical: 4 }}>
        <Text style={{ color: C.BRAND, fontSize: 13, fontWeight: "600" }}>📦 Calcular pelo preço da embalagem</Text>
      </TouchableOpacity>
    );
  }

  const inputStyle = { flex: 1, minWidth: 0, borderWidth: 1, borderColor: C.BORDER, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, backgroundColor: "#fff", color: C.TEXT };
  return (
    <View style={{ backgroundColor: "#eef2ff", borderColor: "#e0e7ff", borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: C.BRAND_DARK }}>📦 Preço da embalagem</Text>
        <TouchableOpacity onPress={() => setAberto(false)}><Text style={{ fontSize: 12, color: C.TEXT_MUTED }}>fechar</Text></TouchableOpacity>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput style={inputStyle} value={preco} onChangeText={(v) => atualizar(v, qtd, un)} placeholder="Pagou R$" placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />
        <TextInput style={inputStyle} value={qtd} onChangeText={(v) => atualizar(preco, v, un)} placeholder="Veio quanto?" placeholderTextColor={C.TEXT_MUTED} keyboardType="decimal-pad" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {UNIDADES_INGREDIENTE.map((u) => (
          <TouchableOpacity key={u} onPress={() => atualizar(preco, qtd, u)}
            style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginRight: 6, borderWidth: 1, borderColor: un === u ? C.BRAND : C.BORDER, backgroundColor: un === u ? C.BRAND : "#fff" }}>
            <Text style={{ fontSize: 13, color: un === u ? "#fff" : C.TEXT_MUTED, fontWeight: "600" }}>{u}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {resultado !== null && (
        <Text style={{ fontSize: 12, color: C.BRAND_DARK }}>
          = <Text style={{ fontWeight: "700" }}>{fmt(resultado)}</Text> por {unidade === "g" ? "kg" : unidade === "ml" ? "L" : unidade}. Já preenchido no custo.
        </Text>
      )}
      {incompativel && <Text style={{ fontSize: 12, color: "#b45309" }}>A unidade da embalagem não combina com a do ingrediente ({unidade}).</Text>}
    </View>
  );
}
