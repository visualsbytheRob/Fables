import type { Db } from './connection.js';
import { withTransaction } from './connection.js';
import { migrations } from './migrations/index.js';

/** Applies pending migrations in order. Idempotent — safe to run on every boot. */
export function migrate(db: Db): { applied: string[] } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS applied_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const done = new Set(
    (db.prepare('SELECT id FROM applied_migrations').all() as { id: number }[]).map((r) => r.id),
  );

  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    withTransaction(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO applied_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
    });
    applied.push(`${String(m.id).padStart(3, '0')}-${m.name}`);
  }
  return { applied };
}
