/**
 * Automation rule route tests (Epic 20, F1911–F1918).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';

let app: FastifyInstance;
let notebookId: string;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'fatal' }));
  notebookId = notebooksRepo(app.db).create({ name: 'Inbox' }).id;
});

afterAll(async () => {
  await app.close();
});

async function createRule(payload: object): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/automation/rules', payload });
  return (res.json() as { data: { id: string } }).data.id;
}

describe('automation rules (F1911/F1912/F1914/F1915)', () => {
  it('dry-runs without changing the note, then applies', async () => {
    const note = notesRepo(app.db).create({
      notebookId: notebookId as never,
      title: 'Project meeting recap',
      body: 'notes',
    });
    const ruleId = await createRule({
      name: 'Tag meetings',
      trigger: 'note.created',
      conditions: [{ field: 'title', op: 'contains', value: 'meeting' }],
      actions: [{ type: 'addTag', tag: 'meeting' }],
    });

    // Dry run: reports it would fire + the diff, but doesn't change tags.
    const dry = await app.inject({
      method: 'POST',
      url: `/api/v1/automation/rules/${ruleId}/run`,
      payload: { noteId: note.id, dryRun: true },
    });
    const dryData = (
      dry.json() as { data: { fired: boolean; diff: { tags?: { added: string[] } } } }
    ).data;
    expect(dryData.fired).toBe(true);
    expect(dryData.diff.tags?.added).toContain('meeting');

    // Real run: applies the tag.
    const real = await app.inject({
      method: 'POST',
      url: `/api/v1/automation/rules/${ruleId}/run`,
      payload: { noteId: note.id },
    });
    expect((real.json() as { data: { fired: boolean } }).data.fired).toBe(true);

    // Run history records both.
    const runs = await app.inject({
      method: 'GET',
      url: `/api/v1/automation/rules/${ruleId}/runs`,
    });
    expect((runs.json() as { data: { runs: unknown[] } }).data.runs.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('does not fire when conditions fail', async () => {
    const note = notesRepo(app.db).create({
      notebookId: notebookId as never,
      title: 'Grocery list',
      body: 'x',
    });
    const ruleId = await createRule({
      name: 'Tag meetings only',
      trigger: 'note.created',
      conditions: [{ field: 'title', op: 'contains', value: 'meeting' }],
      actions: [{ type: 'addTag', tag: 'meeting' }],
    });
    const run = await app.inject({
      method: 'POST',
      url: `/api/v1/automation/rules/${ruleId}/run`,
      payload: { noteId: note.id },
    });
    expect((run.json() as { data: { fired: boolean } }).data.fired).toBe(false);
  });

  it('serves rule templates', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/automation/templates' });
    expect(
      (res.json() as { data: { templates: unknown[] } }).data.templates.length,
    ).toBeGreaterThan(0);
  });
});
