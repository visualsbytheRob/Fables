/**
 * Outline panel component (F387): renders the knots/stitches/labels tree and
 * reports clicks so the host can move the editor cursor.
 */
import type { OutlineEntry } from './outline.js';

export interface OutlinePanelProps {
  outline: OutlineEntry[];
  /** Cursor offset, used to highlight the active entry. */
  activeOffset?: number;
  onSelect: (entry: OutlineEntry) => void;
}

const GLYPH: Record<OutlineEntry['kind'], string> = {
  knot: '===',
  stitch: '=',
  label: '( )',
};

function isActive(entry: OutlineEntry, all: OutlineEntry[], offset: number | undefined): boolean {
  if (offset === undefined) return false;
  // Active = the last entry (in document order, flattened) at or before the cursor.
  let best: OutlineEntry | undefined;
  const visit = (entries: OutlineEntry[]): void => {
    for (const e of entries) {
      if (e.offset <= offset && (best === undefined || e.offset > best.offset)) best = e;
      visit(e.children);
    }
  };
  visit(all);
  return best === entry;
}

function OutlineList({
  entries,
  all,
  activeOffset,
  onSelect,
}: {
  entries: OutlineEntry[];
  all: OutlineEntry[];
  activeOffset: number | undefined;
  onSelect: (entry: OutlineEntry) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <ul className="forge-outline-list">
      {entries.map((entry) => (
        <li key={`${entry.kind}-${entry.name}-${entry.offset}`}>
          <button
            type="button"
            className={`forge-outline-entry forge-outline-${entry.kind}${
              isActive(entry, all, activeOffset) ? ' is-active' : ''
            }`}
            onClick={() => onSelect(entry)}
          >
            <span className="forge-outline-glyph" aria-hidden="true">
              {GLYPH[entry.kind]}
            </span>
            {entry.name}
          </button>
          <OutlineList
            entries={entry.children}
            all={all}
            activeOffset={activeOffset}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}

export function OutlinePanel({ outline, activeOffset, onSelect }: OutlinePanelProps) {
  return (
    <nav className="forge-outline" aria-label="Story outline">
      <div className="forge-outline-title">Outline</div>
      {outline.length === 0 ? (
        <p className="forge-outline-empty">No knots yet.</p>
      ) : (
        <OutlineList
          entries={outline}
          all={outline}
          activeOffset={activeOffset}
          onSelect={onSelect}
        />
      )}
    </nav>
  );
}
