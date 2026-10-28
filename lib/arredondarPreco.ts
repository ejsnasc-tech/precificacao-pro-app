// Arredonda o preço de venda sempre pra cima, pra o arredondamento nunca comer
// margem: o lucro só pode ficar igual ou maior que o calculado.

export type ModoArredondamento = "nenhum" | "90" | "50" | "inteiro";

export const MODOS_ARREDONDAMENTO: { valor: ModoArredondamento; rotulo: string }[] = [
  { valor: "nenhum", rotulo: "Sem arredondar" },
  { valor: "90", rotulo: "Terminar em ,90" },
  { valor: "50", rotulo: "De 0,50 em 0,50" },
  { valor: "inteiro", rotulo: "Real inteiro" },
];

const centavos = (v: number) => Math.round(v * 100) / 100;
const FOLGA = 1e-9;

export function arredondarPreco(valor: number, modo: ModoArredondamento): number {
  if (!(valor > 0) || modo === "nenhum") return valor;
  if (modo === "inteiro") return centavos(Math.ceil(valor - FOLGA));
  if (modo === "50") return centavos(Math.ceil(valor * 2 - FOLGA) / 2);
  // ",90": o próximo valor terminado em 90 centavos que não fique abaixo do calculado.
  const base = Math.floor(valor + FOLGA);
  const candidato = base + 0.9;
  return centavos(candidato >= valor - FOLGA ? candidato : base + 1.9);
}
