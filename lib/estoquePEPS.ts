// Custo das retiradas pelo PEPS (primeiro que entra, primeiro que sai).
// Cada entrada é um lote (quantidade + preço pago). A retirada consome os lotes
// mais antigos primeiro, então 10 farinhas a R$ 5 e depois 50 a R$ 6 saem
// primeiro a R$ 5. O lote é reconstruído do histórico de movimentos; o preço
// da retirada fica gravado no próprio movimento (valor_unitario) pra não mudar
// depois.

export interface MovPEPS {
  id?: number;
  tipo: string;
  quantidade: number;
  valor_unitario?: number | null;
  criado_at: string;
}

export interface Lote { qtd: number; preco: number }

const EPS = 1e-9;

// "YYYY-MM-DD HH:MM:SS" (app mobile) e ISO (site) precisam ordenar juntos.
const quando = (m: MovPEPS) => m.criado_at.replace(" ", "T");

// Lotes que ainda estão na prateleira. Entradas sem preço (anteriores a essa
// regra) valem o último preço do item. No fim, ajusta à quantidade real do
// item: se o histórico não fecha (alterações antigas sem registro), o que
// sobra vale o último preço e o que excede sai dos lotes mais antigos.
export function lotesAtuais(movs: MovPEPS[], saldoAtual: number, ultimoPreco: number): Lote[] {
  const ordenados = [...movs].sort((a, b) => quando(a).localeCompare(quando(b)) || (a.id ?? 0) - (b.id ?? 0));
  const lotes: Lote[] = [];
  const total = () => lotes.reduce((a, l) => a + l.qtd, 0);
  const consumir = (q: number) => {
    let resto = q;
    while (resto > EPS && lotes.length > 0) {
      const l = lotes[0];
      const t = Math.min(l.qtd, resto);
      l.qtd -= t; resto -= t;
      if (l.qtd <= EPS) lotes.shift();
    }
  };

  for (const m of ordenados) {
    const preco = m.valor_unitario != null && m.valor_unitario > 0 ? m.valor_unitario : ultimoPreco;
    if (m.tipo === "entrada") {
      lotes.push({ qtd: m.quantidade, preco });
    } else if (m.tipo === "saida") {
      consumir(m.quantidade);
    } else if (m.tipo === "ajuste") {
      // ajuste define a quantidade final (ver registrarMovimento nas telas)
      const delta = m.quantidade - total();
      if (delta < -EPS) consumir(-delta);
      else if (delta > EPS) lotes.push({ qtd: delta, preco });
    }
  }

  const t = total();
  if (t < saldoAtual - EPS) lotes.push({ qtd: saldoAtual - t, preco: ultimoPreco });
  else if (t > saldoAtual + EPS) consumir(t - saldoAtual);
  return lotes;
}

// Custo unitário médio de retirar "qtd" agora (consome os lotes sem alterá-los).
// Se pedir mais do que existe, o excedente não entra na conta.
export function custoUnitarioRetirada(lotes: Lote[], qtd: number, ultimoPreco: number): number {
  let resto = qtd, total = 0, retirado = 0;
  for (const l of lotes) {
    if (resto <= EPS) break;
    const t = Math.min(l.qtd, resto);
    total += t * l.preco; retirado += t; resto -= t;
  }
  if (retirado <= EPS) return ultimoPreco;
  return total / retirado;
}

// Atalho pras telas: custo unitário de tirar "qtd" de um item.
export function custoUnitarioSaida(movs: MovPEPS[], saldoAtual: number, ultimoPreco: number, qtd: number): number {
  return custoUnitarioRetirada(lotesAtuais(movs, saldoAtual, ultimoPreco), qtd, ultimoPreco);
}
