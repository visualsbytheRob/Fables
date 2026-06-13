/**
 * Annotation review view (F637): every annotation a reader has made in this
 * story, across playthroughs. Each row quotes the passage, shows where it was
 * struck (turn + scene), opens the backing note, and deep-links back into the
 * player at the exact turn (F635).
 */
import { useState } from 'react';
import { Highlighter } from '@fables/ui';
import { useNavigate } from 'react-router-dom';
import { Sheet } from './PlayerSheets.js';
import { loadAnnotations, removeAnnotation, type Annotation } from './annotations.js';

export function AnnotationsPanel({
  storyId,
  onOpen,
  onClose,
}: {
  storyId: string;
  /** Jump the live run to a turn (deep link resolved in-place). */
  onOpen: (turn: number) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Annotation[]>(() => loadAnnotations(storyId));

  return (
    <Sheet title="Annotations" onClose={onClose}>
      {items.length === 0 ? (
        <p style={{ color: 'var(--pl-dim)' }}>
          Select any passage while reading and tap <Highlighter size={13} /> Annotate to capture it
          as a linked note. They'll all collect here.
        </p>
      ) : (
        items.map((annotation) => (
          <div key={annotation.id} className="player-row">
            <div className="player-row-main">
              “{annotation.quote.slice(0, 80)}
              {annotation.quote.length > 80 ? '…' : ''}”
              <small>
                turn {annotation.turn}
                {annotation.scene !== '' ? ` · ${annotation.scene}` : ''} ·{' '}
                {new Date(annotation.createdAt).toLocaleDateString()}
              </small>
            </div>
            <button
              className="player-iconbtn"
              onClick={() => onOpen(annotation.turn)}
              aria-label={`Jump to turn ${annotation.turn}`}
              title="Jump to this moment"
            >
              ↩
            </button>
            <button
              className="player-iconbtn"
              onClick={() => navigate(`/notes/${annotation.noteId}`)}
              aria-label="Open the linked note"
              title="Open note"
            >
              📝
            </button>
            <button
              className="player-iconbtn"
              onClick={() => {
                removeAnnotation(storyId, annotation.id);
                setItems(loadAnnotations(storyId));
              }}
              aria-label="Delete annotation"
            >
              ✕
            </button>
          </div>
        ))
      )}
    </Sheet>
  );
}
