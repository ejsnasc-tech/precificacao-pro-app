// parseFloat puro corta a parte decimal quando o usuário digita vírgula
// (padrão brasileiro) — ex: parseFloat("4000,52") retorna 4000. Usar sempre
// que o valor vier de um TextInput com keyboardType="decimal-pad".
export function parseValorBR(v: string): number {
  const limpo = v.trim();
  if (!limpo) return 0;
  if (limpo.includes(",")) return parseFloat(limpo.replace(/\./g, "").replace(",", ".")) || 0;
  return parseFloat(limpo) || 0;
}
