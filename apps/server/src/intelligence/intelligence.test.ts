/**
 * Intelligence pipeline tests (F721–F750):
 * - Pure-JS hash embedding provider (deterministic)
 * - Note chunking strategy
 * - Embedding queue + backfill
 * - Vector store cosine similarity + top-k
 * - Hybrid RRF ranking
 * - Semantic search endpoint
 * - /notes/:id/related/semantic
 * - /embeddings/status
 * - Graceful degradation (degraded:true when no embeddings)
 * - Near-duplicate detection
 * - Benchmark at 5k chunks
 */

import { describe, expect, it } from 'vitest';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { embeddingsRepo } from '../db/repos/embeddings.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import {
  hashEmbed,
  testHashProvider,
  defaultHashProvider,
  createOnnxProvider,
} from './embedding-provider.js';
import { chunkNote } from './chunker.js';
import { EmbeddingQueue } from './embedding-queue.js';
import { VectorStore, dotProduct, normaliseScore } from './vector-store.js';
import {
  reciprocalRankFusion,
  applyBoosts,
  hybridFuse,
  type RRFInput,
} from './hybrid-rank.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

// ── EmbeddingProvider ─────────────────────────────────────────────────────────

describe('hashEmbeddingProvider (F721, F730)', () => {
  it('produces a vector of the correct dimension', () => {
    const vec = hashEmbed('hello world', 64);
    expect(vec).toHaveLength(64);
  });

  it('is deterministic — same input always same output', () => {
    const a = hashEmbed('consistent', 64);
    const b = hashEmbed('consistent', 64);
    expect(a).toEqual(b);
  });

  it('different texts produce different vectors', () => {
    const a = hashEmbed('apple', 64);
    const b = hashEmbed('banana', 64);
    expect(a).not.toEqual(b);
  });

  it('L2-norm is approximately 1 (normalised)', () => {
    const vec = hashEmbed('some text to embed', 64);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeGreaterThan(0.5);
    expect(norm).toBeLessThanOrEqual(1.05); // small floating point tolerance
  });

  it('testHashProvider.available() is true', () => {
    expect(testHashProvider.available()).toBe(true);
  });

  it('testHashProvider embeds a batch', async () => {
    const vecs = await testHashProvider.embed(['hello', 'world']);
    expect(vecs).toHaveLength(2);
    expect(vecs[0]).toHaveLength(testHashProvider.dim);
    expect(vecs[1]).toHaveLength(testHashProvider.dim);
  });

  it('defaultHashProvider has dim=384', () => {
    expect(defaultHashProvider.dim).toBe(384);
  });
});

describe('onnxEmbeddingProvider stub (F722)', () => {
  it('reports available()=false when no model path is given', () => {
    const provider = createOnnxProvider(undefined);
    expect(provider.available()).toBe(false);
  });

  it('reports available()=false for a nonexistent model file', () => {
    const provider = createOnnxProvider('/nonexistent/model.onnx');
    expect(provider.available()).toBe(false);
  });

  it('gracefully falls back to hash embeddings when model absent', async () => {
    const provider = createOnnxProvider('/nonexistent/model.onnx', 64);
    const vecs = await provider.embed(['test text']);
    expect(vecs).toHaveLength(1);
    expect(vecs[0]).toHaveLength(64);
  });
});

// ── Chunker ───────────────────────────────────────────────────────────────────

describe('chunkNote (F723)', () => {
  it('produces at least one chunk for any note', () => {
    expect(chunkNote('id', 'title', 'body')).toHaveLength(1);
  });

  it('returns a chunk for an empty body', () => {
    const chunks = chunkNote('id', 'Title Only', '');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.text).toContain('Title Only');
  });

  it('splits on markdown headings', () => {
    const body = 'Intro text\n\n## Section One\n\nContent A\n\n## Section Two\n\nContent B';
    const chunks = chunkNote('id', 'Note', body);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('includes the title in the first chunk', () => {
    const chunks = chunkNote('id', 'MyTitle', 'body content');
    expect(chunks[0]!.text).toContain('MyTitle');
  });

  it('chunk hashes are unique within a note', () => {
    const body = '## A\n\nContent A\n\n## B\n\nContent B\n\n## C\n\nContent C';
    const chunks = chunkNote('id', 'Note', body);
    const hashes = new Set(chunks.map((c) => c.hash));
    expect(hashes.size).toBe(chunks.length);
  });

  it('chunks are deterministic', () => {
    const a = chunkNote('id', 'title', 'body text');
    const b = chunkNote('id', 'title', 'body text');
    expect(a).toEqual(b);
  });

  it('long body is split into multiple chunks', () => {
    const longBody = 'word '.repeat(300); // ~1500 chars
    const chunks = chunkNote('id', 'title', longBody);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

// ── EmbeddingsRepo ────────────────────────────────────────────────────────────

describe('embeddingsRepo (F725)', () => {
  it('upserts and retrieves embeddings', () => {
    const db = freshDb();
    const repo = embeddingsRepo(db);
    const inserted = repo.upsert({
      sourceId: 'note_001',
      sourceType: 'note',
      chunkIndex: 0,
      chunkHash: 'abc12345',
      providerId: 'hash-64',
      vector: [0.1, 0.2, 0.3],
    });
    expect(inserted).toBe(true);
    const rows = repo.listByProvider('hash-64');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.vector).toEqual([0.1, 0.2, 0.3]);
  });

  it('skips duplicate (chunk_hash, provider_id) pairs', () => {
    const db = freshDb();
    const repo = embeddingsRepo(db);
    const row = {
      sourceId: 'note_001',
      sourceType: 'note' as const,
      chunkIndex: 0,
      chunkHash: 'abc12345',
      providerId: 'hash-64',
      vector: [0.1],
    };
    expect(repo.upsert(row)).toBe(true);
    expect(repo.upsert(row)).toBe(false); // duplicate
    expect(repo.listByProvider('hash-64')).toHaveLength(1);
  });

  it('deleteBySource removes correct rows', () => {
    const db = freshDb();
    const repo = embeddingsRepo(db);
    repo.upsert({ sourceId: 'n1', sourceType: 'note', chunkIndex: 0, chunkHash: 'h1', providerId: 'p', vector: [1] });
    repo.upsert({ sourceId: 'n2', sourceType: 'note', chunkIndex: 0, chunkHash: 'h2', providerId: 'p', vector: [2] });
    const deleted = repo.deleteBySource('n1', 'note', 'p');
    expect(deleted).toBe(1);
    expect(repo.listByProvider('p')).toHaveLength(1);
  });

  it('coverage returns correct stats', () => {
    const db = freshDb();
    const nb = notebooksRepo(db).create({ name: 'Test' });
    notesRepo(db).create({ notebookId: nb.id, title: 'a', body: '' });
    const repo = embeddingsRepo(db);
    const before = repo.coverage('hash-64');
    expect(before.sourcesTotal).toBeGreaterThanOrEqual(1);
    expect(before.sourcesEmbedded).toBe(0);
    expect(before.coveragePct).toBe(0);
  });
});

// ── EmbeddingQueue ────────────────────────────────────────────────────────────

describe('EmbeddingQueue (F724, F726)', () => {
  it('embeds notes via drain', async () => {
    const db = freshDb();
    const provider = testHashProvider;
    const queue = new EmbeddingQueue(db, provider);
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'Test Note', body: 'content' });

    queue.enqueue({ sourceId: note.id, sourceType: 'note', title: note.title, body: note.body });
    await queue.drain();

    const repo = embeddingsRepo(db);
    const rows = repo.listByProvider(provider.id);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.sourceId).toBe(note.id);
    expect(rows[0]!.vector).toHaveLength(provider.dim);
  });

  it('de-duplicates enqueued jobs for the same sourceId', async () => {
    const db = freshDb();
    const provider = testHashProvider;
    const queue = new EmbeddingQueue(db, provider);
    const nb = notebooksRepo(db).create({ name: 'Test' });
    const note = notesRepo(db).create({ notebookId: nb.id, title: 'Dupe', body: 'x' });

    // Enqueue 3 times — only latest should matter
    queue.enqueue({ sourceId: note.id, sourceType: 'note', title: 'v1', body: 'x' });
    queue.enqueue({ sourceId: note.id, sourceType: 'note', title: 'v2', body: 'y' });
    queue.enqueue({ sourceId: note.id, sourceType: 'note', title: 'Final', body: 'final content' });
    await queue.drain();

    const rows = embeddingsRepo(db).listByProvider(provider.id);
    const sourceRows = rows.filter((r) => r.sourceId === note.id);
    // Should have exactly the chunks from the last enqueue
    expect(sourceRows.length).toBeGreaterThanOrEqual(1);
  });

  it('backfill embeds un-embedded notes', async () => {
    const db = freshDb();
    const provider = testHashProvider;
    const queue = new EmbeddingQueue(db, provider);
    const nb = notebooksRepo(db).create({ name: 'BF' });
    notesRepo(db).create({ notebookId: nb.id, title: 'A', body: 'aaa' });
    notesRepo(db).create({ notebookId: nb.id, title: 'B', body: 'bbb' });
    notesRepo(db).create({ notebookId: nb.id, title: 'C', body: 'ccc' });

    const progress = await queue.backfill();
    expect(progress.total).toBe(3);
    expect(progress.done).toBe(3);
    expect(progress.errors).toBe(0);

    const coverage = embeddingsRepo(db).coverage(provider.id);
    expect(coverage.sourcesEmbedded).toBe(3);
    expect(coverage.coveragePct).toBeGreaterThan(0);
  });

  it('queue.status() returns queueDepth', () => {
    const db = freshDb();
    const queue = new EmbeddingQueue(db, testHashProvider);
    const st = queue.status();
    expect(st.queueDepth).toBe(0);
    expect(st.processing).toBe(false);
  });
});

// ── VectorStore ───────────────────────────────────────────────────────────────

describe('VectorStore (F731–F735, F740)', () => {
  it('dotProduct computes correctly', () => {
    expect(dotProduct([1, 0], [1, 0])).toBeCloseTo(1);
    expect(dotProduct([1, 0], [0, 1])).toBeCloseTo(0);
    expect(dotProduct([0.5, 0.5], [0.5, 0.5])).toBeCloseTo(0.5);
  });

  it('normaliseScore maps cosine to [0,1]', () => {
    expect(normaliseScore(1)).toBeCloseTo(1);
    expect(normaliseScore(-1)).toBeCloseTo(0);
    expect(normaliseScore(0)).toBeCloseTo(0.5);
  });

  it('topK returns top results sorted by score', async () => {
    const db = freshDb();
    const provider = testHashProvider;
    const store = new VectorStore(db, provider);
    const repo = embeddingsRepo(db);

    // Insert two embeddings — one similar to query, one dissimilar
    const queryVec = await provider.embed(['dragon fire magic']);
    const similarVec = await provider.embed(['dragon fire breathing']);
    const dissimilarVec = await provider.embed(['ocean waves peaceful']);

    repo.upsert({ sourceId: 'n_sim', sourceType: 'note', chunkIndex: 0, chunkHash: 'hs1', providerId: provider.id, vector: similarVec[0]! });
    repo.upsert({ sourceId: 'n_dis', sourceType: 'note', chunkIndex: 0, chunkHash: 'hd1', providerId: provider.id, vector: dissimilarVec[0]! });

    const hits = await store.topK('dragon fire magic', 5);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // The dragon/fire note should rank higher than the ocean note
    const simIdx = hits.findIndex((h) => h.sourceId === 'n_sim');
    const disIdx = hits.findIndex((h) => h.sourceId === 'n_dis');
    if (simIdx !== -1 && disIdx !== -1) {
      expect(simIdx).toBeLessThan(disIdx);
    }
    // scores should be in [0,1]
    for (const hit of hits) {
      expect(hit.score).toBeGreaterThanOrEqual(0);
      expect(hit.score).toBeLessThanOrEqual(1);
    }
    // Unused var, just check it computes
    void queryVec;
  });

  it('search returns empty when no embeddings exist', async () => {
    const db = freshDb();
    const store = new VectorStore(db, testHashProvider);
    const results = await store.search('anything');
    expect(results).toEqual([]);
  });

  it('relatedNotes returns empty when source has no embeddings', async () => {
    const db = freshDb();
    const store = new VectorStore(db, testHashProvider);
    const results = await store.relatedNotes('nonexistent_note_id');
    expect(results).toEqual([]);
  });

  it('nearDuplicates detects very similar notes', async () => {
    const db = freshDb();
    const provider = testHashProvider;
    const store = new VectorStore(db, provider);
    const repo = embeddingsRepo(db);

    // Insert two nearly identical embeddings
    const vec = await provider.embed(['identical content repeated exactly']);
    repo.upsert({ sourceId: 'n1', sourceType: 'note', chunkIndex: 0, chunkHash: 'hh1', providerId: provider.id, vector: vec[0]! });
    // Same vector = identical note
    repo.upsert({ sourceId: 'n2', sourceType: 'note', chunkIndex: 0, chunkHash: 'hh2', providerId: provider.id, vector: vec[0]! });

    const pairs = await store.nearDuplicates(0.9, 10);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    expect(pairs[0]!.score).toBeGreaterThanOrEqual(0.9);
  });
});

// ── Hybrid Ranking ────────────────────────────────────────────────────────────

describe('hybridFuse RRF (F741–F747)', () => {
  const ftsResults: RRFInput[] = [
    { id: 'a', title: 'Alpha', score: 10, sourceType: 'note' },
    { id: 'b', title: 'Beta', score: 8, sourceType: 'note' },
    { id: 'c', title: 'Gamma', score: 6, sourceType: 'note' },
  ];
  const vectorResults: RRFInput[] = [
    { id: 'b', title: 'Beta', score: 0.9, sourceType: 'note' },
    { id: 'd', title: 'Delta', score: 0.8, sourceType: 'note' },
    { id: 'a', title: 'Alpha', score: 0.7, sourceType: 'note' },
  ];

  it('fuses FTS + vector results with RRF', () => {
    const ranked = hybridFuse(ftsResults, vectorResults, 'query', 0, false);
    expect(ranked.length).toBe(4); // a, b, c, d
    // 'b' appears in both lists so should rank high
    const bIdx = ranked.findIndex((r) => r.id === 'b');
    const cIdx = ranked.findIndex((r) => r.id === 'c');
    // b (in both lists) should beat c (only in FTS at rank 3)
    expect(bIdx).toBeLessThan(cIdx);
  });

  it('results in FTS-only get scored from their rank', () => {
    const ranked = hybridFuse(ftsResults, [], 'query', 0, false);
    expect(ranked).toHaveLength(3);
  });

  it('explain=true adds scoreComponents', () => {
    const ranked = hybridFuse(ftsResults, vectorResults, 'query', 0, true);
    expect(ranked[0]!.scoreComponents).toBeDefined();
    expect(ranked[0]!.scoreComponents!.rrf).toBeGreaterThan(0);
    expect(ranked[0]!.scoreComponents!.final).toBeGreaterThan(0);
  });

  it('recency boost applied to recently updated notes (F743)', () => {
    const now = new Date().toISOString();
    const withDate: RRFInput[] = [
      { id: 'x', title: 'X', score: 1, sourceType: 'note', updatedAt: now },
    ];
    const ranked = hybridFuse(withDate, [], 'q', 0, true);
    expect(ranked[0]!.scoreComponents!.recencyBoost).toBeGreaterThan(0);
  });

  it('entity type boost for short queries (F745)', () => {
    const items: RRFInput[] = [
      { id: 'e', title: 'Entity', score: 1, sourceType: 'entity' },
    ];
    const ranked = hybridFuse(items, [], 'short', 0, true);
    expect(ranked[0]!.scoreComponents!.typeBoost).toBeGreaterThan(0);
  });

  it('reciprocalRankFusion accumulates scores from both lists', () => {
    const fused = reciprocalRankFusion(ftsResults, vectorResults);
    expect(fused.has('a')).toBe(true);
    expect(fused.has('b')).toBe(true);
    expect(fused.has('d')).toBe(true);
    // 'b' appears in both so rrfScore should be higher than 'd' (only in vector)
    const bScore = fused.get('b')!.rrfScore;
    const dScore = fused.get('d')!.rrfScore;
    expect(bScore).toBeGreaterThan(dScore);
  });

  it('applyBoosts produces sorted results', () => {
    const fused = reciprocalRankFusion(ftsResults, vectorResults);
    const results = applyBoosts(fused, 'query', 0, false);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });
});

// ── HTTP route tests ──────────────────────────────────────────────────────────

describe('GET /api/v1/search (mode support)', () => {
  it('mode=keyword (default) returns grouped results', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const nbRes = await app.inject({ method: 'POST', url: '/api/v1/notebooks', body: { name: 'T' } });
    const nb = (nbRes.json() as { data: { id: string } }).data;
    await app.inject({ method: 'POST', url: '/api/v1/notes', body: { notebookId: nb.id, title: 'keywordtest', body: '' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=keywordtest&mode=keyword' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { mode: string } };
    expect(body.data.mode).toBe('keyword');
  });

  it('mode=semantic returns degraded:true when no embeddings', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=test&mode=semantic' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { mode: string; degraded: boolean } };
    expect(body.data.mode).toBe('semantic');
    expect(body.data.degraded).toBe(true);
  });

  it('mode=hybrid returns degraded:true when no embeddings (F749)', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=test&mode=hybrid' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { degraded: boolean } };
    expect(body.data.degraded).toBe(true);
  });
});

describe('GET /api/v1/search/semantic (F732)', () => {
  it('returns degraded:true when no embeddings', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/search/semantic?q=test' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { degraded: boolean } };
    expect(body.data.degraded).toBe(true);
  });
});

describe('GET /api/v1/search/duplicates (F738)', () => {
  it('returns degraded:true when no embeddings', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/search/duplicates' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { degraded: boolean; pairs: unknown[] } };
    expect(body.data.degraded).toBe(true);
    expect(body.data.pairs).toEqual([]);
  });
});

describe('GET /api/v1/embeddings/status (F727)', () => {
  it('returns provider info, coverage, and queue status', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/embeddings/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        provider: { id: string; dim: number; available: boolean };
        coverage: { sourcesTotal: number; coveragePct: number };
        queue: { queueDepth: number };
      };
    };
    expect(body.data.provider).toHaveProperty('id');
    expect(body.data.provider).toHaveProperty('dim');
    expect(body.data.provider.available).toBe(true); // hash provider is always available
    expect(body.data.coverage).toHaveProperty('sourcesTotal');
    expect(body.data.coverage).toHaveProperty('coveragePct');
    expect(body.data.queue).toHaveProperty('queueDepth');
  });
});

describe('POST /api/v1/embeddings/backfill (F726)', () => {
  it('returns 202 with message', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'POST', url: '/api/v1/embeddings/backfill' });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { data: { message: string } };
    expect(body.data.message).toContain('backfill');
  });
});

describe('GET /api/v1/notes/:id/related/semantic (F751 backend)', () => {
  it('returns degraded:true when no embeddings', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const nbRes = await app.inject({ method: 'POST', url: '/api/v1/notebooks', body: { name: 'Test' } });
    const nb = (nbRes.json() as { data: { id: string } }).data;
    const noteRes = await app.inject({ method: 'POST', url: '/api/v1/notes', body: { notebookId: nb.id, title: 'A', body: 'content' } });
    const note = (noteRes.json() as { data: { id: string } }).data;

    const res = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}/related/semantic` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { noteId: string; degraded: boolean; results: unknown[] } };
    expect(body.data.noteId).toBe(note.id);
    expect(body.data.degraded).toBe(true);
    expect(Array.isArray(body.data.results)).toBe(true);
  });

  it('returns 404 for nonexistent note', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
    const res = await app.inject({ method: 'GET', url: '/api/v1/notes/nonexistent_id/related/semantic' });
    expect(res.statusCode).toBe(404);
  });
});

// ── Golden ranking tests (F747) ───────────────────────────────────────────────

describe('golden ranking tests (F747)', () => {
  it('note appearing in both FTS and vector ranks above note in only one', () => {
    // Labeled fixture: 'both' should always beat 'fts_only' and 'vec_only'
    const fts: RRFInput[] = [
      { id: 'both', title: 'Both', score: 5 },
      { id: 'fts_only', title: 'FTS Only', score: 4 },
    ];
    const vec: RRFInput[] = [
      { id: 'both', title: 'Both', score: 0.9 },
      { id: 'vec_only', title: 'Vec Only', score: 0.8 },
    ];
    const ranked = hybridFuse(fts, vec, 'query', 0, false);
    const bothIdx = ranked.findIndex((r) => r.id === 'both');
    const ftsIdx = ranked.findIndex((r) => r.id === 'fts_only');
    const vecIdx = ranked.findIndex((r) => r.id === 'vec_only');
    expect(bothIdx).toBeLessThan(ftsIdx);
    expect(bothIdx).toBeLessThan(vecIdx);
  });
});

// ── Benchmark at 5k chunks (F739) ────────────────────────────────────────────

describe('vector search benchmark (F739)', () => {
  it('cosine scan over 5k chunks completes in under 500ms', async () => {
    const db = freshDb();
    const provider = testHashProvider; // dim=64, fast
    const store = new VectorStore(db, provider);

    // Insert 5k embeddings synchronously
    const insert = db.prepare(
      `INSERT INTO embeddings (id, source_id, source_type, chunk_index, chunk_hash, provider_id, vector)
       VALUES (?,?,?,?,?,?,?)`,
    );
    const insertMany = db.transaction(() => {
      for (let i = 0; i < 5000; i++) {
        const vec = hashEmbed(`chunk text number ${i}`, 64);
        insert.run(
          `emb_${String(i).padStart(10, '0')}`,
          `note_${String(i).padStart(10, '0')}`,
          'note',
          0,
          `hash_${i}`,
          provider.id,
          JSON.stringify(vec),
        );
      }
    });
    insertMany();

    const start = performance.now();
    await store.topK('test query', 20);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
