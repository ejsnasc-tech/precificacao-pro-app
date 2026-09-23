import * as SQLite from "expo-sqlite";

let _db: SQLite.SQLiteDatabase | null = null;

export function getDB(): SQLite.SQLiteDatabase {
  if (!_db) _db = SQLite.openDatabaseSync("precificacao.db");
  return _db;
}

export async function initDB(): Promise<void> {
  const db = getDB();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS empresas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      descricao TEXT DEFAULT '',
      emoji TEXT DEFAULT '🏪',
      cor TEXT DEFAULT 'from-indigo-500 to-purple-600',
      criado_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS configuracoes_empresa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL UNIQUE,
      regime TEXT DEFAULT 'simples_nacional',
      anexo TEXT DEFAULT 'I',
      aliquota_custom REAL DEFAULT 6.0,
      taxa_debito REAL DEFAULT 2.0,
      taxa_credito REAL DEFAULT 3.5,
      taxa_pix REAL DEFAULT 0.0,
      taxa_dinheiro REAL DEFAULT 0.0,
      funcionarios_custo REAL DEFAULT 0.0,
      funcionarios_qtd INTEGER DEFAULT 100,
      perdas_pct REAL DEFAULT 5.0,
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS catalogo_ingredientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL DEFAULT 0,
      nome TEXT NOT NULL,
      unidade TEXT NOT NULL DEFAULT 'kg',
      custo_por_unidade REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      margem REAL DEFAULT 30.0,
      criado_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS produto_ingredientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      quantidade REAL NOT NULL DEFAULT 0,
      unidade TEXT NOT NULL DEFAULT 'kg',
      custo_por_unidade REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gastos_variaveis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      valor REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lancamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      valor REAL NOT NULL DEFAULT 0,
      descricao TEXT DEFAULT '',
      categoria TEXT DEFAULT 'outros',
      data TEXT DEFAULT (date('now')),
      obs TEXT DEFAULT '',
      criado_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS socios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL UNIQUE,
      dados TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS estoque (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      unidade TEXT NOT NULL DEFAULT 'un',
      quantidade_atual REAL NOT NULL DEFAULT 0,
      quantidade_minima REAL NOT NULL DEFAULT 0,
      custo_unitario REAL NOT NULL DEFAULT 0,
      tem_validade INTEGER NOT NULL DEFAULT 0,
      dias_alerta INTEGER NOT NULL DEFAULT 7,
      criado_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS estoque_movimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      estoque_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      quantidade REAL NOT NULL,
      observacao TEXT,
      data_validade TEXT,
      criado_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (estoque_id) REFERENCES estoque(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lancamentos_pessoais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      valor REAL NOT NULL DEFAULT 0,
      descricao TEXT DEFAULT '',
      categoria TEXT DEFAULT 'outros',
      data TEXT DEFAULT (date('now')),
      criado_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cartoes_pessoais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      bandeira TEXT DEFAULT 'Visa',
      limite REAL NOT NULL DEFAULT 0,
      dia_vencimento INTEGER NOT NULL DEFAULT 10,
      dia_fechamento INTEGER NOT NULL DEFAULT 3,
      cor TEXT DEFAULT '#6366f1',
      pontua INTEGER NOT NULL DEFAULT 0,
      pontos_atuais REAL NOT NULL DEFAULT 0,
      limite_alerta_pct INTEGER NOT NULL DEFAULT 50,
      criado_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gastos_cartao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cartao_id INTEGER NOT NULL,
      descricao TEXT DEFAULT '',
      valor REAL NOT NULL DEFAULT 0,
      categoria TEXT DEFAULT 'outros',
      data TEXT DEFAULT (date('now')),
      criado_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (cartao_id) REFERENCES cartoes_pessoais(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS metas_pessoais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      valor_alvo REAL NOT NULL DEFAULT 0,
      valor_atual REAL NOT NULL DEFAULT 0,
      emoji TEXT DEFAULT '🎯',
      concluida INTEGER NOT NULL DEFAULT 0,
      criado_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cargos_funcionarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'clt',
      salario REAL NOT NULL DEFAULT 0,
      quantidade INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fornecedores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      telefone TEXT DEFAULT '',
      observacoes TEXT DEFAULT '',
      criado_em TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cotacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL,
      item_nome TEXT NOT NULL,
      fornecedor_id INTEGER NOT NULL,
      preco REAL NOT NULL DEFAULT 0,
      unidade TEXT NOT NULL DEFAULT 'kg',
      data_cotacao TEXT DEFAULT (date('now')),
      observacao TEXT DEFAULT '',
      criado_em TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
      FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS alertas_notificados (
      chave TEXT PRIMARY KEY,
      notificado_em TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrations — ALTER TABLE ignora silenciosamente se a coluna já existe
  const migrations: string[] = [
    "ALTER TABLE catalogo_ingredientes ADD COLUMN empresa_id INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE configuracoes_empresa ADD COLUMN regime TEXT DEFAULT 'simples_nacional'",
    "ALTER TABLE configuracoes_empresa ADD COLUMN anexo TEXT DEFAULT 'I'",
    "ALTER TABLE configuracoes_empresa ADD COLUMN aliquota_custom REAL DEFAULT 6.0",
    "ALTER TABLE configuracoes_empresa ADD COLUMN taxa_debito REAL DEFAULT 2.0",
    "ALTER TABLE configuracoes_empresa ADD COLUMN taxa_credito REAL DEFAULT 3.5",
    "ALTER TABLE configuracoes_empresa ADD COLUMN taxa_pix REAL DEFAULT 0.0",
    "ALTER TABLE configuracoes_empresa ADD COLUMN taxa_dinheiro REAL DEFAULT 0.0",
    "ALTER TABLE configuracoes_empresa ADD COLUMN funcionarios_custo REAL DEFAULT 0.0",
    "ALTER TABLE configuracoes_empresa ADD COLUMN funcionarios_qtd INTEGER DEFAULT 100",
    "ALTER TABLE configuracoes_empresa ADD COLUMN perdas_pct REAL DEFAULT 5.0",
    "ALTER TABLE produtos ADD COLUMN margem REAL DEFAULT 30.0",
    "ALTER TABLE estoque ADD COLUMN tem_validade INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE estoque ADD COLUMN dias_alerta INTEGER NOT NULL DEFAULT 7",
    "ALTER TABLE estoque_movimentos ADD COLUMN data_validade TEXT",
    "ALTER TABLE lancamentos_pessoais ADD COLUMN forma_pagamento TEXT DEFAULT 'dinheiro'",
    "ALTER TABLE lancamentos_pessoais ADD COLUMN cartao_id INTEGER",
    "ALTER TABLE lancamentos_pessoais ADD COLUMN parcelas INTEGER DEFAULT 1",
    "ALTER TABLE cartoes_pessoais ADD COLUMN meta_fatura REAL DEFAULT 0",
    "ALTER TABLE catalogo_ingredientes ADD COLUMN atualizado_em TEXT",
    "ALTER TABLE configuracoes_empresa ADD COLUMN funcionarios_metodo TEXT DEFAULT 'producao_mensal'",
    "ALTER TABLE configuracoes_empresa ADD COLUMN funcionarios_dias_trabalhados REAL DEFAULT 30",
    "ALTER TABLE configuracoes_empresa ADD COLUMN funcionarios_horas_dia REAL DEFAULT 8",
    "ALTER TABLE configuracoes_empresa ADD COLUMN funcionarios_percentual_ingredientes REAL DEFAULT 30",
    "ALTER TABLE produtos ADD COLUMN tempo_preparo_minutos REAL DEFAULT 0",
    "ALTER TABLE produtos ADD COLUMN rendimento REAL DEFAULT 1",
    // Colunas que só existiam no site — adicionadas aqui pra um backup
    // importado do site não perder esses dados (ver lib/backupCanonico.ts).
    "ALTER TABLE produtos ADD COLUMN pessoas_preparo REAL DEFAULT 1",
    "ALTER TABLE configuracoes_empresa ADD COLUMN funcionarios_qtd_pessoas REAL DEFAULT 1",
    "ALTER TABLE lancamentos_pessoais ADD COLUMN obs TEXT DEFAULT ''",
    "ALTER TABLE metas_pessoais ADD COLUMN prazo TEXT",
    "ALTER TABLE metas_pessoais ADD COLUMN cor TEXT DEFAULT '#6366f1'",
    "ALTER TABLE estoque ADD COLUMN foto TEXT",
    // "cargos" (soma dos cargos cadastrados, com encargos) ou "manual" (um
    // valor de custo mensal total digitado direto) — default 'cargos'
    // porque é o único jeito que o app já suportava antes dessa coluna existir.
    "ALTER TABLE configuracoes_empresa ADD COLUMN funcionarios_modo_custo TEXT DEFAULT 'cargos'",
    // Forma de pagamento de cada venda (dinheiro/debito/credito/pix) — usada
    // no DRE pra calcular a taxa de maquininha certa em vez de um valor único.
    "ALTER TABLE lancamentos ADD COLUMN forma_pagamento TEXT",
  ];
  for (const sql of migrations) {
    try { db.runSync(sql); } catch {}
  }
}
