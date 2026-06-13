# Fables Plugin Architecture — Conceptual Overview

This document describes the Fables plugin system at a conceptual level for plugin authors and curious users. It covers what plugins are, how they work, the security model, and what they can do.

**Status:** This is the design for Epic 11 (F1001–F1100). The plugin system is shipping in Tier 2. APIs are still stabilizing — this describes the intended architecture, not final function signatures.

---

## What Is a Plugin?

A **plugin** is a piece of user-authored code that extends Fables' knowledge base and story engine without modifying the core app.

Plugins can:
- Read and write notes, entities, and tags.
- Hook into story compilation and playback with custom effects and functions.
- Contribute UI elements (sidebar panels, commands, settings, themes).
- Listen to events (note saved, story completed) and react.
- Automate workflows (auto-tagging imports, stats panels, custom themes).

Plugins run in **isolated worker threads**, never in the main process. They have no filesystem or network access except through capabilities that the user explicitly grants.

### Example Plugin Ideas

- **Word-count stats:** sidebar panel showing writing stats per day, per notebook.
- **Pomodoro timer:** focus timer logging sessions to daily notes.
- **Weather-in-daily-note:** on-demand weather insertion (network capability).
- **Dice roller:** story effect extending the VM with `ROLL(d20)` expressions.
- **Custom themes:** full theming pack with custom CSS tokens.
- **Mood tracker:** mini mood-log sidebar with sentiment analysis (local, no network).
- **Readwise importer:** batch import highlights from Readwise (network + note creation).
- **Achievement system:** story effect tracking achievements unlocked per playthrough.

---

## The Manifest

Every plugin is described by a **manifest** — a JSON document that declares:

### Required Fields

- **`id`** — unique plugin identifier (e.g., `com.example.word-count`). Package-name format.
- **`version`** — semver version (e.g., `1.2.0`). Used for update detection and compatibility.
- **`name`** — human-readable plugin name.
- **`entry`** — main entry file (e.g., `index.js` or `plugin.ts`). Compiled to bytecode and loaded in the worker.

### Manifest Example

```json
{
  "id": "com.fables.word-count",
  "version": "1.0.0",
  "name": "Word Count Stats",
  "entry": "index.js",
  "permissions": ["notes:read", "notes:query"],
  "contributions": {
    "sidebar": [{
      "id": "word-count-panel",
      "title": "Writing Stats",
      "icon": "BarChart3"
    }]
  },
  "dependencies": {
    "@fables/plugin-sdk": "^1.0.0"
  }
}
```

### Optional Fields

- **`permissions`** — array of capability strings the plugin requests (see Permissions below).
- **`contributions`** — UI extension points the plugin provides (see UI Extensions below).
- **`dependencies`** — npm packages the plugin requires (only whitelisted SDK packages allowed).
- **`config`** — schema for plugin settings (JSON Schema format).

---

## The Security Model

Plugins are **sandboxed for safety**.

### Isolation

- **Worker thread:** each plugin runs in its own isolated Node.js worker thread. Crashes don't affect the host.
- **No filesystem access:** plugins cannot read or write files except through granted capabilities.
- **No network access:** plugins cannot make HTTP requests except through granted capabilities.
- **No arbitrary host access:** plugins cannot access host modules, environment variables, or internals.

### Capabilities & Permissions

Plugins declare the **permissions** they need in the manifest. Users review permissions at install time and can revoke them later without uninstalling.

**Example permissions:**

- `notes:read` — read notes, search, query tags.
- `notes:write` — create/edit/delete notes.
- `entities:read` — read entity data.
- `entities:write` — mutate entity fields.
- `network:fetch` — make HTTP requests (required for importers, weather, etc.).
- `story:effects` — register custom story effects.
- `story:stdlib` — extend the Forge stdlib with custom functions.
- `ui:sidebar` — contribute sidebar panels.
- `ui:commands` — contribute commands to the palette.
- `ui:settings` — contribute settings sections.
- `events:listen` — listen to app events (note.saved, story.completed, etc.).

Permissions are **enforced by RPC**: the plugin makes requests through a typed API, and the host checks permissions before fulfilling them. A plugin without `notes:write` cannot create notes, period.

### Install-Time Consent

When a user installs a plugin:

1. The manifest is parsed and validated.
2. A **permission review screen** is shown, listing all requested capabilities.
3. The user approves or rejects. If approved, the plugin is installed and enabled.

Users can later **revoke individual permissions** without uninstalling, causing the plugin to degrade gracefully (e.g., a stats plugin without `notes:write` can't auto-save snapshots, but can still display read-only stats).

### Audit & Accountability

- **Audit log:** every capability use is logged (which plugin, which permission, timestamp, operation).
- **Resource budgets:** each plugin has CPU and memory limits. Exceeding them kills the plugin with backoff restart.
- **Timeout guards:** all RPC calls have timeouts. Hanging plugins are killed.
- **Crash isolation:** a crashing plugin is restarted automatically and never poison-pills the host.

For a deeper security model, see [docs/security.md](../security.md).

---

## What Plugins Can Extend

### Notes API

Plugins can read and write notes through a query interface:

- **Query:** `fql` queries (filter notes by tag, date, text, notebook).
- **Read:** fetch note bodies, metadata, attachments, tags.
- **Write:** create notes, edit bodies, add tags, create links.
- **Virtual notes:** plugins can compute note content on-the-fly (dynamic pinned stats, aggregations).
- **Custom blocks:** plugins can register block syntax (e.g., ````plugin:sidebar-stats` to inject computed panels).
- **Markdown post-processing:** transform rendered note output before display.
- **Watchers:** subscribe to note change events and react.

Example:

```typescript
// A plugin could offer:
// - A notes query API: const notes = await plugin.notes.query("tag:journal")
// - Read a note's data: const note = await plugin.notes.get(noteId)
// - Create a note: const newNote = await plugin.notes.create({ title, body })
// - Watch for saves: plugin.on("note:saved", (note) => { ... })
```

### Story/VM API

Plugins can extend the Forge story engine:

- **Custom effects:** register new effects callable from story source (e.g., `@myplugin.roll(d20)`).
- **Stdlib extensions:** add functions to the VM's standard library, namespaced by plugin (e.g., `DICE(2,6)`, `STATS.health()`).
- **Compiler hooks:** contribute custom lint rules, diagnostics.
- **Player overlays:** render UI overlays in the story player (e.g., a dice roller widget, stat bars).
- **VM state access:** read-only access to story variables and state (for UI bindings).
- **Choice hooks:** react to choices before/after they're made (useful for logging, analytics).
- **Export formats:** plugins can contribute story export targets (e.g., PDF, epub).

Example:

```typescript
// A plugin could offer:
// - Register an effect: plugin.story.registerEffect("roll", (size) => { ... })
//   Then from Forge: @roll(d20) or @roll(3d6+2)
// - Add a function: plugin.story.registerFunction("wordcount", (text) => { ... })
//   Then from Forge: ~ var words = WORDCOUNT(@note.body)
// - Listen to choices: plugin.story.on("choice", (choice) => { ... })
```

### UI Extension Points

Plugins contribute UI elements at predefined extension points:

- **Sidebar panels:** custom accordion panels in the sidebar (below notebooks).
- **Commands:** new commands in the command palette (⌘K / Ctrl+K).
- **Context menus:** items on note/entity right-click menus.
- **Editor toolbar:** buttons in the note editor toolbar.
- **Settings sections:** plugin-specific settings pages.
- **Custom routes:** entirely new pages (e.g., `/plugin/my-plugin/dashboard`).
- **Status bar items:** indicators and buttons in the status bar.
- **Themes:** full theme packs (token overrides, color schemes, typography).

UI contributions are **sandboxed in iframes or React portals** to prevent style leakage and XSS.

Example:

```json
{
  "contributions": {
    "sidebar": [{
      "id": "stats-panel",
      "title": "Writing Stats",
      "icon": "BarChart3"
    }],
    "commands": [{
      "id": "show-stats",
      "title": "Show Word Count",
      "keybinding": "ctrl+shift+w"
    }],
    "settings": [{
      "id": "stats-settings",
      "title": "Stats Panel Settings"
    }]
  }
}
```

### Event Hooks & Filters

Plugins subscribe to **typed events** with filter chains:

- **Events:** `note.saved`, `note.deleted`, `entity.mutated`, `story.completed`, `playthrough.started`, `sync.done`.
- **Filters:** ordered pipelines that transform data (e.g., note → transformed note → stored).
- **Async support:** hooks can be async with timeout budgets.
- **Priorities:** hooks run in order; one hook's failure doesn't break the chain.
- **Idempotency keys:** prevent re-running the same hook twice on the same event.

Example:

```typescript
// Subscribe to note saves and auto-tag by word count:
plugin.on("note:saved", async (note) => {
  const count = note.body.split(/\s+/).length;
  if (count > 1000) {
    await plugin.notes.addTag(note.id, "#essay");
  } else if (count > 100) {
    await plugin.notes.addTag(note.id, "#snippet");
  }
});
```

---

## The Permission & Consent Model

### Install Time

1. User drops a `.fplugin` file into the app or clicks "Install from URL".
2. Manifest is validated: schema, versioning, declared permissions.
3. **Permission screen** shows:
   - Plugin name, version, author (optional).
   - All permissions it requests (human-readable descriptions).
   - Estimated resource use (CPU/memory budget).
   - Warnings for risky permissions (network, note deletion).
4. User approves all or rejects.
5. If approved: plugin is stored in `DATA_DIR/plugins/<id>/`, enabled, loaded.

### Runtime

- **Capability checks:** before fulfilling a plugin request, the host checks if the plugin has permission.
- **Escalation prompts:** some plugins may request new permissions at runtime (rare; generally discouraged).
- **Revocation:** in settings, users can toggle permissions per plugin. Plugins degrade gracefully.

### Uninstall & Cleanup

- Uninstall removes the plugin code and settings.
- **Data cleanup:** plugins can declare cleanup hooks (e.g., "delete notes created by this plugin").
- User chooses keep/delete data.

---

## Example: A Word-Count Plugin

To illustrate the architecture, here's a conceptual word-count plugin:

### Manifest

```json
{
  "id": "com.fables.word-count",
  "version": "1.0.0",
  "name": "Word Count Stats",
  "entry": "index.js",
  "permissions": ["notes:read"],
  "contributions": {
    "sidebar": [{
      "id": "stats",
      "title": "Writing Stats",
      "icon": "BarChart3"
    }]
  }
}
```

### Plugin Code (Conceptual)

```typescript
import { Plugin } from "@fables/plugin-sdk";

const plugin = new Plugin();

// Register a sidebar panel
plugin.ui.registerPanel("stats", {
  title: "Writing Stats",
  icon: "BarChart3",
  render: async (context) => {
    // Query notes from the current notebook
    const notes = await plugin.notes.query(`notebook:"${context.currentNotebook}"`);
    const stats = {
      totalNotes: notes.length,
      totalWords: notes.reduce((sum, n) => sum + wordCount(n.body), 0),
      avgWordsPerNote: notes.length ? totalWords / notes.length : 0,
    };
    return renderStats(stats);
  }
});

// Update stats when a note is saved
plugin.on("note:saved", async (note) => {
  // Refresh the panel (UI framework handles this)
  plugin.ui.invalidate("stats");
});

function wordCount(text: string): number {
  return text.split(/\s+/).length;
}

export default plugin;
```

The user installs this plugin. They approve the `notes:read` permission. A "Writing Stats" panel appears in the sidebar. When they save a note, stats auto-update.

---

## Kinds of Plugins We Anticipate

### Knowledge Plugins

- **Importers:** batch import from Readwise, Pocket, RSS feeds.
- **Auto-tagging:** smart tagging on save (by ML, by rules, by NLP).
- **Link suggesters:** recommend connections between notes.
- **Duplicate detectors:** flag duplicate/similar notes.
- **Schedulers:** re-surface notes by spaced repetition rules.
- **Query builders:** visual query composer UIs.

### Story Plugins

- **Dice rollers:** visual dice roller integrated into player.
- **Audio:** story-triggered sound effects and ambient music.
- **Achievements:** unlock-tracking system across playthroughs.
- **Analytics:** story metrics (play counts, choice distribution).
- **Snapshot savers:** auto-save world state after choices.
- **Export enhancers:** PDF, epub, HTML story export with custom styling.

### Productivity Plugins

- **Timers:** Pomodoro, distraction trackers.
- **Mood logger:** sentiment tracking with journal integration.
- **Reading time:** estimate and track reading habits.
- **Sync monitor:** sync health and conflict detective.
- **Backup reminders:** check backup status, trigger on-demand backups.

### Customization Plugins

- **Themes:** color schemes, fonts, typography.
- **Keyboard shortcuts:** rebind commands, add macros.
- **Sidebar organizers:** custom sidebar layouts.
- **UI tweaks:** hide/show features, reorder panels.

---

## Plugin Lifecycle

1. **Discovery:** user finds plugin (URL, local file, catalog page).
2. **Install:** manifest validated, permissions reviewed, code loaded into worker.
3. **Enable/Disable:** toggled in settings without uninstall. Disabled plugins' workers are dormant.
4. **Update:** new version available, user approves update. Worker swapped, state migrated if needed.
5. **Uninstall:** plugin removed, data cleanup options offered.

All lifecycle events are logged. Failed plugin loads (manifest errors, missing dependencies, crashes at boot) never crash the host; they're quarantined and reported in settings.

---

## What Plugins Cannot Do

Plugins have **hard limits**:

- ❌ Cannot access the filesystem (except through plugin storage APIs).
- ❌ Cannot make network requests except through granted capabilities.
- ❌ Cannot access host internals or other plugins' code.
- ❌ Cannot inspect or modify the Tailscale configuration.
- ❌ Cannot persist data outside their plugin directory.
- ❌ Cannot execute arbitrary shell commands.
- ❌ Cannot modify the core app's config or database schema.
- ❌ Cannot call effects without declaring them in the manifest.

These limits are **enforced by design**: plugins are workers with an RPC bridge. No esoteric Node.js APIs are available. No `import('fs')` surprises. Attempting a forbidden action fails gracefully (permission denied, not a silent bug).

---

## Plugin APIs (Conceptual Stability Note)

**These APIs are still stabilizing.** The exact function signatures will emerge during Epic 11 implementation. Expect:

- `plugin.notes.query(fql)` — query notes with FQL.
- `plugin.notes.get(id)`, `plugin.notes.create(note)`, `plugin.notes.update(id, changes)`, `plugin.notes.delete(id)`.
- `plugin.entities.*` — similar CRUD for entities.
- `plugin.story.registerEffect(name, handler)` — add story effects.
- `plugin.story.registerFunction(name, handler)` — add VM stdlib functions.
- `plugin.ui.registerPanel(id, config)` — contribute sidebar panels.
- `plugin.ui.registerCommand(id, handler)` — contribute commands.
- `plugin.on(event, handler)` — listen to events.

The SDK (`@fables/plugin-sdk`) will be the authoritative source once Epic 11 ships.

---

## Development Workflow

**For plugin authors:**

1. **Bootstrap:** `pnpm create-plugin my-plugin` generates a scaffold.
2. **Edit:** develop in TypeScript with IDE support (types from the SDK).
3. **Test:** `pnpm test` runs tests against a mock host (plugin harness).
4. **Dev mode:** special dev flag auto-reloads plugin on save. Inspector shows RPC calls, events, perf.
5. **Package:** `pnpm build && pnpm plugin pack` creates a `.fplugin` archive with signature.
6. **Share:** distribute the archive (URL, file, catalog).

---

## Roadmap

**Epic 11 (Tier 2)** brings:
- ✅ Manifest spec + loader (F1001–F1010)
- ✅ Sandboxed runtime (F1011–F1020)
- ✅ Notes API (F1021–F1030)
- ✅ Story/VM API (F1031–F1040)
- ✅ UI extension points (F1041–F1050)
- ✅ Event hooks (F1051–F1060)
- ✅ Permissions & consent UX (F1061–F1070)
- ✅ Dev kit (F1071–F1080)
- ✅ Example plugins (F1081–F1090)
- ✅ Distribution (F1091–F1100)

Future epics may add:
- **Plugin marketplace:** curated catalog of trusted plugins.
- **Plugin signing:** cryptographic signatures for integrity.
- **Collaborative plugins:** multi-user plugin state.
- **Plugin composition:** one plugin depends on another.

---

## Further Reading

- **[Architecture](../architecture.md)** — understand the host Fables app.
- **[Security & Privacy](../security.md)** — deeper security model and threat matrix.
- **[Troubleshooting](../troubleshooting.md)** — debug plugin issues.
- **Plugin SDK Reference** (coming in Epic 11) — exact API signatures and examples.
- **Plugin Dev Kit Tutorial** (coming in Epic 11) — step-by-step guide to building your first plugin.

---

**This plugin system is designed for extensibility without sacrificing security or simplicity. Plugins make Fables truly personal.**
