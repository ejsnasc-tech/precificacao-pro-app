// Propaga mudança de preço de um item do catálogo para os ingredientes dos
// produtos da mesma empresa. O ingrediente dentro do produto guarda uma cópia
// do preço (não há vínculo por id), então a ligação é pelo nome — e só vale
// se a unidade for da mesma família. kg/g guardam o mesmo valor (R$ por kg) e
// L/ml também (R$ por litro, ver calcSub em precificacao.tsx); já "un" e
// "kg" são grandezas diferentes e não podem trocar preço entre si.

import { getDB } from "@/lib/db";

function chave(nome: string): string {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function familia(unidade: string): string {
  if (unidade === "kg" || unidade === "g") return "massa";
  if (unidade === "L" || unidade === "ml") return "volume";
  return unidade;
}

interface MudancaCatalogo {
  empresaId: number;
  nomeAntigo: string;
  nomeNovo: string;
  unidadeNova: string;
  custoNovo: number;
}

// Retorna quantos produtos tiveram algum ingrediente atualizado.
export function propagarPrecoCatalogo(m: MudancaCatalogo): number {
  const db = getDB();
  const ingredientes = db.getAllSync<{ id: number; produto_id: number; nome: string; unidade: string; custo_por_unidade: number }>(
    `SELECT pi.id, pi.produto_id, pi.nome, pi.unidade, pi.custo_por_unidade
       FROM produto_ingredientes pi JOIN produtos p ON p.id = pi.produto_id
      WHERE p.empresa_id = ?`,
    [m.empresaId]
  );
  const alvo = chave(m.nomeAntigo);
  const afetados = new Set<number>();

  for (const ing of ingredientes) {
    if (chave(ing.nome) !== alvo) continue;
    if (familia(ing.unidade) !== familia(m.unidadeNova)) continue;
    if (ing.custo_por_unidade === m.custoNovo && ing.nome === m.nomeNovo) continue;
    db.runSync("UPDATE produto_ingredientes SET custo_por_unidade = ?, nome = ? WHERE id = ?", [m.custoNovo, m.nomeNovo, ing.id]);
    afetados.add(ing.produto_id);
  }
  return afetados.size;
}
