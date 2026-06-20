import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, 'goldbet.sqlite'));
db.pragma('journal_mode = WAL');

// Schema. Kept simple; every game writes to the shared `transactions` ledger
// so balances are always derived from a verifiable history.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    balance       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    amount     INTEGER NOT NULL,            -- positive = credit, negative = debit
    reason     TEXT NOT NULL,               -- e.g. 'signup_bonus', 'crash_bet', 'crash_win'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- One row per completed Crash round. Stores the seed/hash so a player can
  -- verify the crash point was decided before the round started (provably fair).
  CREATE TABLE IF NOT EXISTS crash_rounds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    crash_point REAL NOT NULL,
    server_seed TEXT NOT NULL,
    hash        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per completed Roulette round (provably fair: the hash is shown
  -- before the wheel spins, the seed/number are revealed after).
  CREATE TABLE IF NOT EXISTS roulette_rounds (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    winning_number INTEGER NOT NULL,
    server_seed    TEXT NOT NULL,
    hash           TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
