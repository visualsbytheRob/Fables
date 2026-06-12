/**
 * FQL results rendered as a note list (F278): the notes-pane list swaps to
 * this while a query is active. Rows mirror the standard list (title,
 * snippet, relative time, tag chips) and open the note on click.
 */
import { Pin } from '@fables/ui';
import type { Note } from '../api/client.js';
import { extractHashtags, relativeTime, snippet } from '../notes/text.js';

export interface QueryResultsListProps {
  notes: Note[];
  selectedNoteId: string | null;
  onOpen: (id: string) => void;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function QueryResultsList({
  notes,
  selectedNoteId,
  onOpen,
  isLoading,
  hasMore,
  onLoadMore,
}: QueryResultsListProps) {
  return (
    <div className="note-list" data-testid="query-results">
      <div className="note-list__section">
        Query results · {notes.length}
        {hasMore ? '+' : ''}
      </div>
      <div className="note-list__scroll">
        {notes.map((note) => (
          <div
            key={note.id}
            role="button"
            tabIndex={0}
            className={`note-row${note.id === selectedNoteId ? ' note-row--active' : ''}`}
            onClick={() => onOpen(note.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onOpen(note.id);
            }}
          >
            <div className="note-row__main">
              <div className="note-row__title">
                {note.pinned && <Pin size={11} aria-label="Pinned" />}
                {note.title || 'Untitled'}
              </div>
              <div className="note-row__snippet">{snippet(note.body)}</div>
              <div className="note-row__meta">
                <span>{relativeTime(note.updatedAt)}</span>
                {extractHashtags(note.body)
                  .slice(0, 3)
                  .map((tag) => (
                    <span key={tag} className="note-row__tag">
                      #{tag}
                    </span>
                  ))}
              </div>
            </div>
          </div>
        ))}
        {!isLoading && notes.length === 0 && (
          <div className="note-list__empty">No notes match this query.</div>
        )}
        {hasMore && (
          <button type="button" className="fql-results__more" onClick={onLoadMore}>
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
