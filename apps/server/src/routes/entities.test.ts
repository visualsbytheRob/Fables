import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

let app: FastifyInstance;
let inboxId: string;

async function post(url: string, payload: unknown) {
  return app.inject({ method: 'POST', url: `/api/v1${url}`, payload: payload as object });
}

async function createEntity(payload: Record<string, unknown>) {
  const res = await post('/entities', payload);
  return res;
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const nb = await post('/notebooks', { name: 'Inbox' });
  inboxId = nb.json().data.id;
});

afterAll(async () => {
  await app.close();
});

describe('entity type schemas (F602/F608/F609)', () => {
  it('seeds editable defaults for every built-in type', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/entities/schemas' });
    expect(res.statusCode).toBe(200);
    const types = res.json().data.map((s: { type: string }) => s.type);
    expect(types).toEqual(['character', 'custom', 'faction', 'item', 'place']);

    const character = await app.inject({
      method: 'GET',
      url: '/api/v1/entities/schemas/character',
    });
    const fields = character.json().data.fields;
    expect(fields).toContainEqual({ name: 'health', fieldType: 'number', default: 100 });
    expect(character.json().data.relations).toContainEqual({
      name: 'located-in',
      targetType: 'place',
    });
  });

  it('shapes schemas for the compiler entity-field checks (F369)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/entities/schemas/character' });
    for (const field of res.json().data.fields) {
      expect(['number', 'string', 'bool', 'list']).toContain(field.fieldType);
    }
  });

  it('lets the user edit a type schema, rejecting malformed definitions', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/entities/schemas/custom',
      payload: {
        fields: [
          { name: 'power', fieldType: 'number', default: 1 },
          { name: 'motto', fieldType: 'string', required: true },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.fields).toHaveLength(2);

    const dupe = await app.inject({
      method: 'PUT',
      url: '/api/v1/entities/schemas/custom',
      payload: {
        fields: [
          { name: 'x', fieldType: 'bool' },
          { name: 'x', fieldType: 'bool' },
        ],
      },
    });
    expect(dupe.statusCode).toBe(422);
    expect(dupe.json().error.message).toContain('duplicate field "x"');

    const badDefault = await app.inject({
      method: 'PUT',
      url: '/api/v1/entities/schemas/custom',
      payload: { fields: [{ name: 'speed', fieldType: 'number', default: 'fast' }] },
    });
    expect(badDefault.statusCode).toBe(422);
    expect(badDefault.json().error.message).toContain('"speed"');
  });
});

describe('entity CRUD with schema validation (F601/F608/F610)', () => {
  it('creates a typed entity, applying schema defaults', async () => {
    const res = await createEntity({
      type: 'character',
      name: 'Reynard',
      aliases: ['The Fox'],
      fields: { role: 'trickster' },
    });
    expect(res.statusCode).toBe(201);
    const entity = res.json().data;
    expect(entity.id).toMatch(/^ent_/);
    expect(entity.fields).toEqual({
      health: 100,
      alive: true,
      role: 'trickster',
      traits: [],
    });
  });

  it('rejects bad field values with the field named (F608)', async () => {
    const wrongType = await createEntity({
      type: 'character',
      name: 'Brokenfield',
      fields: { health: 'plenty' },
    });
    expect(wrongType.statusCode).toBe(422);
    expect(wrongType.json().error.message).toContain('"health"');
    expect(wrongType.json().error.message).toContain('number');

    const unknown = await createEntity({
      type: 'character',
      name: 'Unknownfield',
      fields: { mana: 5 },
    });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().error.message).toContain('"mana"');
  });

  it('enforces required fields added to a schema', async () => {
    const res = await createEntity({ type: 'custom', name: 'Mysterious Orb' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('"motto"');

    const ok = await createEntity({
      type: 'custom',
      name: 'Mysterious Orb',
      fields: { motto: 'gleam' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.fields).toEqual({ power: 1, motto: 'gleam' });
  });

  it('patches merge fields and re-validate', async () => {
    const created = await createEntity({ type: 'character', name: 'Bran' });
    const id = created.json().data.id;
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/entities/${id}`,
      payload: { fields: { health: 42 } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.fields.health).toBe(42);
    expect(patched.json().data.fields.alive).toBe(true); // untouched fields survive

    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/v1/entities/${id}`,
      payload: { fields: { alive: 'yes' } },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.message).toContain('"alive"');
  });

  it('enforces alias/name uniqueness across entities (F605)', async () => {
    await createEntity({ type: 'character', name: 'Isolde', aliases: ['The Healer'] });
    const nameClash = await createEntity({ type: 'place', name: 'isolde' });
    expect(nameClash.statusCode).toBe(409);
    const aliasClash = await createEntity({
      type: 'character',
      name: 'Morgan',
      aliases: ['the healer'],
    });
    expect(aliasClash.statusCode).toBe(409);
    expect(aliasClash.json().error.message).toContain('the healer');
  });

  it('deletes entities along with their links', async () => {
    const created = await createEntity({ type: 'item', name: 'Cursed Coin' });
    const id = created.json().data.id;
    const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/entities/${id}` });
    expect(deleted.json().data).toEqual({ id, deleted: true });
    const gone = await app.inject({ method: 'GET', url: `/api/v1/entities/${id}` });
    expect(gone.statusCode).toBe(404);
  });
});

describe('relationship fields → typed relation links (F606)', () => {
  it('creates typed relation rows and validates target types', async () => {
    const forest = await createEntity({ type: 'place', name: 'Greywood' });
    const forestId = forest.json().data.id;
    const wolf = await createEntity({
      type: 'character',
      name: 'Greyfang',
      relations: { 'located-in': [forestId] },
    });
    expect(wolf.statusCode).toBe(201);
    expect(wolf.json().data.relations).toEqual({ 'located-in': [forestId] });

    // incoming side is visible on the target
    const fetched = await app.inject({ method: 'GET', url: `/api/v1/entities/${forestId}` });
    expect(fetched.json().data.incomingRelations).toContainEqual({
      name: 'located-in',
      sourceId: wolf.json().data.id,
    });

    // a character cannot be "located-in" another character
    const bad = await createEntity({
      type: 'character',
      name: 'Lostsoul',
      relations: { 'located-in': [wolf.json().data.id] },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.message).toContain('located-in');

    const unknownRelation = await createEntity({
      type: 'character',
      name: 'Norel',
      relations: { 'sworn-to': [forestId] },
    });
    expect(unknownRelation.statusCode).toBe(422);
    expect(unknownRelation.json().error.message).toContain('sworn-to');
  });
});

describe('search by name/alias (F609)', () => {
  it('matches names and aliases, case-insensitively, with type filters', async () => {
    await createEntity({ type: 'faction', name: 'Ember Court', aliases: ['The Ashen'] });
    const byAlias = await app.inject({ method: 'GET', url: '/api/v1/entities?q=ashen' });
    expect(byAlias.json().data.map((e: { name: string }) => e.name)).toContain('Ember Court');

    const wrongType = await app.inject({
      method: 'GET',
      url: '/api/v1/entities?q=ashen&type=place',
    });
    expect(wrongType.json().data).toHaveLength(0);
  });
});

describe('backing notes (F601/F609)', () => {
  it('creates a backing note on demand, idempotently', async () => {
    const created = await createEntity({ type: 'place', name: 'Saltmarsh' });
    const id = created.json().data.id;

    const first = await post(`/entities/${id}/note`, {});
    expect(first.statusCode).toBe(201);
    expect(first.json().data.note.title).toBe('Saltmarsh');
    expect(first.json().data.entity.noteId).toBe(first.json().data.note.id);

    const second = await post(`/entities/${id}/note`, {});
    expect(second.statusCode).toBe(200);
    expect(second.json().data.note.id).toBe(first.json().data.note.id);
  });
});

describe('entity mentions in notes (F605)', () => {
  it('detects entity names and aliases as unlinked mentions', async () => {
    const created = await createEntity({
      type: 'character',
      name: 'Wrenna',
      aliases: ['Sparrow Queen'],
    });
    const id = created.json().data.id;
    const note = await post('/notes', {
      notebookId: inboxId,
      title: 'Court gossip',
      body: 'They say the sparrow queen walks at night. Wrenna denies it.',
    });
    expect(note.statusCode).toBe(201);

    const mentions = await app.inject({ method: 'GET', url: `/api/v1/entities/${id}/mentions` });
    const texts = mentions.json().data.map((m: { text: string }) => m.text);
    expect(texts).toContain('sparrow queen');
    expect(texts).toContain('Wrenna');
  });

  it('re-detects mentions when aliases change, and converts them to wikilinks', async () => {
    const created = await createEntity({ type: 'character', name: 'Aldous' });
    const id = created.json().data.id;
    const note = await post('/notes', {
      notebookId: inboxId,
      title: 'Tavern rumours',
      body: 'The old archivist knows. Ask Aldous about the key.',
    });
    const noteId = note.json().data.id;

    // alias added later → existing note bodies re-scan
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/entities/${id}`,
      payload: { aliases: ['old archivist'] },
    });
    const mentions = await app.inject({ method: 'GET', url: `/api/v1/entities/${id}/mentions` });
    expect(mentions.json().data.map((m: { text: string }) => m.text)).toContain('old archivist');

    const converted = await post(`/entities/${id}/mentions/convert`, { all: true });
    expect(converted.statusCode).toBe(200);
    expect(converted.json().data.converted).toBe(2);

    const after = await app.inject({ method: 'GET', url: `/api/v1/notes/${noteId}` });
    expect(after.json().data.body).toBe(
      'The [[Aldous|old archivist]] knows. Ask [[Aldous]] about the key.',
    );
    // converted text is a wikilink now — no mentions remain
    const remaining = await app.inject({ method: 'GET', url: `/api/v1/entities/${id}/mentions` });
    expect(remaining.json().data).toHaveLength(0);
  });
});

describe('compiler knowledge bindings (F369/F609)', () => {
  it('story builds validate @entity references and fields against real entities', async () => {
    await createEntity({ type: 'character', name: 'Tobias' });
    const story = await post('/stories', { title: 'Knowledge Test' });
    const storyId = story.json().data.id;
    const files = await app.inject({ method: 'GET', url: `/api/v1/stories/${storyId}/files` });
    const fileId = files.json().data[0].id;

    const setSource = async (source: string) => {
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/stories/${storyId}/files/${fileId}`,
        payload: { source },
      });
      const build = await post(`/stories/${storyId}/build`, {});
      return build.json().data;
    };

    const unknownEntity = await setSource('@nobody waves.\n-> END\n');
    expect(unknownEntity.status).toBe('broken');
    expect(unknownEntity.diagnostics.some((d: { code: string }) => d.code === 'FORGE204')).toBe(
      true,
    );

    const unknownField = await setSource('{@Tobias.mana > 3: glows}\n-> END\n');
    expect(unknownField.status).toBe('broken');
    expect(unknownField.diagnostics.some((d: { code: string }) => d.code === 'FORGE309')).toBe(
      true,
    );

    const good = await setSource('@Tobias nods. {@Tobias.health > 0: He lives.}\n-> END\n');
    expect(good.status).toBe('valid');
  });
});
