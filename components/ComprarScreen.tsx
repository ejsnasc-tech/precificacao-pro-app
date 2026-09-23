import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIAP, type Purchase } from "expo-iap";
import { ativarCodigo } from "@/lib/licenca";
import * as C from "@/constants/colors";

const API_BASE = "https://topprecificacao.com.br";

const ASSINATURAS = [
  "com.ejsnasc.precificacaopro.mensal30",
  "com.ejsnasc.precificacaopro.trimestral90",
  "com.ejsnasc.precificacaopro.semestral180",
  "com.ejsnasc.precificacaopro.anual365",
] as const;
const VITALICIO = "com.ejsnasc.precificacaopro.vitalicio";

const NOME_PLANO: Record<string, string> = {
  "com.ejsnasc.precificacaopro.mensal30": "Mensal",
  "com.ejsnasc.precificacaopro.trimestral90": "Trimestral",
  "com.ejsnasc.precificacaopro.semestral180": "Semestral",
  "com.ejsnasc.precificacaopro.anual365": "Anual",
  [VITALICIO]: "Vitalício",
};

// Precisa bater com PRODUTOS em src/app/api/iap/apple/route.ts (site) — é lá
// que o número de colaboradores é de fato aplicado ao gerar o código.
const COLABORADORES_PLANO: Record<string, number> = {
  "com.ejsnasc.precificacaopro.mensal30": 0,
  "com.ejsnasc.precificacaopro.trimestral90": 2,
  "com.ejsnasc.precificacaopro.semestral180": 3,
  "com.ejsnasc.precificacaopro.anual365": 4,
  [VITALICIO]: 6,
};

export default function ComprarScreen({
  nome, email, onAtivado, onVoltar,
}: { nome: string; email: string; onAtivado: () => void; onVoltar: () => void }) {
  const [ativando, setAtivando] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  const [erro, setErro] = useState("");

  const {
    connected, subscriptions, products, fetchProducts, requestPurchase, finishTransaction, restorePurchases,
  } = useIAP({
    onPurchaseSuccess: (purchase) => { void processarCompra(purchase); },
    onPurchaseError: (error) => {
      setAtivando(null);
      Alert.alert("Não foi possível concluir a compra", error.message ?? "Tente novamente.");
    },
  });

  useEffect(() => {
    if (!connected) return;
    void fetchProducts({ skus: [...ASSINATURAS], type: "subs" });
    void fetchProducts({ skus: [VITALICIO], type: "in-app" });
  }, [connected]);

  async function processarCompra(purchase: Purchase) {
    try {
      const purchaseToken = (purchase as { purchaseToken?: string | null }).purchaseToken;
      if (!purchaseToken) throw new Error("Compra sem token válido.");

      const res = await fetch(`${API_BASE}/api/iap/apple`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseToken, productId: purchase.productId, nome, email }),
      });
      const data = await res.json() as { codigo?: string; erro?: string };
      if (!res.ok || !data.codigo) throw new Error(data.erro ?? "Não foi possível confirmar a compra.");

      await finishTransaction({ purchase, isConsumable: false });

      const resultado = await ativarCodigo(data.codigo, nome, email);
      if (!resultado.ok) throw new Error(resultado.erro);

      onAtivado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao processar a compra.");
    } finally {
      setAtivando(null);
    }
  }

  async function comprar(sku: string, tipo: "subs" | "in-app") {
    setErro("");
    setAtivando(sku);
    try {
      await requestPurchase({
        type: tipo,
        request: { apple: { sku } },
      } as never);
    } catch (e) {
      setAtivando(null);
      setErro(e instanceof Error ? e.message : "Erro ao iniciar a compra.");
    }
  }

  // Compras não-consumíveis (Vitalício) e assinaturas precisam poder ser
  // restauradas (reinstalou o app, trocou de aparelho). O próprio evento
  // de restauração passa pelo mesmo onPurchaseSuccess acima, que já reaproveita
  // o código existente no backend (idempotência por transactionId).
  async function restaurar() {
    setErro("");
    setRestaurando(true);
    try {
      await restorePurchases();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível restaurar a compra.");
    } finally {
      setRestaurando(false);
    }
  }

  const planos = [
    ...subscriptions.map((p) => ({ sku: p.id, displayPrice: p.displayPrice, tipo: "subs" as const })),
    ...products.filter((p) => p.id === VITALICIO).map((p) => ({ sku: p.id, displayPrice: p.displayPrice, tipo: "in-app" as const })),
  ];

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        <TouchableOpacity onPress={onVoltar} style={s.voltar}>
          <Text style={s.voltarText}>‹ Voltar</Text>
        </TouchableOpacity>

        <Text style={s.emoji}>💳</Text>
        <Text style={s.titulo}>Assinar o Top Precificação</Text>
        <Text style={s.sub}>Todos os planos começam com 7 dias grátis. Cancele quando quiser.</Text>

        {!connected ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={C.BRAND} />
        ) : planos.length === 0 ? (
          <Text style={s.hint}>Carregando planos...</Text>
        ) : (
          <View style={{ gap: 12, marginTop: 12 }}>
            {planos.map((p) => (
              <TouchableOpacity
                key={p.sku}
                style={[s.card, ativando === p.sku && { opacity: 0.6 }]}
                disabled={ativando !== null}
                onPress={() => comprar(p.sku, p.tipo)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitulo}>{NOME_PLANO[p.sku] ?? p.sku}</Text>
                  {p.sku !== VITALICIO && <Text style={s.cardHint}>7 dias grátis, depois cobrança automática</Text>}
                  <Text style={s.cardColab}>
                    {COLABORADORES_PLANO[p.sku] > 0
                      ? `👥 Inclui ${COLABORADORES_PLANO[p.sku]} colaborador${COLABORADORES_PLANO[p.sku] > 1 ? "es" : ""}`
                      : "Sem colaboradores inclusos"}
                  </Text>
                </View>
                {ativando === p.sku ? <ActivityIndicator color={C.BRAND} /> : <Text style={s.cardPreco}>{p.displayPrice}</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity onPress={restaurar} disabled={restaurando} style={s.restaurar}>
          {restaurando
            ? <ActivityIndicator color={C.TEXT_MUTED} />
            : <Text style={s.restaurarText}>Já comprou antes? Restaurar compra</Text>}
        </TouchableOpacity>

        {erro ? <Text style={s.erro}>{erro}</Text> : null}

        <Text style={s.legal}>
          Assinaturas renovam automaticamente pelo mesmo valor ao fim de cada período,
          salvo cancelamento nas configurações da sua conta Apple.{" "}
          <Text style={s.legalLink} onPress={() => Linking.openURL("https://topprecificacao.com.br/termos")}>
            Termos de Uso
          </Text>
          {"  ·  "}
          <Text style={s.legalLink} onPress={() => Linking.openURL("https://topprecificacao.com.br/privacidade")}>
            Privacidade
          </Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.BG },
  scroll: { padding: 24, paddingTop: 20 },
  voltar: { marginBottom: 12 },
  voltarText: { color: C.BRAND, fontWeight: "700", fontSize: 15 },
  emoji: { fontSize: 44, textAlign: "center", marginBottom: 8 },
  titulo: { fontSize: 22, fontWeight: "900", color: C.TEXT, textAlign: "center" },
  sub: { fontSize: 13, color: C.TEXT_MUTED, textAlign: "center", marginTop: 6, marginBottom: 12, lineHeight: 18 },
  hint: { fontSize: 13, color: C.TEXT_MUTED, textAlign: "center", marginTop: 24 },
  card: {
    flexDirection: "row", alignItems: "center", backgroundColor: C.CARD, borderWidth: 1, borderColor: C.BORDER,
    borderRadius: 14, padding: 16,
  },
  cardTitulo: { fontSize: 16, fontWeight: "800", color: C.TEXT },
  cardHint: { fontSize: 11, color: C.TEXT_MUTED, marginTop: 2 },
  cardColab: { fontSize: 11, color: C.BRAND, fontWeight: "600", marginTop: 3 },
  cardPreco: { fontSize: 16, fontWeight: "800", color: C.BRAND },
  restaurar: { marginTop: 20, paddingVertical: 8, alignItems: "center" },
  restaurarText: { color: C.TEXT_MUTED, fontSize: 12.5, fontWeight: "600" },
  erro: { color: C.DANGER, fontSize: 13, textAlign: "center", backgroundColor: "#fef2f2", borderRadius: 10, padding: 10, marginTop: 20 },
  legal: { fontSize: 11, color: C.TEXT_MUTED, textAlign: "center", lineHeight: 17, marginTop: 22, paddingHorizontal: 8 },
  legalLink: { color: C.BRAND, fontWeight: "700" },
});
