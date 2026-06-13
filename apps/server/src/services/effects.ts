import {
  AppError,
  dayKey,
  notFound,
  validation,
  type Entity,
  type EntityId,
  type NoteId,
  type StoryId,
} from '@fables/core';
import { withTransaction, type Db } from '../db/connection.js';
import { codexRepo } from '../db/repos/codex.js';
import { entitiesRepo } from '../db/repos/entities.js';
import { notebooksRepo } from '../db/repos/notebooks.js';
import { notesRepo } from '../db/repos/notes.js';
import { playthroughsRepo } from '../db/repos/playthroughs.js';
import { storiesRepo, type StoryRecord } from '../db/repos/stories.js';
import { worldRepo } from '../db/repos/world.js';
import { recordEncounter, recordReveal } from './codex.js';
import { validateFieldValue } from './entities.js';
import { applyServerEdit, createNote } from './notes.js';
import { canWrite, storyDeclarations } from './permissions.js';

/**
 * VM host-effect ingestion (F631–F640). The player (web lane) runs the VM and
 * batches its journal/entity_set/encounter/reveal host effects into one POST.
 *
 * - Atomic: any invalid event rolls back the whole batch.
 * - Idempotent: a replayed `idempotencyKey` returns the stored result without
 *   re-applying anything (F638).
 * - Private: stories with settings.journalOptOut reject journal events with
 *   FORBIDDEN (F639).
 * - Audited: every applied event lands in `effect_events` (F640).
 */

export const JOURNAL_NOTEBOOK = 'Journal';

export type EffectEventInput =
  | { type: 'journal'; payload: { text: string; scene?: string; choice?: string } }
  | { type: 'entity_set'; payload: { entity: string; field: string; value: unknown } }
  | { type: 'encounter'; payload: { entity: string } }
  | { type: 'reveal'; payload: { entity: string; field: string } };

export interface EffectBatchInput {
  playthroughId: string;
  idempotencyKey: string;
  events: EffectEventInput[];
}

export interface EffectBatchResult {
  storyId: StoryId;
  playthroughId: string;
  idempotencyKey: string;
  /** True when this key was seen before: nothing was re-applied. */
  replayed: boolean;
  applied: number;
  results: Record<string, unknown>[];
}

/** Resolve an effect's entity reference: `ent_…` id, or name/alias lookup. */
function resolveEntity(db: Db, ref: string): Entity {
  const repo = entitiesRepo(db);
  const entity = ref.startsWith('ent_') ? repo.get(ref as EntityId) : repo.getByName(ref);
  if (!entity) throw notFound('Entity', ref);
  return entity;
}

/** Find-or-create the Journal notebook, then today's daily note inside it. */
function ensureDailyNote(db: Db, key: string): { id: NoteId } {
  const notebooks = notebooksRepo(db);
  const journal =
    notebooks.list({ includeArchived: true }).find((n) => n.name === JOURNAL_NOTEBOOK) ??
    notebooks.create({ name: JOURNAL_NOTEBOOK });
  const existing = notesRepo(db).findLiveByTitle(journal.id, key);
  if (existing) return existing;
  return createNote(db, { notebookId: journal.id, title: key, body: `# ${key}\n` });
}

/** One journal bullet (F632): timestamp, story link, scene, text, chosen text. */
function journalLine(
  story: StoryRecord,
  payload: { text: string; scene?: string; choice?: string },
  at: Date,
): string {
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  const scene = payload.scene !== undefined && payload.scene !== '' ? ` · ${payload.scene}` : '';
  const choice =
    payload.choice !== undefined && payload.choice !== '' ? ` (chose: "${payload.choice}")` : '';
  return `- **${hh}:${mm}** [${story.title}](/stories/${story.id})${scene} — ${payload.text}${choice}`;
}

export function ingestEffects(
  db: Db,
  storyId: StoryId,
  input: EffectBatchInput,
): EffectBatchResult {
  const story = storiesRepo(db).mustGet(storyId);

  // Idempotency (F638): a known key replays the stored outcome verbatim.
  const stored = codexRepo(db).getBatchResult(storyId, input.idempotencyKey);
  if (stored !== null) {
    return { ...(stored as unknown as EffectBatchResult), replayed: true };
  }

  const journalEvents = input.events.filter((e) => e.type === 'journal');
  if (journalEvents.length > 0 && story.settings.journalOptOut) {
    throw new AppError('FORBIDDEN', 'this story may not write to the journal', {
      details: { storyId, setting: 'journalOptOut' },
    });
  }

  // Permission model (F648) + sandbox routing (F686) are resolved once per batch.
  const declarations = storyDeclarations(db, storyId);
  const sandbox = playthroughsRepo(db).get(storyId, input.playthroughId)?.sandbox === true;

  return withTransaction(db, () => {
    const codex = codexRepo(db);
    const world = worldRepo(db);
    const results: Record<string, unknown>[] = [];

    // Journal events batch into a single daily-note edit (F638): one rev bump
    // per ingested batch, however chatty the story was.
    const journalLines: string[] = [];
    const now = new Date();
    const key = dayKey(now);

    for (const event of input.events) {
      switch (event.type) {
        case 'journal': {
          if (event.payload.text.trim() === '') {
            throw validation('journal event text must not be empty', { type: 'journal' });
          }
          journalLines.push(journalLine(story, event.payload, now));
          results.push({ type: 'journal', dayKey: key });
          break;
        }
        case 'entity_set': {
          const entity = resolveEntity(db, event.payload.entity);
          // Permission gate (F648): writes to undeclared entities are FORBIDDEN.
          if (!canWrite(declarations, entity)) {
            throw new AppError(
              'FORBIDDEN',
              `this story may not write to entity "${entity.name}"`,
              { details: { storyId, entityId: entity.id, field: event.payload.field } },
            );
          }
          validateFieldValue(db, entity, event.payload.field, event.payload.value);
          if (sandbox) {
            // Sandbox writes land in the per-playthrough overlay, not the world (F686).
            const oldValue =
              world.sandboxFields(storyId, input.playthroughId, entity.id)[event.payload.field] ??
              entity.fields[event.payload.field] ??
              null;
            world.setSandboxField(
              storyId,
              input.playthroughId,
              entity.id,
              event.payload.field,
              event.payload.value,
            );
            codex.recordMutation({
              storyId,
              playthroughId: input.playthroughId,
              entityId: entity.id,
              field: event.payload.field,
              oldValue,
              newValue: event.payload.value,
              sandbox: true,
            });
            results.push({
              type: 'entity_set',
              entityId: entity.id,
              field: event.payload.field,
              oldValue,
              newValue: event.payload.value,
              sandbox: true,
            });
            break;
          }
          const oldValue = entity.fields[event.payload.field] ?? null;
          entitiesRepo(db).update(entity.id, {
            fields: { ...entity.fields, [event.payload.field]: event.payload.value },
          });
          codex.recordMutation({
            storyId,
            playthroughId: input.playthroughId,
            entityId: entity.id,
            field: event.payload.field,
            oldValue,
            newValue: event.payload.value,
          });
          results.push({
            type: 'entity_set',
            entityId: entity.id,
            field: event.payload.field,
            oldValue,
            newValue: event.payload.value,
          });
          break;
        }
        case 'encounter': {
          const entity = resolveEntity(db, event.payload.entity);
          const outcome = recordEncounter(db, storyId, input.playthroughId, entity.id);
          results.push({
            type: 'encounter',
            entityId: entity.id,
            entryId: outcome.entryId,
            encounters: outcome.encounters,
          });
          break;
        }
        case 'reveal': {
          const entity = resolveEntity(db, event.payload.entity);
          const outcome = recordReveal(
            db,
            storyId,
            input.playthroughId,
            entity.id,
            event.payload.field,
          );
          results.push({
            type: 'reveal',
            entityId: entity.id,
            entryId: outcome.entryId,
            field: outcome.field,
            revealed: outcome.revealed,
          });
          break;
        }
      }
      codex.recordEffectEvent({
        storyId,
        playthroughId: input.playthroughId,
        batchKey: input.idempotencyKey,
        type: event.type,
        payload: event.payload as Record<string, unknown>,
      });
    }

    let journalNoteId: NoteId | null = null;
    if (journalLines.length > 0) {
      const daily = ensureDailyNote(db, key);
      const current = notesRepo(db).get(daily.id)!;
      const separator = current.body.endsWith('\n') ? '' : '\n';
      applyServerEdit(db, daily.id, {
        body: `${current.body}${separator}${journalLines.join('\n')}\n`,
      });
      journalNoteId = daily.id;
      for (const r of results) {
        if (r['type'] === 'journal') r['noteId'] = journalNoteId;
      }
    }

    const result: EffectBatchResult = {
      storyId,
      playthroughId: input.playthroughId,
      idempotencyKey: input.idempotencyKey,
      replayed: false,
      applied: input.events.length,
      results,
    };
    codex.saveBatchResult(
      storyId,
      input.playthroughId,
      input.idempotencyKey,
      result as unknown as Record<string, unknown>,
    );
    return result;
  });
}
