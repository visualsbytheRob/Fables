import {
  conflict,
  newSceneId,
  newStoryId,
  notFound,
  nowIso,
  type SceneId,
  type StoryId,
  type StoryStatus,
} from '@fables/core';
import type { BuildOutcome, StoredDiagnostic } from '../../stories/build.js';
import type { Db } from '../connection.js';

/**
 * Story projects (F501–F508): the `stories` row plus its `scenes` (.fable
 * files), build results, and named releases. All SQL for those tables lives
 * here.
 */

export type SeedMode = 'fixed' | 'random';

/** Cover + player presentation settings, persisted as JSON (F501/F507). */
export interface StorySettings {
  cover: { color: string | null; emoji: string | null };
  theme: string | null;
  seedMode: SeedMode;
  /** Seed used when seedMode is 'fixed'. */
  seed: number;
}

export const DEFAULT_SETTINGS: StorySettings = {
  cover: { color: null, emoji: null },
  theme: null,
  seedMode: 'random',
  seed: 1,
};

/** Partial settings update — absent fields keep their current value. */
export interface StorySettingsPatch {
  cover?: { color?: string | null | undefined; emoji?: string | null | undefined } | undefined;
  theme?: string | null | undefined;
  seedMode?: SeedMode | undefined;
  seed?: number | undefined;
}

export function mergeSettings(base: StorySettings, patch: StorySettingsPatch = {}): StorySettings {
  return {
    cover: {
      color: patch.cover?.color !== undefined ? patch.cover.color : base.cover.color,
      emoji: patch.cover?.emoji !== undefined ? patch.cover.emoji : base.cover.emoji,
    },
    theme: patch.theme !== undefined ? patch.theme : base.theme,
    seedMode: patch.seedMode ?? base.seedMode,
    seed: patch.seed ?? base.seed,
  };
}

export interface StoryRecord {
  id: StoryId;
  title: string;
  description: string;
  entryFile: string;
  status: StoryStatus;
  settings: StorySettings;
  isTemplate: boolean;
  errorCount: number;
  warningCount: number;
  builtAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryFile {
  id: SceneId;
  storyId: StoryId;
  path: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryRelease {
  id: string;
  storyId: StoryId;
  name: string;
  status: 'valid' | 'broken';
  entryFile: string;
  settings: StorySettings;
  /** Source snapshot: project path → .fable source. */
  files: Record<string, string>;
  createdAt: string;
}

interface StoryRow {
  id: string;
  title: string;
  description: string;
  entry_file: string;
  status: string;
  settings: string;
  diagnostics: string;
  error_count: number;
  warning_count: number;
  built_at: string | null;
  is_template: number;
  created_at: string;
  updated_at: string;
}

interface SceneRow {
  id: string;
  story_id: string;
  path: string;
  source: string;
  created_at: string;
  updated_at: string;
}

interface ReleaseRow {
  id: string;
  story_id: string;
  name: string;
  status: string;
  entry_file: string;
  settings: string;
  files: string;
  created_at: string;
}

function parseSettings(raw: string): StorySettings {
  const parsed = JSON.parse(raw) as Partial<StorySettings>;
  return {
    cover: {
      color: parsed.cover?.color ?? null,
      emoji: parsed.cover?.emoji ?? null,
    },
    theme: parsed.theme ?? null,
    seedMode: parsed.seedMode ?? DEFAULT_SETTINGS.seedMode,
    seed: parsed.seed ?? DEFAULT_SETTINGS.seed,
  };
}

function toStory(row: StoryRow): StoryRecord {
  return {
    id: row.id as StoryId,
    title: row.title,
    description: row.description,
    entryFile: row.entry_file,
    status: row.status as StoryStatus,
    settings: parseSettings(row.settings),
    isTemplate: row.is_template === 1,
    errorCount: row.error_count,
    warningCount: row.warning_count,
    builtAt: row.built_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFile(row: SceneRow): StoryFile {
  return {
    id: row.id as SceneId,
    storyId: row.story_id as StoryId,
    path: row.path,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRelease(row: ReleaseRow): StoryRelease {
  return {
    id: row.id,
    storyId: row.story_id as StoryId,
    name: row.name,
    status: row.status as 'valid' | 'broken',
    entryFile: row.entry_file,
    settings: parseSettings(row.settings),
    files: JSON.parse(row.files) as Record<string, string>,
    createdAt: row.created_at,
  };
}

export function storiesRepo(db: Db) {
  return {
    create(input: {
      title: string;
      description?: string | undefined;
      entryFile?: string | undefined;
      settings?: StorySettingsPatch | undefined;
      isTemplate?: boolean | undefined;
    }): StoryRecord {
      const now = nowIso();
      const id = newStoryId();
      const settings = mergeSettings(DEFAULT_SETTINGS, input.settings);
      db.prepare(
        `INSERT INTO stories (id, title, description, entry_file, status, settings, is_template, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      ).run(
        id,
        input.title,
        input.description ?? '',
        input.entryFile ?? 'main.fable',
        JSON.stringify(settings),
        input.isTemplate === true ? 1 : 0,
        now,
        now,
      );
      return this.get(id) as StoryRecord;
    },

    get(id: StoryId): StoryRecord | null {
      const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(id) as StoryRow | undefined;
      return row ? toStory(row) : null;
    },

    mustGet(id: StoryId): StoryRecord {
      const story = this.get(id);
      if (!story) throw notFound('Story', id);
      return story;
    },

    /** Cursor pagination by id (ULIDs sort by creation order). */
    list(opts: { limit: number; cursor: string | null; template?: boolean }): StoryRecord[] {
      const clauses: string[] = [];
      const args: unknown[] = [];
      if (opts.cursor !== null) {
        clauses.push('id > ?');
        args.push(opts.cursor);
      }
      if (opts.template !== undefined) {
        clauses.push('is_template = ?');
        args.push(opts.template ? 1 : 0);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(`SELECT * FROM stories ${where} ORDER BY id LIMIT ?`)
        .all(...args, opts.limit + 1) as StoryRow[];
      return rows.map(toStory);
    },

    update(
      id: StoryId,
      patch: Partial<
        Pick<StoryRecord, 'title' | 'description' | 'entryFile' | 'settings' | 'isTemplate'>
      >,
    ): StoryRecord {
      const current = this.mustGet(id);
      const next = { ...current, ...patch, updatedAt: nowIso() };
      db.prepare(
        `UPDATE stories SET title = ?, description = ?, entry_file = ?, settings = ?, is_template = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        next.title,
        next.description,
        next.entryFile,
        JSON.stringify(next.settings),
        next.isTemplate ? 1 : 0,
        next.updatedAt,
        id,
      );
      return next;
    },

    /** Persist a compile outcome (F504/F505). Does not bump updated_at. */
    setBuild(id: StoryId, outcome: BuildOutcome): void {
      const changed = db
        .prepare(
          `UPDATE stories SET status = ?, diagnostics = ?, error_count = ?, warning_count = ?, built_at = ?
           WHERE id = ?`,
        )
        .run(
          outcome.status,
          JSON.stringify(outcome.diagnostics),
          outcome.errorCount,
          outcome.warningCount,
          nowIso(),
          id,
        ).changes;
      if (changed === 0) throw notFound('Story', id);
    },

    diagnostics(id: StoryId): StoredDiagnostic[] {
      const row = db.prepare('SELECT diagnostics FROM stories WHERE id = ?').get(id) as
        | { diagnostics: string }
        | undefined;
      if (!row) throw notFound('Story', id);
      return JSON.parse(row.diagnostics) as StoredDiagnostic[];
    },

    /** Scenes/releases/saves cascade via foreign keys. */
    remove(id: StoryId): { deletedFiles: number; deletedSaves: number; deletedReleases: number } {
      this.mustGet(id);
      const count = (table: string): number =>
        (
          db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE story_id = ?`).get(id) as {
            n: number;
          }
        ).n;
      const result = {
        deletedFiles: count('scenes'),
        deletedSaves: count('story_saves'),
        deletedReleases: count('story_releases'),
      };
      db.prepare('DELETE FROM stories WHERE id = ?').run(id);
      return result;
    },

    // ── files (scenes) ──────────────────────────────────────────────────────

    listFiles(storyId: StoryId): StoryFile[] {
      const rows = db
        .prepare('SELECT * FROM scenes WHERE story_id = ? ORDER BY path')
        .all(storyId) as SceneRow[];
      return rows.map(toFile);
    },

    /** `path → source` map the compiler's FileProvider feeds on. */
    fileMap(storyId: StoryId): Map<string, string> {
      return new Map(this.listFiles(storyId).map((f) => [f.path, f.source]));
    },

    getFile(storyId: StoryId, fileId: SceneId): StoryFile | null {
      const row = db
        .prepare('SELECT * FROM scenes WHERE story_id = ? AND id = ?')
        .get(storyId, fileId) as SceneRow | undefined;
      return row ? toFile(row) : null;
    },

    getFileByPath(storyId: StoryId, path: string): StoryFile | null {
      const row = db
        .prepare('SELECT * FROM scenes WHERE story_id = ? AND path = ?')
        .get(storyId, path) as SceneRow | undefined;
      return row ? toFile(row) : null;
    },

    createFile(storyId: StoryId, path: string, source: string): StoryFile {
      if (this.getFileByPath(storyId, path)) {
        throw conflict(`a file already exists at "${path}"`, { path });
      }
      const now = nowIso();
      const id = newSceneId();
      db.prepare(
        `INSERT INTO scenes (id, story_id, path, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, storyId, path, source, now, now);
      return this.getFile(storyId, id) as StoryFile;
    },

    updateFile(
      storyId: StoryId,
      fileId: SceneId,
      patch: { path?: string; source?: string },
    ): StoryFile {
      const current = this.getFile(storyId, fileId);
      if (!current) throw notFound('Story file', fileId);
      if (patch.path !== undefined && patch.path !== current.path) {
        if (this.getFileByPath(storyId, patch.path)) {
          throw conflict(`a file already exists at "${patch.path}"`, { path: patch.path });
        }
      }
      const next = {
        ...current,
        path: patch.path ?? current.path,
        source: patch.source ?? current.source,
        updatedAt: nowIso(),
      };
      db.prepare('UPDATE scenes SET path = ?, source = ?, updated_at = ? WHERE id = ?').run(
        next.path,
        next.source,
        next.updatedAt,
        fileId,
      );
      return next;
    },

    /** Bulk source rewrite used by rename include-integrity (F503). */
    setFileSources(storyId: StoryId, sources: ReadonlyMap<string, string>): void {
      const stmt = db.prepare(
        'UPDATE scenes SET source = ?, updated_at = ? WHERE story_id = ? AND path = ?',
      );
      const now = nowIso();
      for (const [path, source] of sources) stmt.run(source, now, storyId, path);
    },

    deleteFile(storyId: StoryId, fileId: SceneId): StoryFile {
      const current = this.getFile(storyId, fileId);
      if (!current) throw notFound('Story file', fileId);
      db.prepare('DELETE FROM scenes WHERE id = ?').run(fileId);
      return current;
    },

    // ── releases (F506) ─────────────────────────────────────────────────────

    createRelease(
      storyId: StoryId,
      input: {
        name: string;
        status: 'valid' | 'broken';
        entryFile: string;
        settings: StorySettings;
        files: Record<string, string>;
      },
    ): StoryRelease {
      if (this.getReleaseByName(storyId, input.name)) {
        throw conflict(`a release named "${input.name}" already exists`, { name: input.name });
      }
      const id = `rel_${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO story_releases (id, story_id, name, status, entry_file, settings, files, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        storyId,
        input.name,
        input.status,
        input.entryFile,
        JSON.stringify(input.settings),
        JSON.stringify(input.files),
        nowIso(),
      );
      return this.getRelease(storyId, id) as StoryRelease;
    },

    listReleases(storyId: StoryId): StoryRelease[] {
      const rows = db
        .prepare(
          'SELECT * FROM story_releases WHERE story_id = ? ORDER BY created_at DESC, rowid DESC',
        )
        .all(storyId) as ReleaseRow[];
      return rows.map(toRelease);
    },

    getRelease(storyId: StoryId, releaseId: string): StoryRelease | null {
      const row = db
        .prepare('SELECT * FROM story_releases WHERE story_id = ? AND id = ?')
        .get(storyId, releaseId) as ReleaseRow | undefined;
      return row ? toRelease(row) : null;
    },

    getReleaseByName(storyId: StoryId, name: string): StoryRelease | null {
      const row = db
        .prepare('SELECT * FROM story_releases WHERE story_id = ? AND name = ?')
        .get(storyId, name) as ReleaseRow | undefined;
      return row ? toRelease(row) : null;
    },
  };
}

export type StoriesRepo = ReturnType<typeof storiesRepo>;
