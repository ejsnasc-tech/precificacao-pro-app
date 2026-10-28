// Contas de ingrediente: preço por embalagem -> preço por unidade, e fator de
// correção (perda na limpeza/preparo). No catálogo, kg/g guardam R$ por kg e
// L/ml guardam R$ por litro (ver calcSub em precificacao/page.tsx), então o
// resultado aqui já sai nessa base.

export const UNIDADES_INGREDIENTE = ["kg", "g", "L", "ml", "un", "cx", "pc"];

function grupo(unidade: string): string {
  if (unidade === "kg" || unidade === "g") return "massa";
  if (unidade === "L" || unidade === "ml") return "volume";
  return unidade;
}

// Quantidade da embalagem convertida pra kg / L (ou a própria quantidade, em un/cx/pc).
function emBase(qtd: number, unidade: string): number {
  return unidade === "g" || unidade === "ml" ? qtd / 1000 : qtd;
}

// Devolve null quando falta dado ou a unidade da embalagem não combina com a do
// ingrediente (ex.: embalagem em kg para um ingrediente contado em "un").
export function custoPorEmbalagem(preco: number, qtd: number, unidadeEmbalagem: string, unidadeIngrediente: string): number | null {
  if (!(preco > 0) || !(qtd > 0)) return null;
  if (grupo(unidadeEmbalagem) !== grupo(unidadeIngrediente)) return null;
  const g = grupo(unidadeIngrediente);
  if (g !== "massa" && g !== "volume" && unidadeEmbalagem !== unidadeIngrediente) return null;
  return preco / emBase(qtd, unidadeEmbalagem);
}

// Fator de correção = peso comprado / peso aproveitado (1 = sem perda).
// Valor inválido ou menor que 1 vale como 1.
export function fatorValido(fc: number | undefined | null): number {
  return fc != null && fc >= 1 ? fc : 1;
}

// Custo do que realmente vai no produto: preço de compra x fator de correção.
export function custoReal(custo: number, fc: number | undefined | null): number {
  return custo * fatorValido(fc);
}

export function arredondar4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
