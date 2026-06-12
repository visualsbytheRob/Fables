/**
 * Vault import CLI (F299) — for huge vaults where an HTTP request is awkward:
 *   pnpm --filter @fables/server import:vault -- <dir> [--notebook <id>] [--collisions skip|rename|merge]
 *
 * Runs against the real database (config.dataDir); progress prints per batch.
 */
import type { NotebookId } from '@fables/core';
import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { importJobsRepo } from '../db/repos/import-jobs.js';
import { migrate } from '../db/migrate.js';
import {
  runImportJob,
  scanImport,
  startImportJob,
  validateImportDir,
  type CollisionMode,
} from '../services/import.js';

function parseArgs(argv: string[]): {
  dir: string;
  notebookId?: string;
  collisions: CollisionMode;
} {
  let dir: string | undefined;
  let notebookId: string | undefined;
  let collisions: CollisionMode = 'rename';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--notebook') notebookId = argv[++i];
    else if (arg === '--collisions') {
      const value = argv[++i];
      if (value !== 'skip' && value !== 'rename' && value !== 'merge') {
        throw new Error('--collisions must be skip, rename, or merge');
      }
      collisions = value;
    } else if (!arg.startsWith('--') && dir === undefined) dir = arg;
  }
  if (dir === undefined) {
    throw new Error('usage: import:vault <dir> [--notebook <id>] [--collisions skip|rename|merge]');
  }
  return { dir, ...(notebookId !== undefined ? { notebookId } : {}), collisions };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({ env: process.env, argv: [] });
  const db = openDb(config.dataDir);
  migrate(db);

  const root = validateImportDir(args.dir);
  const scan = scanImport(db, root);
  console.log(
    `scanning ${root}: ${scan.totals.files} files, ` +
      `${scan.totals.attachments} attachment refs, ${scan.totals.collisions} title collisions`,
  );

  const opts = {
    root,
    collisions: args.collisions,
    ...(args.notebookId !== undefined ? { notebookId: args.notebookId as NotebookId } : {}),
  };
  const job = startImportJob(db, opts);
  const interval = setInterval(() => {
    const current = importJobsRepo(db).get(job.id);
    if (current) console.log(`progress: ${current.processed}/${current.total}`);
  }, 1000);

  const finished = await runImportJob(db, config.dataDir, job.id, opts);
  clearInterval(interval);

  console.log(
    `import ${finished.status}: ${finished.imported} imported, ${finished.merged} merged, ` +
      `${finished.renamed} renamed, ${finished.skipped} skipped, ${finished.attachments} attachments`,
  );
  for (const error of finished.errors) console.error(`  ! ${error.file}: ${error.message}`);
  db.close();
  if (finished.status === 'failed') process.exit(1);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
