/**
 * Live ```fql embed block (F283–F285, F289): renders query results inside the
 * markdown preview in list, table, or count mode (a `mode:` directive on the
 * first block line), with a manual refresh control over a TanStack Query
 * cache. Result counts are capped and nested embeds beyond depth 1 never
 * render (recursion guard) — see MarkdownPreview for the depth cut-off.
 */
import type { ReactNode } from 'react';
import { RefreshCw } from '@fables/ui';
import type { Note } from '../api/client.js';
import { useFqlEmbed } from '../api/hooks.js';
import { relativeTime } from '../notes/text.js';
import { parseEmbedBlock } from '../query/fql.js';

/** How an embed interacts with the surrounding app. */
export interface QueryEmbedHandlers {
  /** Open a result note (row / title click). */
  onOpenNote: (noteId: string) => void;
}

/** Body excerpt rendered as nested markdown at depth+1 (recursion-guarded). */
const EXCERPT_CHARS = 280;

export interface QueryEmbedProps {
  /** Raw content of the fenced block (directives + query). */
  content: string;
  handlers: QueryEmbedHandlers;
  /** Renders a result-note body excerpt at the next embed depth. */
  renderNoteBody?: (body: string) => ReactNode;
}

export function QueryEmbed({ content, handlers, renderNoteBody }: QueryEmbedProps) {
  const block = parseEmbedBlock(content);
  const result = useFqlEmbed(block.query, block.limit, block.query !== '');

  if (block.query === '') {
    return <div className="fql-embed fql-embed--error">Empty fql block — write a query.</div>;
  }

  const notes: Note[] = (result.data?.data ?? []).slice(0, block.limit);
  const warnings = [...block.errors, ...(result.data?.warnings ?? [])];

  return (
    <div className="fql-embed" data-mode={block.mode}>
      <div className="fql-embed__head">
        <code className="fql-embed__query" title={block.query}>
          {block.query}
        </code>
        <span className="fql-embed__meta">
          {result.isFetching
            ? 'Refreshing…'
            : result.dataUpdatedAt > 0
              ? `Updated ${relativeTime(new Date(result.dataUpdatedAt).toISOString())}`
              : ''}
        </span>
        <button
          type="button"
          className="fql-embed__refresh"
          aria-label="Refresh query results"
          title="Refresh results"
          onClick={() => void result.refetch()}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {warnings.map((w) => (
        <div key={w} className="fql-embed__warning" role="status">
          {w}
        </div>
      ))}

      {result.isError && (
        <div className="fql-embed--error" role="alert">
          Query failed: {result.error.message}
        </div>
      )}

      {result.isLoading && <div className="fql-embed__loading">Running query…</div>}

      {result.isSuccess && block.mode === 'count' && (
        <div className="fql-embed__count">
          <strong>{notes.length}</strong>
          <span>
            note{notes.length === 1 ? '' : 's'}
            {result.data.page.nextCursor !== null || result.data.data.length > notes.length
              ? ' (capped)'
              : ''}
          </span>
        </div>
      )}

      {result.isSuccess && block.mode === 'table' && (
        <table className="fql-embed__table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Updated</th>
              <th>Pinned</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((note) => (
              <tr key={note.id}>
                <td>
                  <button
                    type="button"
                    className="fql-embed__link"
                    onClick={() => handlers.onOpenNote(note.id)}
                  >
                    {note.title || 'Untitled'}
                  </button>
                </td>
                <td>{relativeTime(note.updatedAt)}</td>
                <td>{note.pinned ? 'Yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {result.isSuccess && block.mode === 'list' && (
        <ul className="fql-embed__list">
          {notes.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className="fql-embed__link"
                onClick={() => handlers.onOpenNote(note.id)}
              >
                {note.title || 'Untitled'}
              </button>
              {renderNoteBody && note.body.trim() !== '' && (
                <div className="fql-embed__excerpt">
                  {renderNoteBody(note.body.slice(0, EXCERPT_CHARS))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {result.isSuccess && notes.length === 0 && block.mode !== 'count' && (
        <div className="fql-embed__empty">No notes match.</div>
      )}
    </div>
  );
}
