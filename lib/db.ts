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
      regime_tributario TEXT DEFAULT 'simples',
      aliquota_imposto REAL DEFAULT 6.0,
      taxa_cartao REAL DEFAULT 3.0,
      taxa_delivery REAL DEFAULT 12.0,
      margem_lucro REAL DEFAULT 30.0,
      num_funcionarios INTEGER DEFAULT 1,
      salario_medio REAL DEFAULT 1500.0,
      horas_mes REAL DEFAULT 160.0,
      perda_percentual REAL DEFAULT 5.0,
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS catalogo_ingredientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      unidade TEXT NOT NULL DEFAULT 'kg',
      custo_unitario REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      categoria TEXT DEFAULT '',
      preco_venda REAL DEFAULT 0,
      criado_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS produto_ingredientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      quantidade REAL NOT NULL DEFAULT 0,
      unidade TEXT NOT NULL DEFAULT 'kg',
      custo_unitario REAL NOT NULL DEFAULT 0,
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
  `);
}
