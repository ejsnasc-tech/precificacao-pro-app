import { useEffect } from "react";
import { AppState } from "react-native";
import { getDB } from "@/lib/db";
import { requestNotificationPermission, enviarNotificacao } from "@/lib/notifications";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Evita reenviar a mesma notificação toda vez que o app abre: cada alerta tem
// uma "chave" que muda se o conteúdo relevante mudar (ex: lista de itens em
// falta), então só notifica de novo quando algo realmente muda.
function jaNotificou(chave: string): boolean {
  const db = getDB();
  const row = db.getFirstSync<{ chave: string }>(
    "SELECT chave FROM alertas_notificados WHERE chave = ?",
    [chave]
  );
  return !!row;
}

function marcarNotificado(chave: string) {
  const db = getDB();
  db.runSync(
    "INSERT OR REPLACE INTO alertas_notificados (chave, notificado_em) VALUES (?, datetime('now'))",
    [chave]
  );
}

async function notificarSeNovo(chave: string, titulo: string, corpo: string, data: Record<string, string>) {
  if (jaNotificou(chave)) return;
  await enviarNotificacao(titulo, corpo, data);
  marcarNotificado(chave);
}

async function checarAlertas() {
  const podeNotificar = await requestNotificationPermission();
  if (!podeNotificar) return;

  const db = getDB();
  const hoje = new Date().toISOString().slice(0, 10);

  // ── 1. Estoque vencendo ──────────────────────────────────────────────────────
  const vencendo = db.getAllSync<{ nome_item: string; data_validade: string; dias_alerta: number }>(
    `SELECT e.nome AS nome_item, m.data_validade, e.dias_alerta
     FROM estoque_movimentos m
     JOIN estoque e ON e.id = m.estoque_id
     WHERE m.data_validade IS NOT NULL
       AND date(m.data_validade) >= date(?)
       AND date(m.data_validade) <= date(?, '+' || e.dias_alerta || ' days')
     GROUP BY m.estoque_id`,
    [hoje, hoje]
  );
  for (const item of vencendo) {
    const diasRestantes = Math.round(
      (new Date(item.data_validade).getTime() - new Date(hoje).getTime()) / 86400000
    );
    await notificarSeNovo(
      `venc:${item.nome_item}:${item.data_validade}:${hoje}`,
      "⏰ Produto vencendo em breve",
      `${item.nome_item} vence em ${diasRestantes === 0 ? "hoje" : `${diasRestantes} dia${diasRestantes > 1 ? "s" : ""}`}`,
      { tipo: "estoque_vencimento" }
    );
  }

  // ── 2. Estoque abaixo do mínimo ──────────────────────────────────────────────
  const abaixoMinimo = db.getAllSync<{ nome: string; quantidade_atual: number; quantidade_minima: number; unidade: string }>(
    `SELECT nome, quantidade_atual, quantidade_minima, unidade
     FROM estoque
     WHERE quantidade_minima > 0 AND quantidade_atual <= quantidade_minima
     ORDER BY nome`
  );
  if (abaixoMinimo.length > 0) {
    const nomes = abaixoMinimo.map(i => i.nome).join(", ");
    await notificarSeNovo(
      `estoque_min:${hoje}:${nomes}`,
      "📦 Estoque baixo",
      abaixoMinimo.length === 1
        ? `${abaixoMinimo[0].nome} está abaixo do estoque mínimo`
        : `${abaixoMinimo.length} itens abaixo do mínimo: ${nomes}`,
      { tipo: "estoque_minimo" }
    );
  }

  // ── 3. Metas pessoais próximas (≥ 80%) ──────────────────────────────────────
  const metasProximas = db.getAllSync<{ nome: string; emoji: string; valor_atual: number; valor_alvo: number }>(
    `SELECT nome, emoji, valor_atual, valor_alvo
     FROM metas_pessoais
     WHERE concluida = 0 AND valor_alvo > 0 AND (valor_atual * 1.0 / valor_alvo) >= 0.8`
  );
  for (const meta of metasProximas) {
    const pct = Math.round((meta.valor_atual / meta.valor_alvo) * 100);
    await notificarSeNovo(
      `meta:${meta.nome}:${pct}:${hoje}`,
      `${meta.emoji} Meta quase atingida!`,
      `"${meta.nome}" está em ${pct}% — quase lá!`,
      { tipo: "meta" }
    );
  }

  // ── 4. Cartões: meta de fatura e limite de crédito ──────────────────────────
  const cartoes = db.getAllSync<{
    id: number; nome: string; limite: number; dia_fechamento: number;
    limite_alerta_pct: number; meta_fatura: number; bandeira: string;
  }>(
    `SELECT id, nome, limite, dia_fechamento, limite_alerta_pct, meta_fatura, bandeira FROM cartoes_pessoais WHERE limite > 0`
  );
  for (const cartao of cartoes) {
    const diaHoje = new Date().getDate();
    let anoInicio = new Date().getFullYear();
    let mesInicio = new Date().getMonth();
    if (diaHoje <= cartao.dia_fechamento) {
      mesInicio -= 1;
      if (mesInicio < 0) { mesInicio = 11; anoInicio -= 1; }
    }
    const inicioCiclo = `${anoInicio}-${String(mesInicio + 1).padStart(2, "0")}-${String(cartao.dia_fechamento + 1).padStart(2, "0")}`;
    const row = db.getFirstSync<{ total: number }>(
      `SELECT COALESCE(SUM(valor), 0) AS total FROM gastos_cartao WHERE cartao_id = ? AND data >= ?`,
      [cartao.id, inicioCiclo]
    );
    const totalGasto = row?.total ?? 0;

    // Alerta de meta de fatura (prioridade maior)
    if (cartao.meta_fatura > 0 && totalGasto >= cartao.meta_fatura) {
      await notificarSeNovo(
        `cartao_meta:${cartao.id}:${hoje}`,
        "🚫 Meta de fatura atingida!",
        `${cartao.nome}: fatura em ${fmt(totalGasto)} — meta era ${fmt(cartao.meta_fatura)}. Evite novos gastos neste cartão.`,
        { tipo: "cartao_meta_fatura" }
      );
    } else if (cartao.meta_fatura > 0 && totalGasto >= cartao.meta_fatura * 0.8) {
      // 80% da meta de fatura
      const pctMeta = Math.round((totalGasto / cartao.meta_fatura) * 100);
      await notificarSeNovo(
        `cartao_meta_aviso:${cartao.id}:${hoje}`,
        "⚠️ Fatura quase no limite!",
        `${cartao.nome}: ${fmt(totalGasto)} de ${fmt(cartao.meta_fatura)} (${pctMeta}% da meta)`,
        { tipo: "cartao_meta_fatura_aviso" }
      );
    } else {
      // Alerta de limite de crédito
      const limiteAlerta = cartao.limite * (cartao.limite_alerta_pct / 100);
      if (totalGasto >= limiteAlerta) {
        const pct = Math.round((totalGasto / cartao.limite) * 100);
        await notificarSeNovo(
          `cartao_limite:${cartao.id}:${hoje}`,
          "💳 Limite do cartão",
          `${cartao.nome} está ${pct}% utilizado do limite de crédito`,
          { tipo: "cartao_limite" }
        );
      }
    }
  }
}

export function useAlertas() {
  useEffect(() => {
    // Verifica na abertura do app
    checarAlertas();

    // Re-verifica toda vez que o app volta ao primeiro plano
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") checarAlertas();
    });

    return () => sub.remove();
  }, []);
}
