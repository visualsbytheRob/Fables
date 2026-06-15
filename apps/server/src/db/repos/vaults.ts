/**
 * Vault registry repository (Epic 20, F1901–F1909).
 *
 * Tracks the set of named vaults and which one is active. Each vault has its own
 * data dir, isolated settings (F1903), an independent encryption state (F1907),
 * an opt-in cross-vault-search flag (F1904) and an archive/cold-storage flag
 * (F1908). Exactly one vault is active; the partial unique index guards it and
 * the repo keeps the invariant when switching.
 */

import { conflict, nowIso, validation } from '@fables/core';
import type { Db } from '../connection.js';
import { DEFAULT_TEMPLATE, getTemplate, isTemplateId } from '../../vaults/templates.js';

export type EncryptionState = 'none' | 'locked' | 'unlocked';

export interface Vault {
  id: string;
  name: string;
  slug: string;
  dataDir: string;
  template: string;
  encryption: EncryptionState;
  federated: boolean;
  archived: boolean;
  active: boolean;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface VaultRow {
  id: string;
  name: string;
  slug: string;
  data_dir: string;
  template: string;
  encryption: string;
  federated: number;
  archived: number;
  is_active: number;
  settings: string;
  created_at: string;
  updated_at: string;
}

function parseSettings(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const toVault = (r: VaultRow): Vault => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  dataDir: r.data_dir,
  template: r.template,
  encryption: r.encryption as EncryptionState,
  federated: r.federated === 1,
  archived: r.archived === 1,
  active: r.is_active === 1,
  settings: parseSettings(r.settings),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Lowercase, hyphenated, ascii slug. Falls back to 'vault' when empty. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'vault';
}

export interface VaultInput {
  name: string;
  dataDir?: string;
  template?: string;
  federated?: boolean;
  settings?: Record<string, unknown>;
}

export function vaultsRepo(db: Db) {
  const repo = {
    /**
     * Register a vault. The first vault registered becomes active. The slug is
     * derived from the name and must be unique; a template seeds default
     * settings (F1903/F1906). `dataDir` defaults to the slug when omitted — the
     * caller (route) supplies an absolute path.
     */
    register(input: VaultInput): Vault {
      const name = input.name.trim();
      if (!name) throw validation('vault name is required');
      const slug = slugify(name);
      if (this.getBySlug(slug)) throw conflict(`vault "${slug}" already exists`);

      const templateId = input.template ?? DEFAULT_TEMPLATE;
      if (!isTemplateId(templateId)) throw validation(`unknown vault template: ${templateId}`);
      const template = getTemplate(templateId)!;

      const now = nowIso();
      const first = this.list({ includeArchived: true }).length === 0;
      const settings = { ...template.settings, ...(input.settings ?? {}) };
      const vault: Vault = {
        id: `vlt_${crypto.randomUUID()}`,
        name,
        slug,
        dataDir: input.dataDir ?? slug,
        template: templateId,
        encryption: 'none',
        federated: input.federated ?? false,
        archived: false,
        active: first,
        settings,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO vaults (id, name, slug, data_dir, template, encryption, federated, archived, is_active, settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'none', ?, 0, ?, ?, ?, ?)`,
      ).run(
        vault.id,
        vault.name,
        vault.slug,
        vault.dataDir,
        vault.template,
        vault.federated ? 1 : 0,
        vault.active ? 1 : 0,
        JSON.stringify(vault.settings),
        now,
        now,
      );
      return vault;
    },

    get(id: string): Vault | null {
      const row = db.prepare('SELECT * FROM vaults WHERE id = ?').get(id) as VaultRow | undefined;
      return row ? toVault(row) : null;
    },

    getBySlug(slug: string): Vault | null {
      const row = db.prepare('SELECT * FROM vaults WHERE slug = ?').get(slug) as
        | VaultRow
        | undefined;
      return row ? toVault(row) : null;
    },

    list(opts: { includeArchived?: boolean } = {}): Vault[] {
      const sql = opts.includeArchived
        ? 'SELECT * FROM vaults ORDER BY name'
        : 'SELECT * FROM vaults WHERE archived = 0 ORDER BY name';
      return (db.prepare(sql).all() as VaultRow[]).map(toVault);
    },

    getActive(): Vault | null {
      const row = db.prepare('SELECT * FROM vaults WHERE is_active = 1').get() as
        | VaultRow
        | undefined;
      return row ? toVault(row) : null;
    },

    update(
      id: string,
      patch: {
        name?: string | undefined;
        dataDir?: string | undefined;
        federated?: boolean | undefined;
      },
    ): Vault | null {
      const cur = this.get(id);
      if (!cur) return null;
      let slug = cur.slug;
      let name = cur.name;
      if (patch.name !== undefined) {
        name = patch.name.trim();
        if (!name) throw validation('vault name is required');
        slug = slugify(name);
        const clash = this.getBySlug(slug);
        if (clash && clash.id !== id) throw conflict(`vault "${slug}" already exists`);
      }
      const now = nowIso();
      db.prepare(
        'UPDATE vaults SET name = ?, slug = ?, data_dir = ?, federated = ?, updated_at = ? WHERE id = ?',
      ).run(
        name,
        slug,
        patch.dataDir ?? cur.dataDir,
        (patch.federated ?? cur.federated) ? 1 : 0,
        now,
        id,
      );
      return this.get(id);
    },

    /** Switch the active vault (F1902). Keeps exactly one active in one tx. */
    setActive(id: string): Vault | null {
      const target = this.get(id);
      if (!target) return null;
      if (target.archived) throw validation('cannot activate an archived vault');
      const now = nowIso();
      const tx = db.transaction(() => {
        db.prepare('UPDATE vaults SET is_active = 0, updated_at = ? WHERE is_active = 1').run(now);
        db.prepare('UPDATE vaults SET is_active = 1, updated_at = ? WHERE id = ?').run(now, id);
      });
      tx();
      return this.get(id);
    },

    /** Replace a vault's isolated settings (F1903). */
    setSettings(id: string, settings: Record<string, unknown>): Vault | null {
      if (!this.get(id)) return null;
      db.prepare('UPDATE vaults SET settings = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(settings),
        nowIso(),
        id,
      );
      return this.get(id);
    },

    /** Merge keys into a vault's settings (F1903). */
    patchSettings(id: string, patch: Record<string, unknown>): Vault | null {
      const cur = this.get(id);
      if (!cur) return null;
      return this.setSettings(id, { ...cur.settings, ...patch });
    },

    /** Track a vault's encryption state independently (F1907). */
    setEncryption(id: string, state: EncryptionState): Vault | null {
      if (!this.get(id)) return null;
      db.prepare('UPDATE vaults SET encryption = ?, updated_at = ? WHERE id = ?').run(
        state,
        nowIso(),
        id,
      );
      return this.get(id);
    },

    /** Move a vault to cold storage (F1908). The active vault can't be archived. */
    archive(id: string): Vault | null {
      const cur = this.get(id);
      if (!cur) return null;
      if (cur.active) throw validation('cannot archive the active vault');
      db.prepare('UPDATE vaults SET archived = 1, updated_at = ? WHERE id = ?').run(nowIso(), id);
      return this.get(id);
    },

    unarchive(id: string): Vault | null {
      if (!this.get(id)) return null;
      db.prepare('UPDATE vaults SET archived = 0, updated_at = ? WHERE id = ?').run(nowIso(), id);
      return this.get(id);
    },

    /** Vaults opted in to cross-vault search (F1904 federation surface). */
    federated(): Vault[] {
      return (
        db
          .prepare('SELECT * FROM vaults WHERE federated = 1 AND archived = 0 ORDER BY name')
          .all() as VaultRow[]
      ).map(toVault);
    },

    /** Remove a vault from the registry. The active/last vault can't be removed. */
    remove(id: string): boolean {
      const cur = this.get(id);
      if (!cur) return false;
      if (cur.active) throw validation('cannot remove the active vault');
      if (this.list({ includeArchived: true }).length <= 1) {
        throw validation('cannot remove the last vault');
      }
      return db.prepare('DELETE FROM vaults WHERE id = ?').run(id).changes > 0;
    },
  };

  return repo;
}

export type VaultsRepo = ReturnType<typeof vaultsRepo>;
