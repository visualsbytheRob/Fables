import { dayKey } from '@fables/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let storyId: string;
let optOutStoryId: string;
let heroId: string;

async function post(url: string, payload: unknown) {
  return app.inject({ method: 'POST', url: `/api/v1${url}`, payload: payload as object });
}

const ingest = (id: string, payload: Record<string, unknown>) =>
  post(`/stories/${id}/effects`, payload);

async function dailyNote(): Promise<{ id: string; title: string; body: string } | null> {
  const notebooks = await app.inject({ method: 'GET', url: '/api/v1/notebooks' });
  const journal = notebooks.json().data.find((n: { name: string }) => n.name === 'Journal') as
    | { id: string }
    | undefined;
  if (!journal) return null;
  const notes = await app.inject({
    method: 'GET',
    url: `/api/v1/notes?notebookId=${journal.id}`,
  });
  const note = notes.json().data.find((n: { title: string }) => n.title === dayKey());
  if (!note) return null;
  const full = await app.inject({ method: 'GET', url: `/api/v1/notes/${note.id}` });
  return full.json().data;
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  storyId = (await post('/stories', { title: 'The Long Road' })).json().data.id;
  optOutStoryId = (
    await post('/stories', { title: 'Private Story', settings: { journalOptOut: true } })
  ).json().data.id;
  heroId = (
    await post('/entities', { type: 'character', name: 'Petra', fields: { health: 10 } })
  ).json().data.id;
});

afterAll(async () => {
  await app.close();
});

describe('journal effects (F631/F632/F638)', () => {
  it("appends structured entries to today's daily note in the Journal notebook", async () => {
    const res = await ingest(storyId, {
      playthroughId: 'pt1',
      idempotencyKey: 'batch-journal-1',
      events: [
        {
          type: 'journal',
          payload: { text: 'Set off at dawn.', scene: 'departure', choice: 'Take the road' },
        },
        { type: 'journal', payload: { text: 'Crossed the ford.' } },
      ],
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data).toMatchObject({ replayed: false, applied: 2 });
    expect(data.results[0]).toMatchObject({ type: 'journal', dayKey: dayKey() });

    const note = await dailyNote();
    expect(note).not.toBeNull();
    expect(note!.title).toBe(dayKey());
    expect(note!.body).toContain('Set off at dawn.');
    expect(note!.body).toContain('departure');
    expect(note!.body).toContain('(chose: "Take the road")');
    expect(note!.body).toContain(`[The Long Road](/stories/${storyId})`);
    expect(note!.body).toContain('Crossed the ford.');
    expect(data.results[0].noteId).toBe(note!.id);
  });

  it('batches into one daily note across batches (find-or-create by dayKey)', async () => {
    const before = (await dailyNote())!;
    await ingest(storyId, {
      playthroughId: 'pt1',
      idempotencyKey: 'batch-journal-2',
      events: [{ type: 'journal', payload: { text: 'Slept under the stars.' } }],
    });
    const after = (await dailyNote())!;
    expect(after.id).toBe(before.id);
    expect(after.body).toContain('Slept under the stars.');
  });
});

describe('entity_set effects (F633-adjacent mutation audit)', () => {
  it('mutates schema-validated fields and records the audit trail', async () => {
    const res = await ingest(storyId, {
      playthroughId: 'pt1',
      idempotencyKey: 'batch-set-1',
      events: [{ type: 'entity_set', payload: { entity: 'Petra', field: 'health', value: 3 } }],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.results[0]).toMatchObject({
      type: 'entity_set',
      entityId: heroId,
      field: 'health',
      oldValue: 10,
      newValue: 3,
    });

    const entity = await app.inject({ method: 'GET', url: `/api/v1/entities/${heroId}` });
    expect(entity.json().data.fields.health).toBe(3);

    const audit = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/playthroughs/pt1/mutations`,
    });
    expect(audit.json().data).toHaveLength(1);
    expect(audit.json().data[0]).toMatchObject({
      entityId: heroId,
      field: 'health',
      oldValue: 10,
      newValue: 3,
      playthroughId: 'pt1',
    });
  });

  it('rejects invalid values naming the field, atomically', async () => {
    const res = await ingest(storyId, {
      playthroughId: 'pt1',
      idempotencyKey: 'batch-set-bad',
      events: [
        { type: 'journal', payload: { text: 'Should never be written.' } },
        { type: 'entity_set', payload: { entity: 'Petra', field: 'health', value: 'full' } },
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('"health"');
    // atomic: the journal event in the same batch rolled back
    const note = await dailyNote();
    expect(note?.body ?? '').not.toContain('Should never be written.');
    // and the failed key was not consumed — a corrected retry applies
    const retry = await ingest(storyId, {
      playthroughId: 'pt1',
      idempotencyKey: 'batch-set-bad',
      events: [{ type: 'entity_set', payload: { entity: 'Petra', field: 'health', value: 2 } }],
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().data.replayed).toBe(false);
  });

  it('404s unknown entity references', async () => {
    const res = await ingest(storyId, {
      playthroughId: 'pt1',
      idempotencyKey: 'batch-set-nope',
      events: [{ type: 'entity_set', payload: { entity: 'Nobody', field: 'health', value: 1 } }],
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('encounter + reveal effects route to the codex (F613/F616)', () => {
  it('feeds met-tracking and revealed facts', async () => {
    const res = await ingest(storyId, {
      playthroughId: 'pt-codex',
      idempotencyKey: 'batch-codex-1',
      events: [
        { type: 'encounter', payload: { entity: 'Petra' } },
        { type: 'reveal', payload: { entity: heroId, field: 'health' } },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.results[0]).toMatchObject({ type: 'encounter', entityId: heroId });
    expect(res.json().data.results[1]).toMatchObject({
      type: 'reveal',
      field: 'health',
      revealed: true,
    });

    const codex = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/codex?playthroughId=pt-codex`,
    });
    const entries = codex.json().data.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityId: heroId, name: 'Petra' });
    expect(entries[0].revealedFields).toEqual({ health: 2 });
  });
});

describe('idempotency (F638)', () => {
  it('replays a known key without re-applying', async () => {
    const body = {
      playthroughId: 'pt-idem',
      idempotencyKey: 'batch-idem-1',
      events: [
        { type: 'journal', payload: { text: 'Once only.' } },
        { type: 'entity_set', payload: { entity: 'Petra', field: 'health', value: 9 } },
        { type: 'encounter', payload: { entity: 'Petra' } },
      ],
    };
    const first = await ingest(storyId, body);
    expect(first.statusCode).toBe(201);
    expect(first.json().data.replayed).toBe(false);

    const replay = await ingest(storyId, body);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.replayed).toBe(true);
    expect(replay.json().data.results).toEqual(first.json().data.results);

    // journal appended once
    const note = (await dailyNote())!;
    expect(note.body.split('Once only.').length - 1).toBe(1);
    // encounter counted once
    const codex = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/codex?playthroughId=pt-idem`,
    });
    expect(codex.json().data.entries[0].encounters).toBe(1);
    // mutation applied once
    const audit = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/playthroughs/pt-idem/mutations`,
    });
    expect(audit.json().data).toHaveLength(1);
  });
});

describe('journal privacy opt-out (F639)', () => {
  it('rejects journal events from opted-out stories with FORBIDDEN', async () => {
    const res = await ingest(optOutStoryId, {
      playthroughId: 'pt1',
      idempotencyKey: 'batch-optout-1',
      events: [{ type: 'journal', payload: { text: 'Private business.' } }],
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    const note = await dailyNote();
    expect(note?.body ?? '').not.toContain('Private business.');
  });

  it('still accepts non-journal effects from opted-out stories', async () => {
    const res = await ingest(optOutStoryId, {
      playthroughId: 'pt1',
      idempotencyKey: 'batch-optout-2',
      events: [{ type: 'encounter', payload: { entity: 'Petra' } }],
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('effect audit (F640)', () => {
  it('lists every ingested event per playthrough', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/effects?playthroughId=pt-idem`,
    });
    expect(res.statusCode).toBe(200);
    const types = res.json().data.map((e: { type: string }) => e.type);
    expect(types).toEqual(['journal', 'entity_set', 'encounter']);
    expect(res.json().data[0]).toMatchObject({
      playthroughId: 'pt-idem',
      batchKey: 'batch-idem-1',
    });
  });

  it('validates the batch envelope', async () => {
    const res = await ingest(storyId, { playthroughId: 'p', events: [] });
    expect(res.statusCode).toBe(422);
  });
});
