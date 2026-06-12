import type { NotebookId, NoteId } from '@fables/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { withTransaction } from '../db/connection.js';
import { linksRepo } from '../db/repos/links.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { buildGraph, invalidateGraphCache } from '../services/graph.js';

interface GraphJson {
  nodes: {
    id: string;
    type: string;
    title: string;
    notebookId: string;
    degree: number;
    orphan: boolean;
    community: number;
  }[];
  edges: { source: string; target: string; kind: string; weight: number }[];
  stats: { nodes: number; edges: number; orphans: number; communities: number };
}

let app: FastifyInstance;
let notebookId: string;
const ids = new Map<string, string>();

async function createNote(title: string, body = '', nb = notebookId): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notes',
    payload: { notebookId: nb, title, body },
  });
  expect(res.statusCode).toBe(201);
  ids.set(title, res.json().data.id);
}

async function fetchGraph(qs = ''): Promise<GraphJson> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/graph${qs}` });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

const node = (graph: GraphJson, title: string) => graph.nodes.find((n) => n.id === ids.get(title))!;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/notebooks',
    payload: { name: 'GraphLab' },
  });
  notebookId = res.json().data.id;

  // Cluster 1: Alpha ⇄ Beta (Alpha links Beta twice), Beta → Gamma.
  await createNote('Gamma', '#graphy');
  await createNote('Beta', 'see [[Gamma]] and [[Alpha]]');
  await createNote('Alpha', '[[Beta]] first, [[Beta]] again');
  // Cluster 2: Delta → Epsilon.
  await createNote('Epsilon');
  await createNote('Delta', 'over to [[Epsilon]]');
  // Mention-only node and a true orphan.
  await createNote('Mentioner', 'talking about Alpha in passing');
  await createNote('Loner');
});

afterAll(async () => {
  await app.close();
});

describe('graph endpoint (F231, F234, F236, F237)', () => {
  it('returns typed nodes and weighted, collapsed edges', async () => {
    const graph = await fetchGraph();
    expect(graph.stats.nodes).toBe(7);
    expect(graph.nodes.every((n) => n.type === 'note')).toBe(true);

    const alphaBeta = graph.edges.find(
      (e) => e.source === ids.get('Alpha') && e.target === ids.get('Beta'),
    )!;
    expect(alphaBeta.weight).toBe(2); // two [[Beta]] links collapse into one edge
    expect(alphaBeta.kind).toBe('wikilink');

    expect(node(graph, 'Beta').degree).toBe(3); // Alpha⇄Beta both ways + Beta→Gamma
    expect(node(graph, 'Loner').orphan).toBe(true);
    expect(node(graph, 'Mentioner').orphan).toBe(true); // mentions excluded by default
    expect(graph.stats.orphans).toBe(2);
  });

  it('includes mention edges when asked via kinds (F232)', async () => {
    const graph = await fetchGraph('?kinds=wikilink,mention');
    const mentionEdge = graph.edges.find((e) => e.source === ids.get('Mentioner'))!;
    expect(mentionEdge.kind).toBe('mention');
    expect(mentionEdge.target).toBe(ids.get('Alpha'));
    expect(node(graph, 'Mentioner').orphan).toBe(false);
  });

  it('rejects unknown kinds', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/graph?kinds=wormhole' });
    expect(res.statusCode).toBe(422);
  });

  it('filters by notebook, tag, and since (F232)', async () => {
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/notebooks',
      payload: { name: 'Elsewhere' },
    });
    await createNote('Faraway', '', other.json().data.id);

    const byNotebook = await fetchGraph(`?notebookId=${other.json().data.id}`);
    expect(byNotebook.nodes.map((n) => n.id)).toEqual([ids.get('Faraway')]);

    const byTag = await fetchGraph('?tag=graphy');
    expect(byTag.nodes.map((n) => n.id)).toEqual([ids.get('Gamma')]);
    expect(byTag.edges).toEqual([]); // edges to filtered-out nodes drop

    const since = await fetchGraph('?since=2000-01-01T00:00:00.000Z');
    expect(since.stats.nodes).toBeGreaterThan(0);
    expect((await fetchGraph('?since=2999-01-01T00:00:00.000Z')).stats.nodes).toBe(0);

    expect((await fetchGraph('?tag=no-such-tag')).stats.nodes).toBe(0);
  });

  it('assigns deterministic communities per cluster (F239)', async () => {
    const graph = await fetchGraph();
    const c1 = new Set(['Alpha', 'Beta', 'Gamma'].map((t) => node(graph, t).community));
    const c2 = new Set(['Delta', 'Epsilon'].map((t) => node(graph, t).community));
    expect(c1.size).toBe(1);
    expect(c2.size).toBe(1);
    expect([...c1][0]).not.toBe([...c2][0]);

    const again = await fetchGraph();
    expect(again).toEqual(graph);
  });
});

describe('local graph (F233)', () => {
  it('walks n hops from the center, capped at 3', async () => {
    const res1 = await app.inject({
      method: 'GET',
      url: `/api/v1/notes/${ids.get('Alpha')}/graph?hops=1`,
    });
    const local1 = res1.json().data as GraphJson & { center: string };
    expect(local1.center).toBe(ids.get('Alpha'));
    expect(new Set(local1.nodes.map((n) => n.id))).toEqual(
      new Set([ids.get('Alpha'), ids.get('Beta')]),
    );

    const res2 = await app.inject({
      method: 'GET',
      url: `/api/v1/notes/${ids.get('Alpha')}/graph?hops=2`,
    });
    expect((res2.json().data as GraphJson).nodes).toHaveLength(3); // + Gamma

    const capped = await app.inject({
      method: 'GET',
      url: `/api/v1/notes/${ids.get('Alpha')}/graph?hops=9`,
    });
    expect(capped.statusCode).toBe(422);

    const missing = await app.inject({ method: 'GET', url: '/api/v1/notes/nope/graph' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('graph caching (F235)', () => {
  it('reuses the computed graph until a link write invalidates it', async () => {
    invalidateGraphCache(app.db);
    const first = buildGraph(app.db);
    expect(buildGraph(app.db)).toBe(first); // same object: served from cache

    await createNote('Cache Buster', 'links [[Alpha]]');
    const second = buildGraph(app.db);
    expect(second).not.toBe(first);
    expect(second.stats.nodes).toBe(first.stats.nodes + 1);
  });

  it('invalidates when a note is trashed or restored', async () => {
    const before = buildGraph(app.db);
    await app.inject({ method: 'DELETE', url: `/api/v1/notes/${ids.get('Cache Buster')}` });
    const trashed = buildGraph(app.db);
    expect(trashed.stats.nodes).toBe(before.stats.nodes - 1);

    await app.inject({ method: 'POST', url: `/api/v1/notes/${ids.get('Cache Buster')}/restore` });
    expect(buildGraph(app.db).stats.nodes).toBe(before.stats.nodes);
  });
});

describe('graph export (F238)', () => {
  it('exports JSON with a download disposition', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/graph/export?format=json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('fables-graph.json');
    expect(res.json().data.stats.nodes).toBeGreaterThan(0);
  });

  it('exports valid-shaped GraphML', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/graph/export?format=graphml' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('graphml');
    expect(res.body).toContain('<graphml');
    expect(res.body).toContain(`<node id="${ids.get('Alpha')}"`);
    expect(res.body).toContain('<data key="weight">2</data>');
  });

  it('rejects unknown formats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/graph/export?format=dot' });
    expect(res.statusCode).toBe(422);
  });
});

describe('graph performance (F240)', () => {
  it('answers a 1k-note, ~3k-edge graph in under 500ms', async () => {
    const perfApp = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const db = perfApp.db;
    const nb = notebooksRepo(db).create({ name: 'Perf' }).id as NotebookId;

    const noteIds: NoteId[] = [];
    withTransaction(db, () => {
      const notes = notesRepo(db);
      for (let i = 0; i < 1000; i += 1) {
        noteIds.push(notes.create({ notebookId: nb, title: `Perf Note ${i}` }).id);
      }
      const links = linksRepo(db);
      for (let i = 0; i < 1000; i += 1) {
        links.replaceForSource(
          noteIds[i]!,
          'wikilink',
          [1, 7, 13].map((step) => ({
            kind: 'wikilink' as const,
            targetId: noteIds[(i + step) % 1000]!,
            targetTitle: `perf note ${(i + step) % 1000}`,
            targetHeading: null,
            targetBlock: null,
            position: 0,
            length: 10,
            broken: false,
          })),
        );
      }
    });

    const started = performance.now();
    const res = await perfApp.inject({ method: 'GET', url: '/api/v1/graph' });
    const elapsed = performance.now() - started;

    expect(res.statusCode).toBe(200);
    const graph = res.json().data as GraphJson;
    expect(graph.stats.nodes).toBe(1000);
    expect(graph.stats.edges).toBe(3000);
    expect(elapsed).toBeLessThan(500);
    await perfApp.close();
  }, 20_000);
});
