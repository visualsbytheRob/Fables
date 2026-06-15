/**
 * Workspace profiles repository (Epic 20, F1971–F1978).
 *
 * Named UI states with per-device defaults (F1978) and round-trip export/import
 * (F1977). The state itself is an opaque JSON blob — open panes, filters, theme,
 * focus mode, notification rules — that the web app interprets. At most one
 * profile is the default for a given device scope; `setDefault` keeps that
 * invariant.
 */

import { nowIso } from '@fables/core';
import type { Db } from '../connection.js';

export interface Profile {
  id: string;
  name: string;
  state: Record<string, unknown>;
  device: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProfileRow {
  id: string;
  name: string;
  state: string;
  device: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

function parseState(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const toProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  name: r.name,
  state: parseState(r.state),
  device: r.device,
  isDefault: r.is_default === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface ProfileInput {
  name: string;
  state?: Record<string, unknown>;
  device?: string | null;
}

export interface ProfileExport {
  name: string;
  state: Record<string, unknown>;
}

export function profilesRepo(db: Db) {
  const repo = {
    create(input: ProfileInput): Profile {
      const now = nowIso();
      const profile: Profile = {
        id: `wsp_${crypto.randomUUID()}`,
        name: input.name,
        state: input.state ?? {},
        device: input.device ?? null,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO workspace_profiles (id, name, state, device, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ).run(profile.id, profile.name, JSON.stringify(profile.state), profile.device, now, now);
      return profile;
    },

    get(id: string): Profile | null {
      const row = db.prepare('SELECT * FROM workspace_profiles WHERE id = ?').get(id) as
        | ProfileRow
        | undefined;
      return row ? toProfile(row) : null;
    },

    list(): Profile[] {
      return (
        db.prepare('SELECT * FROM workspace_profiles ORDER BY name').all() as ProfileRow[]
      ).map(toProfile);
    },

    update(
      id: string,
      patch: {
        name?: string | undefined;
        state?: Record<string, unknown> | undefined;
        device?: string | null | undefined;
      },
    ): Profile | null {
      const cur = this.get(id);
      if (!cur) return null;
      const next: Profile = {
        ...cur,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        ...(patch.device !== undefined ? { device: patch.device } : {}),
        updatedAt: nowIso(),
      };
      db.prepare(
        'UPDATE workspace_profiles SET name = ?, state = ?, device = ?, updated_at = ? WHERE id = ?',
      ).run(next.name, JSON.stringify(next.state), next.device, next.updatedAt, id);
      return next;
    },

    remove(id: string): boolean {
      return db.prepare('DELETE FROM workspace_profiles WHERE id = ?').run(id).changes > 0;
    },

    /** Make a profile the default for its device scope (F1978). */
    setDefault(id: string): Profile | null {
      const target = this.get(id);
      if (!target) return null;
      const now = nowIso();
      const tx = db.transaction(() => {
        // Clear the current default for the same device scope.
        if (target.device === null) {
          db.prepare(
            'UPDATE workspace_profiles SET is_default = 0, updated_at = ? WHERE is_default = 1 AND device IS NULL',
          ).run(now);
        } else {
          db.prepare(
            'UPDATE workspace_profiles SET is_default = 0, updated_at = ? WHERE is_default = 1 AND device = ?',
          ).run(now, target.device);
        }
        db.prepare('UPDATE workspace_profiles SET is_default = 1, updated_at = ? WHERE id = ?').run(
          now,
          id,
        );
      });
      tx();
      return this.get(id);
    },

    /** The default profile for a device, falling back to the global default. */
    getDefault(device?: string): Profile | null {
      if (device !== undefined) {
        const row = db
          .prepare('SELECT * FROM workspace_profiles WHERE is_default = 1 AND device = ?')
          .get(device) as ProfileRow | undefined;
        if (row) return toProfile(row);
      }
      const global = db
        .prepare('SELECT * FROM workspace_profiles WHERE is_default = 1 AND device IS NULL')
        .get() as ProfileRow | undefined;
      return global ? toProfile(global) : null;
    },

    /** Export a profile as a portable {name, state} object (F1977). */
    exportProfile(id: string): ProfileExport | null {
      const profile = this.get(id);
      if (!profile) return null;
      return { name: profile.name, state: profile.state };
    },

    /** Import a profile from a portable object, creating a new entry (F1977). */
    importProfile(data: ProfileExport): Profile {
      return this.create({ name: data.name, state: data.state });
    },
  };

  return repo;
}

export type ProfilesRepo = ReturnType<typeof profilesRepo>;
