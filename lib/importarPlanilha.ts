// Importação de planilha (.xlsx/.csv) com mapeamento de colunas. Aqui só tem a
// parte sem tela e sem leitura de arquivo: achar o cabeçalho, sugerir quais
// colunas são quais, e montar o plano do que vai entrar (novos / já existem /
// problemas). Quem lê o arquivo e grava no banco é cada plataforma.
import { custoReal } from "./embalagem";

export interface CampoImport {
  chave: string;
  rotulo: string;
  obrigatorio: boolean;
  dica: string;
  sinonimos: string[];
}

export const CAMPOS_INGREDIENTE: CampoImport[] = [
  { chave: "nome", rotulo: "Ingrediente", obrigatorio: true, dica: "nome do ingrediente", sinonimos: ["ingrediente", "nome", "insumo", "materia prima", "item", "descricao", "produto"] },
  { chave: "preco", rotulo: "Preço", obrigatorio: true, dica: "quanto custa por unidade (ex.: R$ por kg)", sinonimos: ["preco", "custo", "valor", "preco unitario", "custo unitario", "valor unitario", "preco por kg", "preco kg", "r$"] },
  { chave: "unidade", rotulo: "Unidade", obrigatorio: false, dica: "kg, g, L, ml, un…", sinonimos: ["unidade", "un", "und", "unid", "medida", "unidade de medida"] },
  { chave: "fator", rotulo: "Fator de correção", obrigatorio: false, dica: "perda na limpeza (1 = sem perda)", sinonimos: ["fator", "fator de correcao", "fc", "correcao"] },
];

export const CAMPOS_PRODUTO: CampoImport[] = [
  { chave: "produto", rotulo: "Produto / receita", obrigatorio: true, dica: "nome do produto (pode ficar em branco nas linhas seguintes)", sinonimos: ["produto", "receita", "prato", "item", "nome"] },
  { chave: "ingrediente", rotulo: "Ingrediente", obrigatorio: true, dica: "ingrediente usado na receita", sinonimos: ["ingrediente", "insumo", "materia prima", "componente"] },
  { chave: "quantidade", rotulo: "Quantidade", obrigatorio: true, dica: "quanto vai na receita", sinonimos: ["quantidade", "qtd", "qtde", "quant", "peso", "medida"] },
  { chave: "unidade", rotulo: "Unidade", obrigatorio: false, dica: "g, kg, ml, L, un…", sinonimos: ["unidade", "un", "und", "unid", "unidade de medida"] },
  { chave: "margem", rotulo: "Margem de lucro (%)", obrigatorio: false, dica: "se não tiver, entra 30%", sinonimos: ["margem", "margem de lucro", "lucro", "margem %"] },
];

export type Mapa = Record<string, number>; // chave do campo -> índice da coluna (-1 = não usar)

export function chaveNome(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function vazio(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

// A primeira linha com pelo menos duas células preenchidas é o cabeçalho
// (planilhas costumam ter título solto nas primeiras linhas).
export function acharCabecalho(linhas: unknown[][]): number {
  const i = linhas.findIndex((l) => l.filter((c) => !vazio(c)).length >= 2);
  return i < 0 ? 0 : i;
}

export function sugerirMapa(cabecalhos: unknown[], campos: CampoImport[]): Mapa {
  const cab = cabecalhos.map(chaveNome);
  const usadas = new Set<number>();
  const mapa: Mapa = {};
  // Primeiro nome igual a um sinônimo, depois só "contém".
  for (const modo of ["igual", "contem"] as const) {
    for (const c of campos) {
      if (mapa[c.chave] != null && mapa[c.chave] >= 0) continue;
      for (const sin of c.sinonimos) {
        const idx = cab.findIndex((h, i) => !usadas.has(i) && h !== "" && (modo === "igual" ? h === sin : h.includes(sin) && sin.length > 2));
        if (idx >= 0) { mapa[c.chave] = idx; usadas.add(idx); break; }
      }
    }
  }
  for (const c of campos) if (mapa[c.chave] == null) mapa[c.chave] = -1;
  return mapa;
}

export function faltaObrigatorio(mapa: Mapa, campos: CampoImport[]): string[] {
  return campos.filter((c) => c.obrigatorio && !(mapa[c.chave] >= 0)).map((c) => c.rotulo);
}

// Aceita número de verdade ou texto no padrão brasileiro ("R$ 1.234,56", "0,5").
export function parseNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (vazio(v)) return null;
  const limpo = String(v).replace(/R\$|\s/g, "");
  const n = limpo.includes(",") ? parseFloat(limpo.replace(/\./g, "").replace(",", ".")) : parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}

const UNIDADES: Record<string, string> = {
  kg: "kg", kgs: "kg", quilo: "kg", quilos: "kg", kilo: "kg", kilos: "kg", quilograma: "kg", quilogramas: "kg",
  g: "g", gr: "g", grs: "g", grama: "g", gramas: "g",
  l: "L", lt: "L", lts: "L", litro: "L", litros: "L",
  ml: "ml", mililitro: "ml", mililitros: "ml",
  un: "un", und: "un", unid: "un", unidade: "un", unidades: "un", ud: "un",
  cx: "cx", caixa: "cx", caixas: "cx",
  pc: "pc", pç: "pc", pct: "pc", peca: "pc", pecas: "pc", pacote: "pc", pacotes: "pc",
};

export function normalizarUnidade(v: unknown): string | null {
  return UNIDADES[chaveNome(v).replace(/\./g, "")] ?? null;
}

function familia(u: string): string {
  if (u === "kg" || u === "g") return "massa";
  if (u === "L" || u === "ml") return "volume";
  return u;
}

export interface Problema { linha: number; motivo: string }

export interface IngPlano { linha: number; nome: string; unidade: string; custo: number; fator: number }

export interface PlanoIngredientes { novos: IngPlano[]; jaExistem: IngPlano[]; problemas: Problema[] }

const celula = (l: unknown[], mapa: Mapa, chave: string): unknown => (mapa[chave] >= 0 ? l[mapa[chave]] : undefined);

// "linhas" são as linhas de dados (já sem o cabeçalho); numeração mostrada ao
// usuário começa em "primeiraLinha" (a linha da planilha, contando o cabeçalho).
export function planejarIngredientes(linhas: unknown[][], mapa: Mapa, existentes: { nome: string }[], primeiraLinha = 2): PlanoIngredientes {
  const jaTem = new Set(existentes.map((e) => chaveNome(e.nome)));
  const vistos = new Set<string>();
  const plano: PlanoIngredientes = { novos: [], jaExistem: [], problemas: [] };
  linhas.forEach((l, i) => {
    const n = primeiraLinha + i;
    if (l.every(vazio)) return;
    const nome = String(celula(l, mapa, "nome") ?? "").trim();
    if (!nome) { plano.problemas.push({ linha: n, motivo: "sem nome do ingrediente" }); return; }
    let preco = parseNumero(celula(l, mapa, "preco"));
    if (preco == null || preco < 0) { plano.problemas.push({ linha: n, motivo: `"${nome}": preço vazio ou inválido` }); return; }
    const bruta = celula(l, mapa, "unidade");
    let unidade = vazio(bruta) ? "kg" : normalizarUnidade(bruta);
    if (!unidade) { plano.problemas.push({ linha: n, motivo: `"${nome}": unidade "${String(bruta)}" não reconhecida` }); return; }
    // No catálogo, g guarda R$ por kg e ml guarda R$ por litro: converte pra não errar a conta.
    if (unidade === "g") { unidade = "kg"; preco *= 1000; }
    else if (unidade === "ml") { unidade = "L"; preco *= 1000; }
    const f = parseNumero(celula(l, mapa, "fator"));
    const item: IngPlano = { linha: n, nome, unidade, custo: Math.round(preco * 10000) / 10000, fator: f != null && f >= 1 ? f : 1 };
    const chave = chaveNome(nome);
    if (vistos.has(chave)) { plano.problemas.push({ linha: n, motivo: `"${nome}": repetido na planilha (ficou só a primeira)` }); return; }
    vistos.add(chave);
    (jaTem.has(chave) ? plano.jaExistem : plano.novos).push(item);
  });
  return plano;
}

export interface IngReceita { nome: string; quantidade: number; unidade: string; custo: number; semPreco: boolean }
export interface ProdPlano { nome: string; margem: number; ingredientes: IngReceita[] }
export interface PlanoProdutos { novos: ProdPlano[]; jaExistem: string[]; problemas: Problema[]; semPreco: number }

export interface ItemCatalogo { nome: string; unidade: string; custo_por_unidade: number; fator_correcao?: number | null }

// Uma linha por ingrediente da receita; o nome do produto pode ficar em branco
// nas linhas seguintes (célula mesclada). O preço vem do catálogo: importe os
// ingredientes antes pra os produtos já saírem com custo.
export function planejarProdutos(linhas: unknown[][], mapa: Mapa, produtosExistentes: string[], catalogo: ItemCatalogo[], primeiraLinha = 2): PlanoProdutos {
  const jaTem = new Set(produtosExistentes.map(chaveNome));
  const porNome = new Map<string, ItemCatalogo>();
  for (const c of catalogo) if (!porNome.has(chaveNome(c.nome))) porNome.set(chaveNome(c.nome), c);
  const grupos = new Map<string, ProdPlano>();
  const problemas: Problema[] = [];
  let atual = "";
  linhas.forEach((l, i) => {
    const n = primeiraLinha + i;
    if (l.every(vazio)) return;
    const nomeProd = String(celula(l, mapa, "produto") ?? "").trim();
    if (nomeProd) atual = nomeProd;
    if (!atual) { problemas.push({ linha: n, motivo: "sem nome de produto" }); return; }
    const nomeIng = String(celula(l, mapa, "ingrediente") ?? "").trim();
    if (!nomeIng) { problemas.push({ linha: n, motivo: `"${atual}": linha sem ingrediente` }); return; }
    const qtd = parseNumero(celula(l, mapa, "quantidade"));
    if (qtd == null || !(qtd > 0)) { problemas.push({ linha: n, motivo: `"${atual}" / ${nomeIng}: quantidade vazia ou inválida` }); return; }
    const bruta = celula(l, mapa, "unidade");
    const cat = porNome.get(chaveNome(nomeIng));
    // Sem unidade na planilha, usa a do catálogo; se também não achar, não dá pra saber.
    const unidade = vazio(bruta) ? (cat ? (cat.unidade === "L" ? "ml" : cat.unidade === "kg" ? "g" : cat.unidade) : null) : normalizarUnidade(bruta);
    if (!unidade) { problemas.push({ linha: n, motivo: `"${atual}" / ${nomeIng}: unidade ${vazio(bruta) ? "não informada" : `"${String(bruta)}" não reconhecida`}` }); return; }
    const casa = !!cat && familia(cat.unidade) === familia(unidade);
    const ing: IngReceita = {
      nome: nomeIng, quantidade: qtd, unidade,
      custo: casa ? custoReal(cat!.custo_por_unidade, cat!.fator_correcao) : 0,
      semPreco: !casa || !(cat!.custo_por_unidade > 0),
    };
    const chave = chaveNome(atual);
    let g = grupos.get(chave);
    if (!g) { g = { nome: atual, margem: 30, ingredientes: [] }; grupos.set(chave, g); }
    const m = parseNumero(celula(l, mapa, "margem"));
    // Célula formatada como % no Excel vem como fração (0,3 = 30%).
    if (m != null && m > 0 && m < 100) g.margem = m < 1 ? m * 100 : m;
    g.ingredientes.push(ing);
  });
  const todos = [...grupos.entries()];
  return {
    novos: todos.filter(([k]) => !jaTem.has(k)).map(([, g]) => g),
    jaExistem: todos.filter(([k]) => jaTem.has(k)).map(([, g]) => g.nome),
    problemas,
    semPreco: todos.filter(([k]) => !jaTem.has(k)).reduce((a, [, g]) => a + g.ingredientes.filter((x) => x.semPreco).length, 0),
  };
}
