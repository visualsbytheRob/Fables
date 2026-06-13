import { type StoryId } from '@fables/core';
import { withTransaction, type Db } from '../db/connection.js';
import { playthroughsRepo, type BindingMode, type Playthrough } from '../db/repos/playthroughs.js';
import { storiesRepo } from '../db/repos/stories.js';
import { computeKnowledgeState } from './knowledge.js';

/**
 * Playthrough lifecycle (F644/F686). Creating a snapshot-mode playthrough
 * freezes the current knowledge state onto the playthrough row so live edits
 * never change what the player evaluates against (F644). Sandbox playthroughs
 * route entity writes into an overlay instead of the live world (F686).
 */

export function startPlaythrough(
  db: Db,
  storyId: StoryId,
  input: { id: string; mode?: BindingMode; sandbox?: boolean },
): Playthrough {
  return withTransaction(db, () => {
    storiesRepo(db).mustGet(storyId);
    const mode = input.mode ?? 'live';
    // Snapshot mode freezes the knowledge payload at start (F644).
    const snapshot =
      mode === 'snapshot'
        ? (computeKnowledgeState(db, storyId, input.id) as unknown as Record<string, unknown>)
        : null;
    return playthroughsRepo(db).create({
      storyId,
      id: input.id,
      mode,
      sandbox: input.sandbox ?? false,
      snapshot,
    });
  });
}

export function finishPlaythrough(db: Db, storyId: StoryId, id: string): Playthrough {
  return withTransaction(db, () => playthroughsRepo(db).finish(storyId, id));
}
