/**
 * Story portability route tests (F582–F584, F588, F589, F467).
 */

import { createStoryFromSource, type StorySaveState } from '@fables/forge-vm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { storiesRepo } from '../db/repos/stories.js';
import { unpackFableBin } from '../forge-export/pack.js';
import { extractEmbeddedProgram } from '../forge-export/html.js';
import { deserializeProgram, programFingerprint, compileStory } from '@fables/forge-vm';

let app: FastifyInstance;
let storyId: string;

const SOURCE = `-> crossroads

=== crossroads ===
The path splits.
+ Take the left fork.
  You went left.
  -> crossroads
+ Take the right fork.
  You went right.
  -> END
`;

function vmState(turns: number): StorySaveState {
  const story = createStoryFromSource(SOURCE, { seed: 11 });
  story.continue();
  for (let i = 0; i < turns; i++) {
    story.choose(0);
    story.continue();
  }
  return story.saveState();
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/stories',
    payload: { title: 'Portable Tale' },
  });
  storyId = created.json().data.id;
  // Replace the entry file source so its knots match our save states.
  const repo = storiesRepo(app.db);
  const story = repo.get(storyId as never)!;
  repo.setFileSources(story.id, new Map([[story.entryFile, SOURCE]]));
});

afterAll(async () => {
  await app.close();
});

describe('.fable.bin export/import (F582/F584/F589)', () => {
  it('exports a valid .fable.bin that round-trips to the same program', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/stories/${storyId}/export.bin` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');

    const bytes = new Uint8Array(res.rawPayload);
    const unpacked = unpackFableBin(bytes);
    // F589: the embedded program is identical to a direct compile of the source.
    const direct = programFingerprint(deserializeProgram(compileStory(SOURCE)));
    expect(unpacked.fingerprint).toBe(direct);
  });

  it('validates an uploaded .fable.bin', async () => {
    const exported = await app.inject({
      method: 'GET',
      url: `/api/v1/stories/${storyId}/export.bin`,
    });
    const base64 = Buffer.from(exported.rawPayload).toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stories/import/bin',
      payload: { data: base64 },
    });
    expect((res.json() as { data: { ok: boolean } }).data.ok).toBe(true);
  });

  it('rejects a corrupt .fable.bin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/stories/import/bin',
      payload: { data: Buffer.from('not a fable bin at all').toString('base64') },
    });
    expect((res.json() as { data: { ok: boolean } }).data.ok).toBe(false);
  });
});

describe('self-contained HTML (F583/F589)', () => {
  it('embeds the identical program in a single HTML file', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/stories/${storyId}/export.html` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('application/fable-bytecode');

    const program = deserializeProgram(extractEmbeddedProgram(res.body));
    const direct = programFingerprint(deserializeProgram(compileStory(SOURCE)));
    expect(programFingerprint(program)).toBe(direct);
  });
});

describe('QR code (F588)', () => {
  it('returns an SVG QR for the story URL', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/stories/${storyId}/qr` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
  });
});

describe('save-slot metadata (F467)', () => {
  it('reports scene name, turn and a progress fraction per slot', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/stories/${storyId}/saves`,
      payload: { name: 'midway', state: vmState(2) },
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/stories/${storyId}/save-slots` });
    const data = (
      res.json() as {
        data: {
          totalKnots: number;
          slots: { sceneName: string; turn: number; progress: number | null; status: string }[];
        };
      }
    ).data;
    expect(data.totalKnots).toBeGreaterThan(0);
    const slot = data.slots.find((s) => s.sceneName === 'crossroads');
    expect(slot).toBeDefined();
    expect(slot?.turn).toBe(2);
    expect(slot?.progress === null || (slot!.progress >= 0 && slot!.progress <= 1)).toBe(true);
  });
});
