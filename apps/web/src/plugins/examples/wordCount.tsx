/**
 * F1081 — Word-count & writing-stats example plugin.
 *
 * Demonstrates:
 *  - sidebar panel contribution (F1041)
 *  - command contribution (F1042)
 *  - reading the active note via PluginHostApi.getNote (notes:read)
 *
 * This module exports a PluginFactory and is also used as an integration
 * test fixture for the extension point system (F1089).
 */
import { useEffect, useState } from 'react';
import type { PluginFactory, SidebarPanelProps } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Writing-stats calculation
// ────────────────────────────────────────────────────────────────────────────

export interface WritingStats {
  words: number;
  characters: number;
  sentences: number;
  paragraphs: number;
  readingTimeMinutes: number;
}

export function computeStats(body: string): WritingStats {
  const words = body.split(/\s+/).filter(Boolean).length;
  const characters = body.length;
  const sentences = (body.match(/[.!?]+/g) ?? []).length;
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
  const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));
  return { words, characters, sentences, paragraphs, readingTimeMinutes };
}

// ────────────────────────────────────────────────────────────────────────────
// Sidebar panel component
// ────────────────────────────────────────────────────────────────────────────

export function WordCountPanel({ activeNoteId, settings: _settings }: SidebarPanelProps) {
  const [stats, setStats] = useState<WritingStats | null>(null);

  useEffect(() => {
    setStats(null);
    if (!activeNoteId) return;
    // In a real installation the host injects getNote; here we fall back to
    // the fetch API for when this panel is rendered in-app directly.
    fetch(`/api/v1/notes/${activeNoteId}`)
      .then((r) => r.json())
      .then((body: { data?: { body?: string } }) => {
        const text = body?.data?.body ?? '';
        setStats(computeStats(text));
      })
      .catch(() => setStats(null));
  }, [activeNoteId]);

  if (!activeNoteId) {
    return (
      <div className="word-count-panel">
        <p style={{ color: 'var(--text-dim)', fontSize: 'var(--text-xs)' }}>
          Open a note to see stats.
        </p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="word-count-panel">
        <p style={{ color: 'var(--text-dim)', fontSize: 'var(--text-xs)' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="word-count-panel" aria-label="Writing statistics">
      <Stat label="Words" value={stats.words.toLocaleString()} />
      <Stat label="Characters" value={stats.characters.toLocaleString()} />
      <Stat label="Sentences" value={stats.sentences.toLocaleString()} />
      <Stat label="Paragraphs" value={stats.paragraphs.toLocaleString()} />
      <Stat
        label="Reading time"
        value={`~${stats.readingTimeMinutes} min`}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="word-count-panel__stat">
      <span className="word-count-panel__label">{label}</span>
      <span className="word-count-panel__value">{value}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Plugin factory
// ────────────────────────────────────────────────────────────────────────────

export const wordCountPlugin: PluginFactory = (host) => {
  const deregisterPanel = host.registerSidebarPanel(
    'word-count',
    'Writing Stats',
    WordCountPanel,
    { order: 50 },
  );

  const deregisterCmd = host.registerCommand({
    id: `${host.pluginId}.show`,
    label: 'Show writing stats',
    keywords: 'words count characters reading',
    run: () => {
      host.showToast('Writing Stats panel is in the sidebar.', 'info');
    },
  });

  return () => {
    deregisterPanel();
    deregisterCmd();
  };
};

/** Manifest fragment (for documentation/tests). */
export const WORD_COUNT_MANIFEST = {
  id: 'word-count',
  name: 'Writing Stats',
  version: '1.0.0',
  description: 'Word count and reading time in the sidebar.',
  permissions: ['notes:read'] as const,
  contributes: {
    sidebarPanels: [{ id: 'word-count', title: 'Writing Stats', order: 50 }],
    commands: [{ id: 'word-count.show', label: 'Show writing stats' }],
  },
};
