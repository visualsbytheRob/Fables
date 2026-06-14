/**
 * Import-UX server tests (F1486 health report, F1487 resync, F1488 CLI parity).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notesRepo } from '../db/repos/notes.js';
import { buildTitlesIndex } from '../services/links.js';
import {
  ImporterRegistry,
  importHealthReport,
  normalizeRules,
  resyncImport,
  runImport,
  type SourceAdapter,
  type StagedDoc,
} from './framework/index.js';
import { parseImportArgs, runImportCli } from '../cli/import-source.js';

let db: Db;
let dataDir: string;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-'));
});
afterEach(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function doc(p: Partial<StagedDoc> & { sourceId: string; title: string }): StagedDoc {
  return { body: '', notebookPath: [], tags: [], assets: [], links: [], ...p };
}

class Synthetic implements SourceAdapter {
  readonly name = 'synthetic';
  constructor(private readonly docs: StagedDoc[]) {}
  stage(): StagedDoc[] {
    return this.docs;
  }
}

describe('import health report (F1486)', () => {
  it('reports counts and link-resolution percentage', async () => {
    const adapter = new Synthetic([
      doc({ sourceId: 'a', title: 'Alpha', body: 'links to [[Beta]] and [[Ghost]]' }),
      doc({ sourceId: 'b', title: 'Beta', body: 'hi' }),
    ]);
    const result = await runImport(db, dataDir, adapter, normalizeRules({}));
    const health = importHealthReport(db, result.batchId);
    expect(health.notes).toBe(2);
    // Alpha → [[Beta]] resolves (Beta imported), [[Ghost]] does not.
    expect(health.linksResolved).toBe(1);
    expect(health.linksUnresolved).toBe(1);
    expect(health.linkResolutionPct).toBe(50);
    expect(health.status).toBe('done');
  });
});

describe('resync a living source (F1487)', () => {
  it('re-running the batch imports only newly-appeared docs', async () => {
    const docs: StagedDoc[] = [doc({ sourceId: 'one', title: 'One' })];
    const adapter = new Synthetic(docs);
    const first = await runImport(db, dataDir, adapter, normalizeRules({}));
    expect(first.imported).toBe(1);

    // A new doc appears in the living source; resync the same batch.
    docs.push(doc({ sourceId: 'two', title: 'Two' }));
    const synced = await resyncImport(db, dataDir, new Synthetic(docs), normalizeRules({}), {
      batchId: first.batchId,
    });
    expect(synced.imported).toBe(1); // only 'Two'
    expect(notesRepo(db).get(buildTitlesIndex(db).get('two')!)).not.toBeNull();
  });
});

describe('universal import CLI (F1488)', () => {
  it('parses args with flags', () => {
    expect(
      parseImportArgs(['notion', '/x', '--collisions', 'merge', '--notebooks', 'flat']),
    ).toEqual({
      source: 'notion',
      path: '/x',
      collisions: 'merge',
      notebooks: 'flat',
      dryRun: false,
    });
    expect(parseImportArgs(['roam', '/y', '--dry-run']).dryRun).toBe(true);
  });

  it('rejects missing args and unknown sources', async () => {
    expect(() => parseImportArgs(['only-one'])).toThrow(/usage/);
    const registry = new ImporterRegistry();
    await expect(
      runImportCli(
        { source: 'nope', path: '/x', collisions: 'rename', notebooks: 'preserve', dryRun: false },
        { db, dataDir, registry },
      ),
    ).rejects.toThrow(/unknown source/);
  });

  it('runs a real import through the registry', async () => {
    const registry = new ImporterRegistry().register(
      { name: 'synthetic', description: 'test' },
      (input) => new Synthetic([doc({ sourceId: 'x', title: (input as { path: string }).path })]),
    );
    const lines: string[] = [];
    const summary = await runImportCli(
      {
        source: 'synthetic',
        path: 'From CLI',
        collisions: 'rename',
        notebooks: 'preserve',
        dryRun: false,
      },
      { db, dataDir, registry, log: (l) => lines.push(l) },
    );
    expect(summary['mode']).toBe('run');
    expect(summary['imported']).toBe(1);
    expect(lines[0]).toContain('imported 1');
    expect(notesRepo(db).get(buildTitlesIndex(db).get('from cli')!)).not.toBeNull();
  });

  it('supports dry-run mode (no writes)', async () => {
    const registry = new ImporterRegistry().register(
      { name: 'synthetic', description: 'test' },
      () => new Synthetic([doc({ sourceId: 'x', title: 'Dry' })]),
    );
    const summary = await runImportCli(
      {
        source: 'synthetic',
        path: '/x',
        collisions: 'rename',
        notebooks: 'preserve',
        dryRun: true,
      },
      { db, dataDir, registry },
    );
    expect(summary['mode']).toBe('dry-run');
    expect(notesRepo(db).list({ sort: 'created', fetch: 10, cursor: null })).toHaveLength(0);
  });
});
