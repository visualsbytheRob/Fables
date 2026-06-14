/**
 * Import-framework tests (F1410) — driven by a synthetic source adapter so the
 * mapping, asset pipeline, link reconstruction, collisions, provenance, resume,
 * and rollback all get exercised without any real importer.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { notesRepo } from '../../db/repos/notes.js';
import { notebooksRepo } from '../../db/repos/notebooks.js';
import { createNote } from '../../services/notes.js';
import { buildTitlesIndex } from '../../services/links.js';
import {
  DEFAULT_MAPPING_RULES,
  dryRun,
  normalizeRules,
  runImport,
  rollbackImport,
} from './index.js';
import { importBatchesRepo } from './batches.js';
import type { MappingRules, SourceAdapter, StagedDoc } from './types.js';

let db: Db;
let dataDir: string;

beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fables-import-'));
});

afterEach(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function doc(partial: Partial<StagedDoc> & { sourceId: string; title: string }): StagedDoc {
  return {
    body: '',
    notebookPath: [],
    tags: [],
    assets: [],
    links: [],
    ...partial,
  };
}

class SyntheticAdapter implements SourceAdapter {
  readonly name = 'synthetic';
  constructor(private readonly docs: StagedDoc[]) {}
  stage(): StagedDoc[] {
    return this.docs;
  }
}

const rules = (over: Partial<MappingRules> = {}): MappingRules => normalizeRules(over);

function noteByTitle(title: string) {
  const id = buildTitlesIndex(db).get(title.toLowerCase());
  return id ? notesRepo(db).get(id) : null;
}

describe('dry-run (F1401)', () => {
  it('reports docs, totals, collisions, and lossy hints — without writing', async () => {
    createNote(db, { notebookId: notebooksRepo(db).create({ name: 'NB' }).id, title: 'Alpha' });
    const adapter = new SyntheticAdapter([
      doc({ sourceId: 'a', title: 'Alpha', tags: ['x'], notebookPath: ['Work'] }), // collision
      doc({
        sourceId: 'b',
        title: 'Beta',
        assets: [{ ref: 'i', filename: 'p.png', read: () => new Uint8Array([1]) }],
        metadata: { lossy: ['toggle blocks flattened'] },
      }),
    ]);
    const report = await dryRun(db, adapter, DEFAULT_MAPPING_RULES);
    expect(report.totals).toMatchObject({ docs: 2, collisions: 1, assets: 1, lossy: 1 });
    expect(report.docs[0]!.collision).toBe(true);
    expect(report.docs[1]!.lossy).toEqual(['toggle blocks flattened']);
    // No notes created by a dry run.
    expect(notesRepo(db).list({ sort: 'created', fetch: 50, cursor: null })).toHaveLength(1);
  });
});

describe('materialize: notebooks, tags, assets, links (F1401/F1403/F1404)', () => {
  it('creates notes under preserved notebooks and resolves links to wikilinks', async () => {
    const adapter = new SyntheticAdapter([
      doc({
        sourceId: 'a',
        title: 'Alpha',
        body: 'See {{link:b}} and {{asset:img}}.',
        notebookPath: ['Projects', 'X'],
        tags: ['plan'],
        assets: [{ ref: 'img', filename: 'pic.png', read: () => new Uint8Array([1, 2, 3]) }],
        links: [{ targetSourceId: 'b' }],
      }),
      doc({ sourceId: 'b', title: 'Beta', body: 'hello' }),
    ]);
    const result = await runImport(db, dataDir, adapter, rules());
    expect(result.imported).toBe(2);
    expect(result.assets).toBe(1);
    expect(result.linksResolved).toBe(1);

    const alpha = noteByTitle('Alpha')!;
    expect(alpha.body).toContain('[[Beta]]'); // F1404 link reconstruction
    expect(alpha.body).toContain('![pic.png](/api/v1/attachments/'); // F1403 relink

    // Nested notebooks were created (Projects → X), plus the import root.
    const nbNames = notebooksRepo(db)
      .list({ includeArchived: true })
      .map((n) => n.name);
    expect(nbNames).toContain('Projects');
    expect(nbNames).toContain('X');
  });

  it('flat notebook rule drops the hierarchy', async () => {
    const adapter = new SyntheticAdapter([
      doc({ sourceId: 'a', title: 'Solo', notebookPath: ['Deep', 'Nested'] }),
    ]);
    await runImport(db, dataDir, adapter, rules({ notebooks: 'flat' }));
    const nbNames = notebooksRepo(db)
      .list({ includeArchived: true })
      .map((n) => n.name);
    expect(nbNames).not.toContain('Deep');
  });
});

describe('collision strategies (F1406)', () => {
  it('skip leaves the existing note untouched', async () => {
    const nb = notebooksRepo(db).create({ name: 'NB' });
    createNote(db, { notebookId: nb.id, title: 'Dup', body: 'original' });
    const result = await runImport(
      db,
      dataDir,
      new SyntheticAdapter([doc({ sourceId: 'a', title: 'Dup', body: 'incoming' })]),
      rules({ collisions: 'skip' }),
    );
    expect(result.skipped).toBe(1);
    expect(noteByTitle('Dup')!.body).toBe('original');
  });

  it('rename creates "Title (imported)"', async () => {
    const nb = notebooksRepo(db).create({ name: 'NB' });
    createNote(db, { notebookId: nb.id, title: 'Dup' });
    const result = await runImport(
      db,
      dataDir,
      new SyntheticAdapter([doc({ sourceId: 'a', title: 'Dup', body: 'x' })]),
      rules({ collisions: 'rename' }),
    );
    expect(result.renamed).toBe(1);
    expect(noteByTitle('Dup (imported)')).not.toBeNull();
  });

  it('merge folds incoming content into the existing note', async () => {
    const nb = notebooksRepo(db).create({ name: 'NB' });
    createNote(db, { notebookId: nb.id, title: 'Dup', body: 'old' });
    const result = await runImport(
      db,
      dataDir,
      new SyntheticAdapter([doc({ sourceId: 'a', title: 'Dup', body: 'new content' })]),
      rules({ collisions: 'merge' }),
    );
    expect(result.merged).toBe(1);
    expect(noteByTitle('Dup')!.body).toBe('new content');
  });
});

describe('provenance (F1407)', () => {
  it('records where every imported note came from', async () => {
    await runImport(
      db,
      dataDir,
      new SyntheticAdapter([doc({ sourceId: 'page-123', title: 'Provenant' })]),
      rules(),
    );
    const note = noteByTitle('Provenant')!;
    const prov = importBatchesRepo(db).provenanceForNote(note.id);
    expect(prov).toMatchObject({ source: 'synthetic', sourceId: 'page-123' });
  });
});

describe('resume (F1405)', () => {
  it('re-running the same batch skips already-materialized docs', async () => {
    const adapter = new SyntheticAdapter([
      doc({ sourceId: 'a', title: 'One' }),
      doc({ sourceId: 'b', title: 'Two' }),
    ]);
    const first = await runImport(db, dataDir, adapter, rules());
    expect(first.imported).toBe(2);
    // Resume the same batch: both docs already done → nothing re-imported.
    const second = await runImport(db, dataDir, adapter, rules(), { batchId: first.batchId });
    expect(second.imported).toBe(0);
  });
});

describe('rollback (F1408)', () => {
  it('undoes the whole batch: notes, attachments, created notebooks', async () => {
    const adapter = new SyntheticAdapter([
      doc({
        sourceId: 'a',
        title: 'Rollme',
        body: '{{asset:img}}',
        notebookPath: ['Temp'],
        assets: [{ ref: 'img', filename: 'a.png', read: () => new Uint8Array([9]) }],
      }),
    ]);
    const result = await runImport(db, dataDir, adapter, rules());
    expect(noteByTitle('Rollme')).not.toBeNull();

    const undo = rollbackImport(db, result.batchId);
    expect(undo.notes).toBe(1);
    expect(undo.attachments).toBe(1);
    expect(undo.notebooks).toBeGreaterThanOrEqual(1);
    expect(noteByTitle('Rollme')).toBeNull();
    expect(importBatchesRepo(db).get(result.batchId)!.status).toBe('rolled_back');
  });
});
