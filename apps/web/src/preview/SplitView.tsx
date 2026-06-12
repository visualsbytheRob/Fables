/**
 * SplitView (F139): editor | preview side by side with proportional synced
 * scrolling. On phone widths (≤720px) it falls back to Write/Preview tabs;
 * both panes stay mounted so editor state survives tab switches.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Eye, Pencil } from '@fables/ui';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export interface SplitViewProps {
  editor: ReactNode;
  preview: ReactNode;
}

export function SplitView({ editor, preview }: SplitViewProps) {
  const phone = useMediaQuery('(max-width: 720px)');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phone) return;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    let lock: 'left' | 'right' | null = null;
    let release = 0;
    const holdLock = (side: 'left' | 'right') => {
      lock = side;
      clearTimeout(release);
      release = window.setTimeout(() => {
        lock = null;
      }, 80);
    };
    const sync = (from: HTMLElement, to: HTMLElement) => {
      const fromMax = from.scrollHeight - from.clientHeight;
      const toMax = to.scrollHeight - to.clientHeight;
      if (fromMax <= 0 || toMax <= 0) return;
      to.scrollTop = (from.scrollTop / fromMax) * toMax;
    };
    // The editor's real scroll container is CodeMirror's .cm-scroller; resolve
    // it lazily since CodeMirror mounts after the first render.
    const leftScroller = () => left.querySelector<HTMLElement>('.cm-scroller') ?? left;
    // Scroll events don't bubble, but capture-phase listeners on ancestors fire.
    const onLeft = (event: Event) => {
      if (lock === 'right') return;
      holdLock('left');
      sync(event.target as HTMLElement, right);
    };
    const onRight = () => {
      if (lock === 'left') return;
      holdLock('right');
      sync(right, leftScroller());
    };
    left.addEventListener('scroll', onLeft, true);
    right.addEventListener('scroll', onRight);
    return () => {
      left.removeEventListener('scroll', onLeft, true);
      right.removeEventListener('scroll', onRight);
      clearTimeout(release);
    };
  }, [phone]);

  return (
    <div className={`md-split${phone ? ` md-split--tab-${tab}` : ''}`}>
      {phone && (
        <div className="md-split__tabs" role="tablist" aria-label="Editor view">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'write'}
            onClick={() => setTab('write')}
          >
            <Pencil size={14} /> Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'preview'}
            onClick={() => setTab('preview')}
          >
            <Eye size={14} /> Preview
          </button>
        </div>
      )}
      <div ref={leftRef} className="md-split__pane md-split__pane--editor">
        {editor}
      </div>
      <div ref={rightRef} className="md-split__pane md-split__pane--preview">
        {preview}
      </div>
    </div>
  );
}
