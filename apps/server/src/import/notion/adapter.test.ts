/**
 * Notion importer tests (F1419) — a synthetic Notion export corpus exercising
 * page ids, nested hierarchy, internal links, media, and database CSV properties,
 * read both from a directory and a .zip, then materialized through the framework.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { notesRepo } from '../../db/repos/notes.js';
import { buildTitlesIndex } from '../../services/links.js';
import { normalizeRules, runImport } from '../framework/index.js';
import { NotionAdapter, parseCsv, stripNotionId } from './adapter.js';

const ID1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const ID2 = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const ID3 = '11223344556677889900aabbccddeeff';

let root: string;
let db: Db;
let dataDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-'));
  db = openDb(':memory:');
  migrate(db);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-data-'));
  // A top page that links to a child page and embeds an image.
  fs.writeFileSync(
    path.join(root, `Welcome ${ID1}.md`),
    `# Welcome\n\nSee [the plan](Projects%20${ID2}/Plan%20${ID3}.md) and an image:\n\n![pic](pic.png)\n`,
  );
  fs.writeFileSync(path.join(root, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // A database "Projects" with a CSV of properties + a folder of its pages.
  fs.mkdirSync(path.join(root, `Projects ${ID2}`));
  fs.writeFileSync(
    path.join(root, `Projects ${ID2}.csv`),
    `Name,Status,Tags,Related (relation)\nPlan,Active,"alpha,beta",Roadmap\n`,
  );
  fs.writeFileSync(
    path.join(root, `Projects ${ID2}`, `Plan ${ID3}.md`),
    `# Plan\n\nThe master plan.\n`,
  );
});

afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('Notion naming helpers', () => {
  it('strips 32-hex ids from titles', () => {
    expect(stripNotionId(`Welcome ${ID1}.md`)).toBe('Welcome');
    expect(stripNotionId(`Projects ${ID2}`)).toBe('Projects');
  });

  it('parses CSV with quoted multi-value fields', () => {
    const rows = parseCsv(`Name,Tags\nPlan,"a,b"\n`);
    expect(rows).toEqual([{ Name: 'Plan', Tags: 'a,b' }]);
  });
});

describe('Notion staging (F1411–F1417)', () => {
  it('produces docs with ids, hierarchy, links, assets, and db properties', () => {
    const docs = new NotionAdapter({ path: root }).stage();
    const welcome = docs.find((d) => d.title === 'Welcome')!;
    const plan = docs.find((d) => d.title === 'Plan')!;

    // Page ids + nested hierarchy (F1417).
    expect(welcome.sourceId).toBe(ID1);
    expect(plan.notebookPath).toEqual(['Projects']);

    // Internal link rewritten to a placeholder targeting the child page (F1415).
    expect(welcome.links[0]!.targetSourceId).toBe(ID3);
    expect(welcome.body).toContain(`{{link:${ID3}}}`);

    // Media captured as an asset (F1416).
    expect(welcome.assets).toHaveLength(1);
    expect(welcome.body).toContain('{{asset:');

    // Database properties rendered + tags harvested + relation flagged lossy (F1412/F1414).
    expect(plan.body).toContain('## Properties');
    expect(plan.tags).toEqual(expect.arrayContaining(['alpha', 'beta']));
    expect((plan.metadata?.['lossy'] as string[]).some((l) => /relation/.test(l))).toBe(true);
  });

  it('reads the same corpus from a .zip (F1411)', () => {
    const zipPath = path.join(os.tmpdir(), `notion-${Date.now()}.zip`);
    fs.writeFileSync(zipPath, buildStoredZip(root));
    try {
      const docs = new NotionAdapter({ path: zipPath }).stage();
      expect(docs.map((d) => d.title).sort()).toEqual(['Plan', 'Welcome']);
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
  });
});

describe('Notion end-to-end through the framework', () => {
  it('materializes notes with resolved wikilinks', async () => {
    const result = await runImport(
      db,
      dataDir,
      new NotionAdapter({ path: root }),
      normalizeRules({}),
    );
    expect(result.imported).toBe(2);
    expect(result.linksResolved).toBe(1);
    const welcomeId = buildTitlesIndex(db).get('welcome')!;
    expect(notesRepo(db).get(welcomeId)!.body).toContain('[[Plan]]');
  });
});

// ── Helpers: zip the fixture dir (stored entries) ────────────────────────────

function buildStoredZip(dir: string): Buffer {
  const files: { name: string; data: Buffer }[] = [];
  const walk = (d: string, prefix: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else files.push({ name: rel, data: fs.readFileSync(abs) });
    }
  };
  walk(dir, '');

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([local, name, f.data]));
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(f.data.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += 30 + name.length + f.data.length;
  }
  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);
  return Buffer.concat([localBlock, centralBlock, eocd]);
}
