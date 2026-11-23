import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface StudioDatabase {
  readonly db: DatabaseSync;
  readonly path: string;
  checkHealth(): { ok: true; journalMode: string; tables: number };
  close(): void;
}

export function openStudioDatabase(dbPath: string): StudioDatabase {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      title TEXT NOT NULL,
      blueprint_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      course_id TEXT,
      lesson_id TEXT NOT NULL,
      state TEXT NOT NULL,
      last_played_step_id INTEGER,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return {
    db,
    path: dbPath,
    checkHealth() {
      const modeRow = db.prepare('PRAGMA journal_mode;').get() as {
        journal_mode?: string;
      };
      const tableRow = db
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';",
        )
        .get() as { count?: number };
      return {
        ok: true,
        journalMode: String(modeRow?.journal_mode ?? 'unknown'),
        tables: Number(tableRow?.count ?? 0),
      };
    },
    close() {
      db.close();
    },
  };
}
