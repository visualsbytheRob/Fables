/**
 * F1090 — Example plugin gallery page.
 *
 * Shows the built-in example plugins with descriptions, live demos,
 * and links to the dev-kit tutorial. Route: /plugins/gallery
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@fables/ui';
import { PluginSandbox } from './PluginSandbox.js';
import { WordCountPanel } from './examples/wordCount.js';
import { PomodoroPanel } from './examples/pomodoro.js';
import { BUNDLED_THEMES } from './examples/customTheme.js';
import './plugins.css';

interface GalleryCard {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  contributes: string[];
  demo?: React.ReactNode;
}

const GALLERY_ITEMS: GalleryCard[] = [
  {
    id: 'word-count',
    name: 'Writing Stats',
    description:
      'Adds a sidebar panel showing word count, character count, estimated reading time, and more.',
    permissions: ['notes:read'],
    contributes: ['Sidebar panel', 'Command'],
    demo: <WordCountPanel activeNoteId={null} settings={{}} />,
  },
  {
    id: 'pomodoro',
    name: 'Pomodoro Timer',
    description:
      'A 25/5-minute focus timer in the sidebar, with a status-bar indicator and note-logging on session complete.',
    permissions: ['notes:write', 'notifications'],
    contributes: ['Sidebar panel', 'Status bar item', 'Command', 'Settings'],
    demo: <PomodoroPanel activeNoteId={null} settings={{ workMinutes: 25 }} />,
  },
  {
    id: 'custom-theme-pack',
    name: 'Theme Pack',
    description: 'Three extra themes: Midnight Indigo (dark), Sepia Classic (light), Forest Green (dark).',
    permissions: [],
    contributes: ['3 themes', 'Command'],
    demo: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {BUNDLED_THEMES.map((t) => (
          <div
            key={t.id}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              background: t.tokens['--bg'] ?? '#333',
              color: t.tokens['--text'] ?? '#fff',
              border: `1px solid ${t.tokens['--border'] ?? '#555'}`,
              fontSize: 12,
            }}
          >
            <strong style={{ color: t.tokens['--accent'] ?? t.tokens['--text'] }}>{t.name}</strong>
            <span style={{ marginLeft: 8, color: t.tokens['--text-dim'] ?? t.tokens['--text'], opacity: 0.8 }}>
              {t.base} mode
            </span>
          </div>
        ))}
      </div>
    ),
  },
];

export function ExampleGalleryPage() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="plugin-gallery" role="main" aria-label="Plugin gallery">
      <h1 className="plugin-gallery__title">Plugin Gallery</h1>
      <p className="plugin-gallery__subtitle">
        Example plugins that ship with Fables — each one demonstrates part of the Extension Point
        API and doubles as an integration test.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <Button onClick={() => navigate('/plugins')}>Manage plugins</Button>
        <Button onClick={() => navigate('/plugins/devkit')}>Developer kit</Button>
      </div>

      <div className="plugin-gallery__grid">
        {GALLERY_ITEMS.map((item) => (
          <div key={item.id} className="plugin-gallery-card">
            <div className="plugin-gallery-card__name">{item.name}</div>
            <p className="plugin-gallery-card__desc">{item.description}</p>

            <div className="plugin-gallery-card__footer">
              <span>{item.contributes.join(' · ')}</span>
              {item.permissions.length > 0 ? (
                <span title={item.permissions.join(', ')}>
                  🔒 {item.permissions.length} perm{item.permissions.length !== 1 ? 's' : ''}
                </span>
              ) : (
                <span>No permissions</span>
              )}
            </div>

            <button
              type="button"
              style={{
                marginTop: 8,
                background: 'none',
                border: 'none',
                fontSize: 'var(--text-xs)',
                color: 'var(--accent)',
                cursor: 'pointer',
                padding: 0,
                textDecoration: 'underline',
              }}
              onClick={() => toggle(item.id)}
              aria-expanded={expanded.has(item.id)}
            >
              {expanded.has(item.id) ? 'Hide demo' : 'Show demo'}
            </button>

            {expanded.has(item.id) && item.demo && (
              <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <PluginSandbox pluginId={item.id}>{item.demo}</PluginSandbox>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
