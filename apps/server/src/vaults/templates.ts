/**
 * Vault templates (Epic 20, F1906).
 *
 * A small gallery of starter presets — each carries default per-vault settings
 * (F1903) and a set of starter notebooks. Pure data + lookup; the repo applies
 * a template's settings when registering a vault, and a boot routine can seed
 * the notebooks into the new vault's data dir.
 */

export interface VaultTemplate {
  id: string;
  name: string;
  description: string;
  /** Default per-vault settings applied at registration (F1903). */
  settings: Record<string, unknown>;
  /** Starter notebooks seeded into a fresh vault. */
  notebooks: string[];
}

export const VAULT_TEMPLATES: VaultTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'An empty vault with sensible defaults.',
    settings: { theme: 'system', defaultView: 'notes' },
    notebooks: ['Inbox'],
  },
  {
    id: 'work',
    name: 'Work',
    description: 'Meetings, projects and tasks, tuned for daily knowledge work.',
    settings: { theme: 'light', defaultView: 'notes', dailyDigest: true },
    notebooks: ['Inbox', 'Meetings', 'Projects', 'Reference'],
  },
  {
    id: 'personal',
    name: 'Personal',
    description: 'A private journal-first vault with encryption on by default.',
    settings: { theme: 'system', defaultView: 'journal', encryptByDefault: true },
    notebooks: ['Journal', 'Ideas', 'Read Later'],
  },
  {
    id: 'worldbuilding',
    name: 'Worldbuilding',
    description: 'Stories, characters and lore for Fable Forge authors.',
    settings: { theme: 'dark', defaultView: 'codex', forgeEnabled: true },
    notebooks: ['Lore', 'Characters', 'Locations', 'Drafts'],
  },
];

export const DEFAULT_TEMPLATE = 'blank';

export function getTemplate(id: string): VaultTemplate | undefined {
  return VAULT_TEMPLATES.find((t) => t.id === id);
}

export function isTemplateId(id: string): boolean {
  return VAULT_TEMPLATES.some((t) => t.id === id);
}
