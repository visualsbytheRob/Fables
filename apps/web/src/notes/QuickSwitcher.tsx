/**
 * Quick switcher (F176): Cmd/Ctrl-P fuzzy jump to any note, reusing the
 * palette's fuzzy matcher + styling.
 */
import { useEffect, useMemo, useState } from 'react';
import { fuzzyMatch } from '@fables/ui';
import { notesApi, type Note } from '../api/client.js';
import { useQuery } from '@tanstack/react-query';

export function useAllNotesIndex(enabled: boolean) {
  return useQuery({
    queryKey: ['notes', 'switcher-index'],
    queryFn: () => notesApi.list({ limit: 200 }),
    enabled,
    staleTime: 10_000,
  });
}

export function QuickSwitcher({ onOpen }: { onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const index = useAllNotesIndex(open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p' && !e.shiftKey) {
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

  const matches = useMemo(() => {
    const notes = index.data?.data ?? [];
    if (query.trim() === '') return notes.slice(0, 12);
    return notes
      .filter((n: Note) => fuzzyMatch(query, `${n.title} ${n.body.slice(0, 200)}`))
      .slice(0, 12);
  }, [index.data, query]);

  if (!open) return null;

  const pick = (note: Note | undefined) => {
    if (!note) return;
    setOpen(false);
    onOpen(note.id);
  };

  return (
    <div className="ui-palette" onClick={() => setOpen(false)}>
      <div
        className="ui-palette__panel"
        role="dialog"
        aria-label="Quick switcher"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="ui-palette__input"
          placeholder="Jump to note…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, matches.length - 1));
            if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0));
            if (e.key === 'Enter') pick(matches[cursor]);
          }}
        />
        <div className="ui-palette__list" role="listbox">
          {matches.map((note, i) => (
            <div
              key={note.id}
              className="ui-palette__item"
              role="option"
              aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(note)}
            >
              {note.title || 'Untitled'}
            </div>
          ))}
          {matches.length === 0 && <div className="ui-palette__item">No notes found</div>}
        </div>
      </div>
    </div>
  );
}
