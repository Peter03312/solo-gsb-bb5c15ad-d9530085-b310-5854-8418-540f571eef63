import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
const DB_PATH = process.env.SQLITE_PATH || join(DATA_DIR, 'access.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 10000');
db.pragma('synchronous = NORMAL');

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS network_versions (
  version      INTEGER PRIMARY KEY AUTOINCREMENT,
  published_at INTEGER NOT NULL,
  note         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS version_nodes (
  version INTEGER NOT NULL,
  id      TEXT NOT NULL,
  name    TEXT NOT NULL,
  PRIMARY KEY (version, id),
  FOREIGN KEY (version) REFERENCES network_versions(version)
);

CREATE TABLE IF NOT EXISTS version_edges (
  version  INTEGER NOT NULL,
  edge_id  INTEGER NOT NULL,
  "from"   TEXT NOT NULL,
  "to"     TEXT NOT NULL,
  minutes  INTEGER NOT NULL CHECK (minutes > 0),
  has_steps INTEGER NOT NULL CHECK (has_steps IN (0, 1)),
  PRIMARY KEY (version, edge_id),
  UNIQUE (version, "from", "to"),
  FOREIGN KEY (version) REFERENCES network_versions(version)
);

CREATE TABLE IF NOT EXISTS draft_nodes (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS draft_edges (
  edge_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  "from"    TEXT NOT NULL,
  "to"      TEXT NOT NULL,
  minutes   INTEGER NOT NULL CHECK (minutes > 0),
  has_steps INTEGER NOT NULL CHECK (has_steps IN (0, 1)),
  UNIQUE ("from", "to")
);

CREATE TABLE IF NOT EXISTS closures (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  "from"     TEXT NOT NULL,
  "to"       TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time   INTEGER NOT NULL CHECK (end_time > start_time),
  reason     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_closures_span ON closures(start_time, end_time);
`;

db.exec(SCHEMA);
