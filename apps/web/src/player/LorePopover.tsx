/**
 * Lore popover (F622/F625): opening a `[[note]]` lore link shows the referenced
 * note's body inline, without leaving the story. The preview is depth-capped —
 * a lore note may itself contain `[[refs]]`, and those render as plain links so
 * a reader can't tunnel arbitrarily deep (and embeds never run, F289). A note
 * deleted since the story compiled resolves to nothing and the popover shows an
 * inert "no longer available" message (stale-reference handling, F625).
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { notesApi, type Note } from '../api/client.js';
import { MarkdownPreview } from '../preview/MarkdownPreview.js';

/** How many nested lore popovers deep a reader may go before refs go inert. */
export const MAX_LORE_DEPTH = 2;

/** Resolve a `[[title]]` to a note id from a title→id index (case-insensitive). */
export function resolveLoreTitle(
  title: string,
  index: ReadonlyMap<string, string>,
): string | null {
  return index.get(title.trim().toLowerCase()) ?? null;
}

export function LorePopover({
  title,
  noteId,
  depth,
  onOpenLore,
  onClose,
}: {
  title: string;
  /** Resolved note id, or null when the note was deleted post-compile (F625). */
  noteId: string | null;
  depth: number;
  /** Open a nested lore note by title (depth-capped by the caller). */
  onOpenLore: (title: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const noteQuery = useQuery<Note>({
    queryKey: ['note', noteId ?? 'none'],
    queryFn: () => notesApi.get(noteId as string),
    enabled: noteId !== null,
  });

  const atDepthCap = depth >= MAX_LORE_DEPTH;

  return (
    <div
      className="lore-popover-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="lore-popover"
        role="dialog"
        aria-modal="true"
        aria-label={`Lore: ${title}`}
        tabIndex={-1}
        data-testid="lore-popover"
      >
        <div className="lore-popover-head">
          <strong style={{ flex: 1 }}>{title}</strong>
          <button className="player-iconbtn" onClick={onClose} aria-label="Close lore">
            ✕
          </button>
        </div>

        {noteId === null ? (
          <p className="lore-popover-stale" role="note">
            This lore note is no longer available — it may have been deleted since the story was
            written.
          </p>
        ) : noteQuery.isLoading ? (
          <p className="lore-popover-loading">Loading…</p>
        ) : noteQuery.data === undefined ? (
          <p className="lore-popover-stale" role="note">
            This lore note could not be loaded.
          </p>
        ) : (
          <div className="lore-popover-body">
            <MarkdownPreview
              source={noteQuery.data.body}
              embedDepth={1}
              {...(atDepthCap
                ? {}
                : {
                    wikilinks: {
                      // Within the popover, refs open a *nested* lore popover
                      // rather than navigating away from the story. We treat
                      // every ref as "resolvable" so it renders as a live link;
                      // the nested popover itself handles a missing target.
                      resolve: () => 'lore',
                      onNavigate: (_id, link) => onOpenLore(link.target),
                      onCreate: (target) => onOpenLore(target),
                    },
                  })}
            />
            {!atDepthCap ? (
              <p className="lore-popover-hint">
                Tap a <span className="wikilink">[[link]]</span> above to dig deeper.
              </p>
            ) : (
              <p className="lore-popover-hint">You've reached the bottom of this thread.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
