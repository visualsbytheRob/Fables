/**
 * Global search overlay (F711–F720).
 * Triggered by ⌘⇧F (Mac) / Ctrl+Shift+F (Win/Linux).
 * Features: grouped results, highlight rendering, keyboard nav, type filters,
 * recent searches, mode toggle (keyword only; others "coming soon"),
 * desktop preview pane, empty/no-result states, zero-result logging.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Filter, Search, SlidersHorizontal, X } from '@fables/ui';
import type { SearchGroup, SearchMode, SearchResult } from '../api/client.js';
import { useSearch } from '../api/hooks.js';
import { splitHighlights } from './highlight.js';
import { addRecentSearch, getRecentSearches, logZeroResult } from './recentSearches.js';
import './search.css';

type ResultType = 'notes' | 'entities' | 'stories';
const ALL_TYPES: ResultType[] = ['notes', 'entities', 'stories'];
const TYPE_LABELS: Record<ResultType, string> = {
  notes: 'Notes',
  entities: 'Entities',
  stories: 'Stories',
};

function HighlightedText({
  text,
  highlights,
}: {
  text: string;
  highlights: { start: number; end: number }[];
}) {
  const segments = splitHighlights(text, highlights);
  return (
    <>
      {segments.map((seg, i) =>
        seg.highlighted ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>,
      )}
    </>
  );
}

function ResultItem({
  result,
  type,
  isActive,
  onSelect,
  onHover,
}: {
  result: SearchResult;
  type: string;
  isActive: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <div
      className={`search-result-item${isActive ? ' search-result-item--active' : ''}`}
      role="option"
      aria-selected={isActive}
      onClick={onSelect}
      onMouseEnter={onHover}
      data-type={type}
    >
      <div className="search-result-item__title">
        <HighlightedText text={result.title} highlights={[]} />
      </div>
      {result.snippet && (
        <div className="search-result-item__snippet">
          <HighlightedText text={result.snippet} highlights={result.highlights} />
        </div>
      )}
    </div>
  );
}

function GroupSection({
  group,
  activeIdx,
  globalOffset,
  onSelect,
  onHover,
}: {
  group: SearchGroup;
  activeIdx: number;
  globalOffset: number;
  onSelect: (result: SearchResult, type: string) => void;
  onHover: (idx: number) => void;
}) {
  return (
    <div className="search-group">
      <div className="search-group__header">
        <span>{TYPE_LABELS[group.type as ResultType] ?? group.type}</span>
        <span className="search-group__count">{group.total}</span>
      </div>
      {group.results.map((result, i) => (
        <ResultItem
          key={result.id}
          result={result}
          type={group.type}
          isActive={globalOffset + i === activeIdx}
          onSelect={() => onSelect(result, group.type)}
          onHover={() => onHover(globalOffset + i)}
        />
      ))}
    </div>
  );
}

function PreviewPane({ result, type }: { result: SearchResult | null; type: string }) {
  if (!result) {
    return <div className="search-preview search-preview--empty">Select a result to preview</div>;
  }
  return (
    <div className="search-preview">
      <div className="search-preview__type">{TYPE_LABELS[type as ResultType] ?? type}</div>
      <h3 className="search-preview__title">{result.title}</h3>
      <p className="search-preview__snippet">{result.snippet}</p>
    </div>
  );
}

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [activeTypes, setActiveTypes] = useState<ResultType[]>(ALL_TYPES);
  const [mode, setMode] = useState<SearchMode>('keyword');
  const [previewEntry, setPreviewEntry] = useState<{ result: SearchResult; type: string } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce query 250ms
  useEffect(() => {
    if (debouncedRef.current !== null) clearTimeout(debouncedRef.current);
    debouncedRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);
    return () => {
      if (debouncedRef.current !== null) clearTimeout(debouncedRef.current);
    };
  }, [query]);

  const searchParams = useMemo(
    () =>
      debouncedQuery.trim()
        ? {
            q: debouncedQuery.trim(),
            types: activeTypes.join(','),
            limit: 5,
          }
        : null,
    [debouncedQuery, activeTypes],
  );

  const { data, isPending } = useSearch(searchParams);

  // Flatten all results for keyboard nav
  const flatResults = useMemo<Array<{ result: SearchResult; type: string }>>(() => {
    if (!data?.data.groups) return [];
    return data.data.groups.flatMap((g) => g.results.map((r) => ({ result: r, type: g.type })));
  }, [data]);

  // Zero result logging
  const zeroLogged = useRef<string | null>(null);
  useEffect(() => {
    if (
      debouncedQuery.trim() &&
      !isPending &&
      flatResults.length === 0 &&
      zeroLogged.current !== debouncedQuery
    ) {
      logZeroResult(debouncedQuery);
      zeroLogged.current = debouncedQuery;
    }
  }, [debouncedQuery, isPending, flatResults.length]);

  // Sync preview with active item
  useEffect(() => {
    const entry = flatResults[activeIdx] ?? null;
    setPreviewEntry(entry);
  }, [activeIdx, flatResults]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setDebouncedQuery('');
      setActiveIdx(0);
      setPreviewEntry(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const recent = useMemo(() => (open ? getRecentSearches() : []), [open]);

  const navigateToResult = useCallback(
    (result: SearchResult, type: string) => {
      addRecentSearch(query || debouncedQuery);
      onClose();
      if (type === 'notes') navigate(`/notes/${result.id}`);
      else if (type === 'entities') navigate(`/entities/${result.id}`);
      else if (type === 'stories') navigate(`/stories/${result.id}`);
    },
    [navigate, onClose, query, debouncedQuery],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(flatResults.length - 1, 0)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const entry = flatResults[activeIdx];
        if (entry) navigateToResult(entry.result, entry.type);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, flatResults, activeIdx, navigateToResult]);

  const toggleType = (t: ResultType) => {
    setActiveTypes((prev) =>
      prev.includes(t) ? (prev.length > 1 ? prev.filter((x) => x !== t) : prev) : [...prev, t],
    );
    setActiveIdx(0);
  };

  if (!open) return null;

  const groups = data?.data.groups ?? [];
  const hasResults = flatResults.length > 0;
  const showEmpty = debouncedQuery.trim() && !isPending && !hasResults;
  const showRecent = !debouncedQuery.trim() && recent.length > 0;

  // Build group offsets for keyboard nav
  let offset = 0;
  const groupsWithOffset: Array<{ group: SearchGroup; offset: number }> = [];
  for (const group of groups) {
    groupsWithOffset.push({ group, offset });
    offset += group.results.length;
  }

  return (
    <div className="search-overlay" role="dialog" aria-label="Search" onClick={onClose}>
      <div className="search-overlay__panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="search-overlay__header">
          <Search size={16} className="search-overlay__icon" />
          <input
            ref={inputRef}
            className="search-overlay__input"
            placeholder="Search notes, entities, stories…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            aria-label="Search query"
            aria-autocomplete="list"
            aria-expanded={hasResults}
          />
          {query && (
            <Button
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                setDebouncedQuery('');
              }}
            >
              <X size={14} />
            </Button>
          )}
          <Button aria-label="Close search" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        {/* Toolbar: type filters + mode toggle */}
        <div className="search-overlay__toolbar">
          <div className="search-overlay__filters" role="group" aria-label="Result type filters">
            <Filter size={12} />
            {ALL_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`search-filter-btn${activeTypes.includes(t) ? ' search-filter-btn--active' : ''}`}
                onClick={() => toggleType(t)}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <div
            className="search-overlay__mode"
            role="group"
            aria-label="Search mode"
            title="Mode"
          >
            <SlidersHorizontal size={12} />
            {(['keyword', 'semantic', 'hybrid'] as SearchMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`search-mode-btn${mode === m ? ' search-mode-btn--active' : ''}${m !== 'keyword' ? ' search-mode-btn--soon' : ''}`}
                onClick={() => {
                  if (m === 'keyword') setMode(m);
                }}
                title={m !== 'keyword' ? `${m} — coming soon` : m}
                aria-disabled={m !== 'keyword'}
              >
                {m}
                {m !== 'keyword' && <span className="search-mode-btn__soon">soon</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="search-overlay__body">
          {/* Left: results list */}
          <div className="search-overlay__list" role="listbox" aria-label="Search results">
            {/* Recent searches (no query) */}
            {showRecent && (
              <div className="search-recent">
                <div className="search-recent__header">Recent searches</div>
                {recent.map((q) => (
                  <div
                    key={q}
                    className="search-result-item"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setQuery(q);
                      setDebouncedQuery(q);
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="search-recent__query">{q}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Loading */}
            {isPending && debouncedQuery && (
              <div className="search-overlay__state">Searching…</div>
            )}

            {/* No results */}
            {showEmpty && (
              <div className="search-overlay__state search-overlay__state--empty">
                <p>No results for &ldquo;{debouncedQuery}&rdquo;</p>
                <p className="search-overlay__state-hint">
                  Try different keywords or check your filters
                </p>
              </div>
            )}

            {/* Empty state (no query yet, no recents) */}
            {!debouncedQuery && !showRecent && (
              <div className="search-overlay__state">
                <p>Type to search across your vault</p>
              </div>
            )}

            {/* Result groups */}
            {groupsWithOffset.map(({ group, offset: gOffset }) => (
              <GroupSection
                key={group.type}
                group={group}
                activeIdx={activeIdx}
                globalOffset={gOffset}
                onSelect={navigateToResult}
                onHover={setActiveIdx}
              />
            ))}
          </div>

          {/* Right: preview pane (desktop) */}
          <PreviewPane
            result={previewEntry?.result ?? null}
            type={previewEntry?.type ?? ''}
          />
        </div>

        {/* Footer hints */}
        <div className="search-overlay__footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
