/**
 * The player's VM host (F613/F621/F623 web halves). Wires the forge-vm host
 * hooks to the knowledge base:
 *
 * - `@entity` displays render through `markEntity` so the reader gets a
 *   tappable codex link, and fire an `encounter` event (met tracking, F613).
 * - `@entity.field` reads serve values from the entity snapshot fetched at
 *   session start, and fire `encounter` + `reveal` events — a field surfaced
 *   in prose is, by definition, no longer a spoiler (F616 web half).
 * - `[[Note Title]]` references render through `markLore` as tappable lore
 *   links (F621); resolution happens at tap time so deleted notes degrade to
 *   inert links (F625).
 * - `JOURNAL` / `ENTITY_SET` effects become journal / entity_set events for
 *   the dispatcher batch (F631/F634 plumbing).
 *
 * Everything is fire-and-forget into the dispatcher; the host never blocks
 * the VM and never throws for missing knowledge — reads on unknown entities
 * or fields throw inside the hook, which the VM converts into a story-visible
 * error value instead of crashing the run (VM F488).
 */
import { makeList } from '@fables/forge-vm';
import type { StoryHost, Value } from '@fables/forge-vm';
import type { EffectEvent } from './effects.js';
import { markEntity, markLore } from './tags.js';

/** The slice of an entity the player host needs, snapshotted at load. */
export interface EntitySnapshot {
  readonly id: string;
  readonly name: string;
  readonly fields: Record<string, unknown>;
}

/** Case-insensitive name/alias → entity index for host lookups (F605). */
export function buildEntityIndex(
  entities: readonly { id: string; name: string; aliases: string[]; fields: Record<string, unknown> }[],
): Map<string, EntitySnapshot> {
  const index = new Map<string, EntitySnapshot>();
  for (const entity of entities) {
    const snapshot: EntitySnapshot = { id: entity.id, name: entity.name, fields: entity.fields };
    for (const name of [entity.name, ...entity.aliases]) {
      const key = name.trim().toLowerCase();
      if (key !== '' && !index.has(key)) index.set(key, snapshot);
    }
  }
  return index;
}

/** Coerce a stored entity field into a story Value. */
export function toStoryValue(raw: unknown): Value {
  if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (Array.isArray(raw)) {
    return makeList(raw.filter(
      (v): v is number | string | boolean =>
        typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean',
    ));
  }
  throw new Error('field value is not representable in a story');
}

export interface PlayerHostOptions {
  entities: ReadonlyMap<string, EntitySnapshot>;
  onEvent: (event: EffectEvent) => void;
}

export function makePlayerHost({ entities, onEvent }: PlayerHostOptions): StoryHost {
  const lookup = (name: string): EntitySnapshot | undefined =>
    entities.get(name.trim().toLowerCase());

  return {
    resolveEntityDisplay(name, displayName) {
      const entity = lookup(name);
      if (entity === undefined) return displayName ?? name;
      onEvent({ type: 'encounter', payload: { entity: entity.id } });
      return markEntity(entity.name, displayName ?? entity.name);
    },

    readEntityField(name, field) {
      const entity = lookup(name);
      if (entity === undefined) throw new Error(`unknown entity "@${name}"`);
      if (field === undefined) throw new Error(`@${name} needs a field to be read`);
      if (!(field in entity.fields)) {
        throw new Error(`entity "${entity.name}" has no field "${field}"`);
      }
      const value = toStoryValue(entity.fields[field]);
      onEvent({ type: 'encounter', payload: { entity: entity.id } });
      onEvent({ type: 'reveal', payload: { entity: entity.id, field } });
      return value;
    },

    resolveNote(title) {
      return markLore(title);
    },

    onEffect(name, args) {
      if (name === 'JOURNAL') {
        const text = String(args[0] ?? '').trim();
        if (text !== '') onEvent({ type: 'journal', payload: { text } });
      } else if (name === 'ENTITY_SET') {
        const ref = String(args[0] ?? '');
        const field = String(args[1] ?? '');
        const entity = lookup(ref);
        if (entity === undefined || field === '') return;
        const raw = args[2];
        let value: unknown;
        if (typeof raw === 'object' && raw !== null && 'kind' in raw && raw.kind === 'list') {
          value = [...raw.items];
        } else if (
          typeof raw === 'number' ||
          typeof raw === 'string' ||
          typeof raw === 'boolean'
        ) {
          value = raw;
        } else {
          return; // diverts/errors are not persistable field values
        }
        // Keep the local snapshot live so later @entity.field reads in this
        // session see the mutation the server is about to apply.
        entity.fields[field] = value;
        onEvent({ type: 'entity_set', payload: { entity: entity.id, field, value } });
      }
    },
  };
}
