/** 409 conflict resolution (F182): reload the server copy or overwrite with local edits. */
import { Button, Dialog } from '@fables/ui';
import type { NoteWithTags } from '../api/client.js';
import { relativeTime, snippet } from './text.js';

export function ConflictDialog({
  conflict,
  onTheirs,
  onMine,
}: {
  conflict: NoteWithTags | null;
  onTheirs: () => void;
  onMine: () => void;
}) {
  return (
    <Dialog open={conflict !== null} onClose={onTheirs}>
      <div className="ui-stack" style={{ maxWidth: 420 }}>
        <h3 style={{ margin: 0 }}>Note changed elsewhere</h3>
        <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
          This note was updated {conflict ? relativeTime(conflict.updatedAt) : ''} ago (rev{' '}
          {conflict?.rev}) while you were editing. Server copy starts:
        </p>
        {conflict && (
          <blockquote className="conflict__quote">{snippet(conflict.body, 160)}</blockquote>
        )}
        <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onTheirs}>Reload theirs</Button>
          <Button variant="danger" onClick={onMine}>
            Keep mine
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
