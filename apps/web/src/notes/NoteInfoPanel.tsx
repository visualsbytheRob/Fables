/** Note info panel (F197): dates, counts, tags, backlinks stub (graph lands Day 3). */
import { Dialog } from '@fables/ui';
import type { NoteWithTags } from '../api/client.js';
import { readingTimeMinutes, wordCount } from './text.js';

export function NoteInfoPanel({
  note,
  body,
  open,
  onClose,
}: {
  note: NoteWithTags;
  body: string;
  open: boolean;
  onClose: () => void;
}) {
  const words = wordCount(body);
  return (
    <Dialog open={open} onClose={onClose}>
      <div className="ui-stack" style={{ minWidth: 300 }}>
        <h3 style={{ margin: 0 }}>{note.title || 'Untitled'}</h3>
        <dl className="info-grid">
          <dt>Created</dt>
          <dd>{new Date(note.createdAt).toLocaleString()}</dd>
          <dt>Updated</dt>
          <dd>{new Date(note.updatedAt).toLocaleString()}</dd>
          <dt>Revision</dt>
          <dd>{note.rev}</dd>
          <dt>Words</dt>
          <dd>{words}</dd>
          <dt>Characters</dt>
          <dd>{body.length}</dd>
          <dt>Reading time</dt>
          <dd>{readingTimeMinutes(body)} min</dd>
          <dt>Tags</dt>
          <dd>{note.tags.length > 0 ? note.tags.map((t) => `#${t.name}`).join(' ') : '—'}</dd>
          <dt>Backlinks</dt>
          <dd>Coming with the graph (Day 3)</dd>
        </dl>
      </div>
    </Dialog>
  );
}
