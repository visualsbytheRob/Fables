/**
 * Codex slide-over (F614/F617): lists every entity the reader has met in this
 * playthrough, newest first, with search and per-type filters. A badge on the
 * opener pulses when an entry is newly met since the panel was last opened.
 * Each row expands to a spoiler-safe {@link EntityCard}.
 */
import { useMemo, useState } from 'react';
import { Compass, Search } from '@fables/ui';
import type { CodexData, CodexEntry, EntityType } from '../api/client.js';
import { EntityCard } from './EntityCard.js';

const TYPE_FILTERS: { value: EntityType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'character', label: 'People' },
  { value: 'place', label: 'Places' },
  { value: 'item', label: 'Items' },
  { value: 'faction', label: 'Factions' },
  { value: 'custom', label: 'Other' },
];

/** Filter codex entries by a free-text query and a type. Pure (tested). */
export function filterCodex(
  entries: readonly CodexEntry[],
  query: string,
  type: EntityType | 'all',
): CodexEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (type !== 'all' && entry.type !== type) return false;
    if (q === '') return true;
    if (entry.name.toLowerCase().includes(q)) return true;
    return Object.values(entry.revealedFields).some((v) =>
      String(Array.isArray(v) ? v.join(' ') : v)
        .toLowerCase()
        .includes(q),
    );
  });
}

export function CodexPanel({
  data,
  onClose,
}: {
  data: CodexData | undefined;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<EntityType | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const filtered = useMemo(() => filterCodex(entries, query, type), [entries, query, type]);

  return (
    <div
      className="codex-slideover"
      role="dialog"
      aria-modal="true"
      aria-label="Codex"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="codex-panel">
        <div className="codex-header">
          <h3 style={{ flex: 1, margin: 0 }}>
            <Compass size={16} /> Codex
          </h3>
          <button className="player-iconbtn" onClick={onClose} aria-label="Close codex">
            ✕
          </button>
        </div>

        <div className="codex-search">
          <Search size={14} aria-hidden />
          <input
            type="text"
            aria-label="Search codex"
            placeholder="Search the codex…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="codex-filters" role="tablist" aria-label="Filter by type">
          {TYPE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              role="tab"
              aria-selected={type === filter.value}
              className={`codex-filter${type === filter.value ? ' active' : ''}`}
              onClick={() => setType(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="codex-list" data-testid="codex-list">
          {entries.length === 0 ? (
            <p className="codex-empty">
              You have not met anyone yet. Characters, places and things appear here as the story
              introduces them.
            </p>
          ) : filtered.length === 0 ? (
            <p className="codex-empty">No entries match your search.</p>
          ) : (
            filtered.map((entry) =>
              expanded === entry.entryId ? (
                <button
                  key={entry.entryId}
                  className="codex-row codex-row--open"
                  onClick={() => setExpanded(null)}
                  aria-expanded
                >
                  <EntityCard entry={entry} />
                </button>
              ) : (
                <button
                  key={entry.entryId}
                  className="codex-row"
                  onClick={() => setExpanded(entry.entryId)}
                  aria-expanded={false}
                >
                  <span className="codex-row-name">{entry.name}</span>
                  <span className="codex-row-type">{entry.type}</span>
                </button>
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}
