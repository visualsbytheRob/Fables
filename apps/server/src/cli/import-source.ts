/**
 * Universal import CLI (F1488) — parity with the HTTP importer for every source.
 *
 *   pnpm --filter @fables/server import -- <source> <path> \
 *        [--collisions skip|rename|merge] [--notebooks preserve|flat] [--dry-run]
 *
 * Runs any registered importer (notion, evernote, roam, logseq, day-one, …)
 * against the real database. The core is extracted as `runImportCli` so it's
 * unit-testable without spawning a process.
 */

import { loadConfig } from '../config.js';
import { openDb, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { ImporterRegistry, dryRun, normalizeRules, runImport } from '../import/framework/index.js';
import { registerBuiltinImporters } from '../import/importers.js';

export interface CliArgs {
  source: string;
  path: string;
  collisions: 'skip' | 'rename' | 'merge';
  notebooks: 'preserve' | 'flat';
  dryRun: boolean;
}

export function parseImportArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let collisions: CliArgs['collisions'] = 'rename';
  let notebooks: CliArgs['notebooks'] = 'preserve';
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--collisions') {
      const v = argv[++i];
      if (v !== 'skip' && v !== 'rename' && v !== 'merge') {
        throw new Error('--collisions must be skip, rename, or merge');
      }
      collisions = v;
    } else if (arg === '--notebooks') {
      const v = argv[++i];
      if (v !== 'preserve' && v !== 'flat') throw new Error('--notebooks must be preserve or flat');
      notebooks = v;
    } else if (!arg.startsWith('--')) positional.push(arg);
  }
  const [source, target] = positional;
  if (!source || !target) {
    throw new Error('usage: import <source> <path> [--collisions …] [--notebooks …] [--dry-run]');
  }
  return { source, path: target, collisions, notebooks, dryRun };
}

export interface CliDeps {
  db: Db;
  dataDir: string;
  registry: ImporterRegistry;
  log?: (line: string) => void;
}

/** Run the import described by `args`. Returns a summary object. */
export async function runImportCli(args: CliArgs, deps: CliDeps): Promise<Record<string, unknown>> {
  const log = deps.log ?? (() => {});
  if (!deps.registry.has(args.source)) {
    const known = deps.registry
      .list()
      .map((i) => i.name)
      .join(', ');
    throw new Error(`unknown source "${args.source}". Known sources: ${known}`);
  }
  const adapter = deps.registry.create(args.source, { path: args.path });
  const rules = normalizeRules({ collisions: args.collisions, notebooks: args.notebooks });

  if (args.dryRun) {
    const report = await dryRun(deps.db, adapter, rules);
    log(
      `dry-run: ${report.totals.docs} docs, ${report.totals.collisions} collisions, ${report.totals.lossy} lossy`,
    );
    return { mode: 'dry-run', ...report.totals };
  }

  const result = await runImport(deps.db, deps.dataDir, adapter, rules);
  log(
    `imported ${result.imported}, merged ${result.merged}, renamed ${result.renamed}, ` +
      `skipped ${result.skipped}, assets ${result.assets}, errors ${result.errors.length}`,
  );
  return { mode: 'run', ...result };
}

/** Process entry point. */
async function main(): Promise<void> {
  const args = parseImportArgs(process.argv.slice(2));
  const config = loadConfig();
  const db = openDb(config.dataDir);
  migrate(db);
  try {
    await runImportCli(args, {
      db,
      dataDir: config.dataDir,
      registry: registerBuiltinImporters(new ImporterRegistry()),
      log: (line) => console.log(line),
    });
  } finally {
    db.close();
  }
}

// Only run when invoked directly (not when imported by a test).
if (process.argv[1] && process.argv[1].endsWith('import-source.ts')) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  });
}
