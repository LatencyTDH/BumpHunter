import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '.cache.db');

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
  }
  return db;
}

export function cacheGet<T>(key: string): T | null {
  const row = getDb().prepare('SELECT value, expires_at FROM cache WHERE key = ?').get(key) as any;
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    getDb().prepare('DELETE FROM cache WHERE key = ?').run(key);
    return null;
  }
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: any, ttlMs: number): void {
  const expiresAt = Date.now() + ttlMs;
  getDb().prepare(
    'INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)'
  ).run(key, JSON.stringify(value), expiresAt);
}

export function cacheCleanup(): void {
  getDb().prepare('DELETE FROM cache WHERE expires_at < ?').run(Date.now());
}

// Cleanup expired entries every 10 minutes
setInterval(() => {
  try { cacheCleanup(); } catch { /* ignore */ }
}, 10 * 60 * 1000);
