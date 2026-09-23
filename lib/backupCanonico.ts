// Formato "canônico" de backup, compartilhado com o site (precificacao-pro),
// pra um backup exportado de um for importado no outro sem erro e sem perder
// dado. A maioria das tabelas do app já usa o mesmo nome/colunas do canônico
// — só empresas/produtos guardam a data como "criado_at" em vez de
// "criado_em". Toda a conversão pesada (nomes de tabela diferentes, modelos
// de dado diferentes) mora do lado do site, em src/lib/backupCanonico.ts.
export type Linhas = Record<string, unknown>[];
export type Backup = Record<string, Linhas>;

function renomearCampo(linhas: Linhas | undefined, de: string, para: string): Linhas | undefined {
  if (!linhas) return linhas;
  return linhas.map((linha) => {
    if (!(de in linha)) return linha;
    const { [de]: valor, ...resto } = linha;
    return { ...resto, [para]: valor };
  });
}

// Nativo (app) → canônico (formato do arquivo de backup). Só escreve a
// chave quando a tabela de origem estava de fato presente — um backup
// parcial não pode ganhar chave vazia extra (isso faria a importação
// limpar uma área que nem estava marcada pra exportar).
export function paraCanonico(nativo: Backup): Backup {
  const canonico: Backup = { ...nativo };
  if (nativo.empresas) canonico.empresas = renomearCampo(nativo.empresas, "criado_at", "criado_em")!;
  if (nativo.produtos) canonico.produtos = renomearCampo(nativo.produtos, "criado_at", "criado_em")!;
  return canonico;
}

// Canônico (formato do arquivo de backup) → nativo (app)
export function doCanonico(canonico: Backup): Backup {
  const nativo: Backup = { ...canonico };
  if (canonico.empresas) nativo.empresas = renomearCampo(canonico.empresas, "criado_em", "criado_at")!;
  if (canonico.produtos) nativo.produtos = renomearCampo(canonico.produtos, "criado_em", "criado_at")!;
  return nativo;
}
