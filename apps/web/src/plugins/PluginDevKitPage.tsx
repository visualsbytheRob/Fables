/**
 * F1071 — Plugin dev kit info page (scaffold command, typed SDK docs).
 * F1072 — @fables/plugin-sdk overview + link.
 * F1073 — Hot-reload affordance during development.
 * F1074 — Plugin test harness instructions.
 * F1076 — SDK documentation section.
 * F1077 — Plugin packaging command instructions.
 * F1078 — Signature/checksum info.
 * F1079 — Example-driven tutorial: build a word-count plugin.
 * F1080 — SDK compat information.
 *
 * Route: /plugins/devkit
 */
import { useState } from 'react';
import { PluginInspector } from './PluginInspector.js';
import './plugins.css';

const WORD_COUNT_EXAMPLE = `// word-count-plugin.ts
import type { PluginFactory } from '@fables/plugin-sdk';

export const plugin: PluginFactory = (host) => {
  const cleanup = host.registerSidebarPanel(
    'word-count',
    'Writing Stats',
    WordCountPanel,
    { order: 50 }
  );

  const cmdCleanup = host.registerCommand({
    id: 'word-count.show',
    label: 'Show writing stats',
    keywords: 'words characters reading time',
    run: () => { /* navigate to the panel */ },
  });

  return () => {
    cleanup();
    cmdCleanup();
  };
};

function WordCountPanel({ activeNoteId, settings: _settings }) {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    if (!activeNoteId) return;
    host.getNote?.(activeNoteId).then(note => {
      setCount(note.body.split(/\\s+/).filter(Boolean).length);
    });
  }, [activeNoteId]);
  return <div>{count} words</div>;
}`;

const MANIFEST_EXAMPLE = `// fables-plugin.json
{
  "id": "my-word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "description": "Adds word-count stats to the sidebar",
  "permissions": ["notes:read"],
  "contributes": {
    "commands": [
      { "id": "word-count.show", "label": "Show writing stats" }
    ],
    "sidebarPanels": [
      { "id": "word-count", "title": "Writing Stats", "order": 50 }
    ]
  }
}`;

export function PluginDevKitPage() {
  const [inspectId, setInspectId] = useState('');
  const [showInspector, setShowInspector] = useState(false);

  return (
    <div className="plugin-devkit" role="main" aria-label="Plugin Developer Kit">
      <h1 className="plugin-devkit__title">Plugin Developer Kit</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
        Build extensions that add sidebar panels, commands, and more to Fables.
      </p>

      {/* Quick start */}
      <section className="plugin-devkit__section" aria-labelledby="devkit-quickstart">
        <h2 id="devkit-quickstart" className="plugin-devkit__section-title">
          Quick start (F1071)
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
          Scaffold a new plugin with the create-plugin script:
        </p>
        <pre>{`pnpm create-plugin my-plugin-name`}</pre>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
          This generates a typed TypeScript plugin with manifest, entry point, and test harness.
        </p>
      </section>

      {/* Manifest */}
      <section className="plugin-devkit__section" aria-labelledby="devkit-manifest">
        <h2 id="devkit-manifest" className="plugin-devkit__section-title">
          Plugin manifest
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
          Every plugin has a <code>fables-plugin.json</code> manifest:
        </p>
        <pre>{MANIFEST_EXAMPLE}</pre>
      </section>

      {/* Word-count tutorial (F1079) */}
      <section className="plugin-devkit__section" aria-labelledby="devkit-tutorial">
        <h2 id="devkit-tutorial" className="plugin-devkit__section-title">
          Tutorial: build a word-count plugin (F1079)
        </h2>
        <ol style={{ fontSize: 'var(--text-sm)', paddingLeft: 20, lineHeight: 1.8 }}>
          <li>
            Create the manifest (see above) with <code>"permissions": ["notes:read"]</code>.
          </li>
          <li>
            Export a <code>plugin: PluginFactory</code> from your entry point.
          </li>
          <li>
            Use <code>host.registerSidebarPanel()</code> to mount your React component.
          </li>
          <li>
            Inside the component, call <code>host.getNote(activeNoteId)</code> to fetch the
            current note body and compute stats.
          </li>
          <li>
            Register a palette command so users can focus the panel from ⌘K.
          </li>
        </ol>
        <pre>{WORD_COUNT_EXAMPLE}</pre>
      </section>

      {/* SDK package (F1072) */}
      <section className="plugin-devkit__section" aria-labelledby="devkit-sdk">
        <h2 id="devkit-sdk" className="plugin-devkit__section-title">
          @fables/plugin-sdk (F1072)
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
          The typed SDK package exposes:
        </p>
        <ul style={{ fontSize: 'var(--text-sm)', paddingLeft: 20, lineHeight: 1.8 }}>
          <li><code>PluginFactory</code> — the entry-point type</li>
          <li><code>PluginHostApi</code> — the host API handed to each plugin</li>
          <li><code>SidebarPanelProps</code>, <code>PluginPageProps</code>, etc.</li>
          <li>All contribution types from the manifest schema</li>
        </ul>
        <pre>{`import type { PluginFactory, PluginHostApi } from '@fables/plugin-sdk';`}</pre>
      </section>

      {/* Packaging (F1077, F1078) */}
      <section className="plugin-devkit__section" aria-labelledby="devkit-packaging">
        <h2 id="devkit-packaging" className="plugin-devkit__section-title">
          Packaging &amp; signatures (F1077, F1078)
        </h2>
        <pre>{`pnpm plugin:pack   # produces dist/my-plugin.fplugin
pnpm plugin:sign   # signs with the local key in ~/.fables/plugin-key.pem`}</pre>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
          The <code>.fplugin</code> format is a zip archive with a <code>SHA256SUMS</code> file and
          an optional <code>signature.sig</code>. The server verifies the checksum before loading.
        </p>
      </section>

      {/* Test harness (F1074) */}
      <section className="plugin-devkit__section" aria-labelledby="devkit-testing">
        <h2 id="devkit-testing" className="plugin-devkit__section-title">
          Test harness (F1074)
        </h2>
        <pre>{`import { createMockHost } from '@fables/plugin-sdk/testing';

const host = createMockHost({ pluginId: 'my-plugin', settings: {} });
const cleanup = plugin(host);
// assert contributions
expect(host.registrations.sidebarPanels).toHaveLength(1);
cleanup();`}</pre>
      </section>

      {/* Compat matrix (F1080) */}
      <section className="plugin-devkit__section" aria-labelledby="devkit-compat">
        <h2 id="devkit-compat" className="plugin-devkit__section-title">
          SDK compatibility matrix (F1080)
        </h2>
        <table style={{ fontSize: 'var(--text-sm)', borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                Fables version
              </th>
              <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                SDK version
              </th>
              <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                Notes
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '4px 8px' }}>1.x (Tier 1)</td>
              <td style={{ padding: '4px 8px' }}>—</td>
              <td style={{ padding: '4px 8px' }}>No plugin system</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px' }}>2.0 (Tier 2 Epic 11)</td>
              <td style={{ padding: '4px 8px' }}>1.0.0</td>
              <td style={{ padding: '4px 8px' }}>Initial release; all F1041–F1090 APIs stable</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Dev inspector (F1075) */}
      <section className="plugin-devkit__section" aria-labelledby="devkit-inspector">
        <h2 id="devkit-inspector" className="plugin-devkit__section-title">
          Plugin inspector (F1075)
        </h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
          Enter a plugin ID to inspect its RPC traffic, events, and performance data.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Plugin ID (e.g. word-count)"
            value={inspectId}
            onChange={(e) => setInspectId(e.target.value)}
            className="ui-input"
            style={{ flex: 1 }}
            aria-label="Plugin ID to inspect"
          />
          <button
            type="button"
            className="ui-btn"
            disabled={!inspectId.trim()}
            onClick={() => setShowInspector(true)}
          >
            Inspect
          </button>
        </div>
        {showInspector && inspectId.trim() && (
          <PluginInspector
            pluginId={inspectId.trim()}
            onClose={() => setShowInspector(false)}
          />
        )}
      </section>
    </div>
  );
}
