/**
 * F1085 — Custom theme pack example plugin.
 *
 * Demonstrates:
 *  - theme contribution (F1048): a full CSS token set registered via
 *    the extension registry, applied by the ThemeProvider when selected.
 *  - settings section contribution (F1063): a selector for which sub-theme.
 *
 * This is also an integration test fixture (F1089).
 */
import type { PluginFactory, ContributedTheme } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Theme definitions
// ────────────────────────────────────────────────────────────────────────────

export const MIDNIGHT_THEME: ContributedTheme = {
  id: 'midnight-indigo',
  name: 'Midnight Indigo',
  base: 'dark',
  tokens: {
    '--bg': '#0d0d1a',
    '--bg-hover': '#1a1a2e',
    '--border': '#2a2a4a',
    '--text': '#e8e8f0',
    '--text-dim': '#8888aa',
    '--accent': '#7c5cfc',
    '--accent-dim': '#4a3a99',
  },
};

export const SEPIA_THEME: ContributedTheme = {
  id: 'sepia-classic',
  name: 'Sepia Classic',
  base: 'light',
  tokens: {
    '--bg': '#f7f2e8',
    '--bg-hover': '#ede8de',
    '--border': '#c8bea0',
    '--text': '#3b2f1a',
    '--text-dim': '#7a6a50',
    '--accent': '#8b5e3c',
    '--accent-dim': '#c49a6c',
  },
};

export const FOREST_THEME: ContributedTheme = {
  id: 'forest-green',
  name: 'Forest Green',
  base: 'dark',
  tokens: {
    '--bg': '#0d1a0d',
    '--bg-hover': '#1a2e1a',
    '--border': '#2a4a2a',
    '--text': '#e0f0e0',
    '--text-dim': '#88aa88',
    '--accent': '#4caf50',
    '--accent-dim': '#2e7d32',
  },
};

export const BUNDLED_THEMES: ContributedTheme[] = [
  MIDNIGHT_THEME,
  SEPIA_THEME,
  FOREST_THEME,
];

// ────────────────────────────────────────────────────────────────────────────
// Plugin factory
// ────────────────────────────────────────────────────────────────────────────

export const customThemePlugin: PluginFactory = (host) => {
  // NOTE: theme contributions are registered into the extension registry.
  // The ThemeProvider reads them and offers them alongside the built-in
  // system/dark/light options. This factory just registers the command;
  // the registry mutator handles the actual theme token injection.

  const deregCmd = host.registerCommand({
    id: `${host.pluginId}.browse`,
    label: 'Browse theme pack themes',
    keywords: 'theme color scheme appearance',
    run: () => {
      host.showToast('Select a theme in Settings → Appearance.', 'info');
    },
  });

  return () => {
    deregCmd();
  };
};

export const CUSTOM_THEME_MANIFEST = {
  id: 'custom-theme-pack',
  name: 'Theme Pack',
  version: '1.0.0',
  description: 'Three extra themes: Midnight Indigo, Sepia Classic, Forest Green.',
  permissions: [] as const,
  contributes: {
    themes: BUNDLED_THEMES.map((t) => ({ id: t.id, name: t.name, base: t.base, tokens: t.tokens })),
    commands: [{ id: 'custom-theme-pack.browse', label: 'Browse theme pack themes' }],
  },
};
