/**
 * F1041–F1050 — Plugin & Extension Architecture: core types.
 *
 * The ExtensionPoint API defines typed contribution slots that plugins
 * (declared in their manifest's `contributes` field) can register into.
 * All plugin-contributed UI passes through this registry; no plugin can
 * reach into app internals directly.
 */

import type { ComponentType, ReactNode } from 'react';
import type { PaletteCommand } from '@fables/ui';
import type { MenuItem } from '../notes/ContextMenu.js';

// ────────────────────────────────────────────────────────────────────────────
// Plugin manifest types (mirror the server's plugin record)
// ────────────────────────────────────────────────────────────────────────────

/** Permission strings a plugin may declare. */
export type PluginPermission =
  | 'notes:read'
  | 'notes:write'
  | 'notebooks:read'
  | 'notebooks:write'
  | 'stories:read'
  | 'stories:write'
  | 'network'
  | 'clipboard'
  | 'notifications'
  | 'storage:local';

/** Status values returned by the server. */
export type PluginStatus = 'active' | 'error' | 'disabled' | 'loading';

/** A plugin record as returned by GET /api/v1/plugins. */
export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  status: PluginStatus;
  permissions: PluginPermission[];
  contributes: PluginContributes;
  /** ISO timestamp */
  installedAt?: string;
  homepageUrl?: string;
  iconUrl?: string;
}

/** Shape of the `contributes` key in a plugin manifest. */
export interface PluginContributes {
  commands?: ContributedCommand[];
  sidebarPanels?: ContributedSidebarPanel[];
  contextMenuItems?: ContributedContextMenuItem[];
  toolbarButtons?: ContributedToolbarButton[];
  settingsSections?: ContributedSettingsSection[];
  routes?: ContributedRoute[];
  statusBarItems?: ContributedStatusBarItem[];
  themes?: ContributedTheme[];
}

// ────────────────────────────────────────────────────────────────────────────
// Individual contribution shapes
// ────────────────────────────────────────────────────────────────────────────

export interface ContributedCommand {
  id: string;
  label: string;
  keywords?: string;
}

export interface ContributedSidebarPanel {
  id: string;
  title: string;
  icon?: string;
  /** Position hint: lower = higher up the sidebar. Default 100. */
  order?: number;
}

export interface ContributedContextMenuItem {
  id: string;
  label: string;
  /** Which context the item appears in. */
  context: 'note' | 'notebook' | 'selection';
}

export interface ContributedToolbarButton {
  id: string;
  label: string;
  icon?: string;
  /** Position hint. */
  order?: number;
}

export interface ContributedSettingsSection {
  id: string;
  title: string;
  /** Ordered list of schema-driven form fields. */
  fields: SettingsField[];
}

export type SettingsField =
  | { type: 'text'; key: string; label: string; placeholder?: string; defaultValue?: string }
  | { type: 'toggle'; key: string; label: string; defaultValue?: boolean }
  | { type: 'select'; key: string; label: string; options: { value: string; label: string }[]; defaultValue?: string }
  | { type: 'number'; key: string; label: string; min?: number; max?: number; defaultValue?: number };

export interface ContributedRoute {
  path: string;
  title: string;
  /** Whether to show in sidebar navigation. */
  showInSidebar?: boolean;
  sidebarOrder?: number;
}

export interface ContributedStatusBarItem {
  id: string;
  /** Position: 'left' | 'right'. Default 'right'. */
  align?: 'left' | 'right';
  order?: number;
}

export interface ContributedTheme {
  id: string;
  name: string;
  /** 'dark' or 'light' base */
  base: 'dark' | 'light';
  /** CSS custom property overrides, e.g. { '--bg': '#1a1a2e' } */
  tokens: Record<string, string>;
}

// ────────────────────────────────────────────────────────────────────────────
// Runtime extension registration types (what plugin implementations provide)
// ────────────────────────────────────────────────────────────────────────────

/** A registered sidebar panel. */
export interface SidebarPanelRegistration {
  pluginId: string;
  panelId: string;
  title: string;
  icon?: string;
  order: number;
  component: ComponentType<SidebarPanelProps>;
}

export interface SidebarPanelProps {
  /** The currently open note ID, if any. */
  activeNoteId: string | null;
  /** Read-only plugin settings values. */
  settings: Record<string, unknown>;
}

/** A registered command (wraps PaletteCommand with plugin provenance). */
export interface PluginCommandRegistration {
  pluginId: string;
  command: PaletteCommand;
}

/** A registered context-menu item. */
export interface ContextMenuItemRegistration {
  pluginId: string;
  item: MenuItem;
  context: ContributedContextMenuItem['context'];
}

/** A registered toolbar button. */
export interface ToolbarButtonRegistration {
  pluginId: string;
  buttonId: string;
  label: string;
  icon?: string;
  order: number;
  run: () => void;
}

/** A registered settings section (schema-driven). */
export interface SettingsSectionRegistration {
  pluginId: string;
  sectionId: string;
  title: string;
  fields: SettingsField[];
}

/** A registered route. */
export interface RouteRegistration {
  pluginId: string;
  path: string;
  title: string;
  showInSidebar: boolean;
  sidebarOrder: number;
  component: ComponentType<PluginPageProps>;
}

export interface PluginPageProps {
  settings: Record<string, unknown>;
}

/** A registered status-bar item. */
export interface StatusBarItemRegistration {
  pluginId: string;
  itemId: string;
  align: 'left' | 'right';
  order: number;
  component: ComponentType<StatusBarItemProps>;
}

export interface StatusBarItemProps {
  settings: Record<string, unknown>;
}

/** A registered theme contribution. */
export interface ThemeRegistration {
  pluginId: string;
  theme: ContributedTheme;
}

/** The full shape of a plugin's runtime registration. */
export interface PluginRegistration {
  pluginId: string;
  sidebarPanels: SidebarPanelRegistration[];
  commands: PluginCommandRegistration[];
  contextMenuItems: ContextMenuItemRegistration[];
  toolbarButtons: ToolbarButtonRegistration[];
  settingsSections: SettingsSectionRegistration[];
  routes: RouteRegistration[];
  statusBarItems: StatusBarItemRegistration[];
  themes: ThemeRegistration[];
}

// ────────────────────────────────────────────────────────────────────────────
// Plugin host API — the object handed to each plugin implementation
// ────────────────────────────────────────────────────────────────────────────

export interface PluginHostApi {
  /** The plugin's own ID. */
  pluginId: string;
  /** The plugin's persisted settings (read-only snapshot). */
  settings: Record<string, unknown>;
  /** Register a sidebar panel. Returns a deregister function. */
  registerSidebarPanel(
    panelId: string,
    title: string,
    component: ComponentType<SidebarPanelProps>,
    opts?: { icon?: string; order?: number },
  ): () => void;
  /** Register a command-palette command. Returns a deregister function. */
  registerCommand(command: PaletteCommand): () => void;
  /** Register a context-menu item. Returns a deregister function. */
  registerContextMenuItem(
    item: MenuItem,
    context: ContributedContextMenuItem['context'],
  ): () => void;
  /** Register a toolbar button. Returns a deregister function. */
  registerToolbarButton(
    buttonId: string,
    label: string,
    run: () => void,
    opts?: { icon?: string; order?: number },
  ): () => void;
  /** Register a status-bar item component. Returns a deregister function. */
  registerStatusBarItem(
    itemId: string,
    component: ComponentType<StatusBarItemProps>,
    opts?: { align?: 'left' | 'right'; order?: number },
  ): () => void;
  /** Register a route/page. Returns a deregister function. */
  registerRoute(
    path: string,
    title: string,
    component: ComponentType<PluginPageProps>,
    opts?: { showInSidebar?: boolean; sidebarOrder?: number },
  ): () => void;
  /** Show a toast notification. */
  showToast(message: string, type?: 'info' | 'error' | 'success'): void;
  /** Read a note by ID. Requires notes:read permission. */
  getNote?(noteId: string): Promise<{ id: string; title: string; body: string }>;
  /** Append text to a note. Requires notes:write permission. */
  appendToNote?(noteId: string, text: string): Promise<void>;
}

/** Factory function exported by each plugin module. */
export type PluginFactory = (host: PluginHostApi) => () => void; // returns cleanup

/** Sandbox wrapper around a plugin's rendered component. */
export interface SandboxedComponentProps {
  children: ReactNode;
  pluginId: string;
}
