/**
 * Plugin manifest schema (F1001–F1003).
 *
 * A manifest.json file in DATA_DIR/plugins/<id>/manifest.json describes
 * a plugin's identity, capabilities, and UI contributions.
 */

import { z } from 'zod';

/** Semantic version string (e.g. "1.2.3"). */
export const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/, 'must be valid semver (e.g. 1.0.0)');

/** Permissions a plugin may declare. */
export const PLUGIN_PERMISSIONS = [
  'notes:read',        // read notes, tags, links via FQL
  'notes:write',       // create/update notes with plugin attribution
  'notes:watch',       // subscribe to note change events
  'stories:read',      // read VM state
  'stories:execute',   // register VM functions / effects
  'search:extend',     // add result sources to search
  'network',           // make outbound HTTP requests
  'storage',           // persist plugin-private data
  'ui:sidebar',        // contribute sidebar panel
  'ui:commands',       // contribute command palette items
  'ui:toolbar',        // contribute editor toolbar buttons
  'ui:context-menu',   // contribute note context-menu items
  'ui:status-bar',     // contribute status bar item
  'ui:theme',          // contribute full theme token sets
  'ui:page',           // contribute full custom pages
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export const pluginPermissionSchema = z.enum(PLUGIN_PERMISSIONS);

/** UI contribution declarations (consumed by the web lane). */
export const uiContributionsSchema = z
  .object({
    sidebar: z
      .object({ id: z.string().min(1), label: z.string().min(1), icon: z.string().optional() })
      .optional(),
    commands: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1), shortcut: z.string().optional() }))
      .optional(),
    toolbarButtons: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1), icon: z.string().optional() }))
      .optional(),
    contextMenuItems: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
      .optional(),
    statusBarItems: z
      .array(z.object({ id: z.string().min(1) }))
      .optional(),
    theme: z.object({ tokenFile: z.string().min(1) }).optional(),
    pages: z.array(z.object({ id: z.string().min(1), path: z.string().min(1), label: z.string().min(1) })).optional(),
  })
  .optional();

/** Declared dependency on another plugin. */
export const pluginDependencySchema = z.object({
  id: z.string().min(1),
  version: semverSchema,
});

/** Custom block type contributed by a plugin. */
export const customBlockTypeSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/, 'block name must be lowercase kebab-case'),
  description: z.string().optional(),
});

/** Story VM contributions declared in the manifest. */
export const vmContributionsSchema = z
  .object({
    functions: z
      .array(
        z.object({
          name: z.string().min(1).regex(/^[A-Z_][A-Z0-9_]*$/, 'VM function names must be UPPER_CASE'),
          description: z.string().optional(),
          deterministic: z.boolean().default(true),
          parameters: z.array(z.string()).default([]),
        }),
      )
      .optional(),
    effects: z
      .array(
        z.object({
          name: z.string().min(1).regex(/^[A-Z_][A-Z0-9_]*$/, 'effect names must be UPPER_CASE'),
          description: z.string().optional(),
        }),
      )
      .optional(),
    diagnostics: z
      .array(z.object({ code: z.string().min(1), description: z.string().optional() }))
      .optional(),
    exportFormats: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
      .optional(),
  })
  .optional();

/** Privacy label describing what data a plugin touches. */
export const privacyLabelSchema = z
  .object({
    readsNotes: z.boolean().default(false),
    writesNotes: z.boolean().default(false),
    readsStories: z.boolean().default(false),
    sendsNetwork: z.boolean().default(false),
    storesLocalData: z.boolean().default(false),
    description: z.string().optional(),
  })
  .optional();

/**
 * Versioned manifest schema (F1001, F1003).
 * Version 1 is the only schema version today; bump the outer `schemaVersion`
 * when breaking changes are introduced.
 */
export const pluginManifestSchema = z.object({
  /** Manifest schema version — NOT the plugin's version. */
  schemaVersion: z.literal(1).default(1),

  /** Stable reverse-domain identifier, e.g. "com.example.my-plugin". */
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z][a-z0-9._-]+$/, 'id must be lowercase, start with a letter, and contain only [a-z0-9._-]'),

  /** Semver version of the plugin itself. */
  version: semverSchema,

  /** Human-readable name. */
  name: z.string().min(1).max(256),

  /** One-line description shown in the plugin list. */
  description: z.string().max(1000).default(''),

  /** Author attribution. */
  author: z.string().max(256).optional(),

  /** Minimum Fables app version required. */
  minAppVersion: semverSchema.optional(),

  /** Entry file path relative to the plugin directory (default: "entry.js"). */
  entry: z.string().min(1).default('entry.js'),

  /** Permissions the plugin requests. Must all be granted to enable. */
  permissions: z.array(pluginPermissionSchema).default([]),

  /** Declared dependencies on other plugins. */
  dependencies: z.array(pluginDependencySchema).default([]),

  /** UI extension points this plugin contributes (declared, not code). */
  contributes: uiContributionsSchema,

  /** VM/story capabilities contributed. */
  vm: vmContributionsSchema,

  /** Custom fenced block types registered for the markdown renderer. */
  blockTypes: z.array(customBlockTypeSchema).default([]),

  /** Privacy labels. */
  privacy: privacyLabelSchema,
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginDependency = z.infer<typeof pluginDependencySchema>;
export type UiContributions = z.infer<typeof uiContributionsSchema>;
export type VmContributions = z.infer<typeof vmContributionsSchema>;
export type PrivacyLabel = z.infer<typeof privacyLabelSchema>;
