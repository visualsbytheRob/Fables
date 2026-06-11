import { useEffect, useMemo, useState } from 'react';

export interface PaletteCommand {
  id: string;
  label: string;
  keywords?: string;
  run: () => void;
}

/** Subsequence fuzzy match: every query char must appear in order. */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let ti = 0;
  for (const ch of q) {
    ti = t.indexOf(ch, ti);
    if (ti === -1) return false;
    ti += 1;
  }
  return true;
}

export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  if (!query.trim()) return commands;
  return commands.filter((c) => fuzzyMatch(query, `${c.label} ${c.keywords ?? ''}`));
}

export function CommandPalette({ commands }: { commands: PaletteCommand[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const matches = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setCursor(0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  const select = (cmd: PaletteCommand | undefined) => {
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  };

  return (
    <div className="ui-palette" onClick={() => setOpen(false)}>
      <div
        className="ui-palette__panel"
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="ui-palette__input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, matches.length - 1));
            if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0));
            if (e.key === 'Enter') select(matches[cursor]);
          }}
        />
        <div className="ui-palette__list" role="listbox">
          {matches.map((cmd, i) => (
            <div
              key={cmd.id}
              className="ui-palette__item"
              role="option"
              aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => select(cmd)}
            >
              {cmd.label}
            </div>
          ))}
          {matches.length === 0 && <div className="ui-palette__item">No matches</div>}
        </div>
      </div>
    </div>
  );
}
