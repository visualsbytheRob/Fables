import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/** Opens (and creates if needed) the vault database. Pass ':memory:' for tests. */
export function openDb(dataDir: string): Db {
  let file: string;
  if (dataDir === ':memory:') {
    file = ':memory:';
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, 'fables.sqlite');
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** Runs `fn` inside a transaction; rolls back if it throws. */
export function withTransaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}
