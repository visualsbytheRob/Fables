/**
 * In-note find bar (F714): ⌘F / Ctrl+F opens a floating bar that highlights
 * all matches in the current note body and lets the user cycle through them.
 * The parent mounts this and controls open state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ChevronLeft, Search, X } from '@fables/ui';
import './innotefind.css';

export interface InNoteFindProps {
  /** The full note body text to search in. */
  body: string;
  open: boolean;
  onClose: () => void;
  /** Called with the character offset of the currently highlighted match. */
  onMatchChange?: (offset: number | null) => void;
}

export function findMatches(body: string, query: string): number[] {
  if (!query.trim()) return [];
  const positions: number[] = [];
  const lBody = body.toLowerCase();
  const lQ = query.toLowerCase();
  let i = 0;
  while (i <= lBody.length - lQ.length) {
    const idx = lBody.indexOf(lQ, i);
    if (idx === -1) break;
    positions.push(idx);
    i = idx + 1;
  }
  return positions;
}

export function InNoteFind({ body, open, onClose, onMatchChange }: InNoteFindProps) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = query.trim() ? findMatches(body, query) : [];
  const total = matches.length;

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Report current match position
  useEffect(() => {
    if (!onMatchChange) return;
    if (total === 0) {
      onMatchChange(null);
    } else {
      onMatchChange(matches[cursor % total] ?? null);
    }
  }, [cursor, total, query, onMatchChange, matches]);

  const next = useCallback(() => {
    if (total === 0) return;
    setCursor((c) => (c + 1) % total);
  }, [total]);

  const prev = useCallback(() => {
    if (total === 0) return;
    setCursor((c) => (c - 1 + total) % total);
  }, [total]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
      } else if (e.key === 'g' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, next, prev]);

  if (!open) return null;

  return (
    <div className="in-note-find" role="search" aria-label="Find in note">
      <Search size={14} className="in-note-find__icon" />
      <input
        ref={inputRef}
        className="in-note-find__input"
        placeholder="Find in note…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
        }}
        aria-label="Find text in note"
      />
      <span className="in-note-find__count" aria-live="polite">
        {total > 0 ? `${cursor % total + 1}/${total}` : query ? '0/0' : ''}
      </span>
      <Button aria-label="Previous match" onClick={prev} disabled={total === 0}>
        <ChevronLeft size={14} />
      </Button>
      <Button aria-label="Next match" onClick={next} disabled={total === 0}>
        <ChevronLeft size={14} style={{ transform: 'rotate(180deg)' }} />
      </Button>
      <Button aria-label="Close find" onClick={onClose}>
        <X size={14} />
      </Button>
    </div>
  );
}
