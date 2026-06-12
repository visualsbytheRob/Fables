/**
 * Revision history (F183–F185): revision list, side-by-side word diff of a
 * selected revision against the newest snapshot (ops come from the server's
 * diff endpoint), and one-click restore.
 */
import { useState } from 'react';
import { Button, RotateCcw, useToast, X } from '@fables/ui';
import { revisionsApi, type DiffOp, type Note } from '../api/client.js';
import { useInvalidateNotes, useRevisionDiff, useRevisions } from '../api/hooks.js';
import { relativeTime } from './text.js';

/** Left side shows the old text (equal + del), right side the new (equal + add). */
export function diffSides(ops: DiffOp[]): { left: DiffOp[]; right: DiffOp[] } {
  return {
    left: ops.filter((op) => op.op !== 'add'),
    right: ops.filter((op) => op.op !== 'del'),
  };
}

function DiffPane({ ops, label }: { ops: DiffOp[]; label: string }) {
  return (
    <div className="history__pane">
      <div className="history__pane-label">{label}</div>
      <pre className="history__text">
        {ops.map((op, i) => (
          <span key={i} className={op.op === 'equal' ? '' : `history__${op.op}`}>
            {op.text}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function HistoryPanel({
  noteId,
  onClose,
  onRestored,
}: {
  noteId: string;
  onClose: () => void;
  onRestored: (restored: Note) => void;
}) {
  const { toast } = useToast();
  const revisions = useRevisions(noteId);
  const invalidate = useInvalidateNotes();
  const [selected, setSelected] = useState<number | null>(null);

  const list = revisions.data ?? [];
  const head = list[0]?.rev ?? null;
  const diff = useRevisionDiff(noteId, head, selected);

  const restore = async (rev: number) => {
    try {
      const restored = await revisionsApi.restore(noteId, rev);
      invalidate(noteId);
      toast(`Restored revision ${rev}`);
      onRestored(restored);
    } catch (error) {
      toast(`Restore failed: ${(error as Error).message}`, 'error');
    }
  };

  return (
    <div className="history" role="complementary" aria-label="Revision history">
      <div className="history__head">
        <strong>History</strong>
        <button
          type="button"
          className="md-editor__tool"
          aria-label="Close history"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <div className="history__list">
        {list.length === 0 && <div className="note-list__empty">No snapshots yet.</div>}
        {list.map((meta) => (
          <div
            key={meta.rev}
            className={`history__row${selected === meta.rev ? ' history__row--active' : ''}`}
          >
            <button type="button" className="history__pick" onClick={() => setSelected(meta.rev)}>
              <span>
                r{meta.rev}
                {meta.rev === head ? ' (latest)' : ''}
              </span>
              <span className="history__meta">
                {relativeTime(meta.createdAt)} · {meta.wordCount}w
              </span>
            </button>
            {meta.rev !== head && (
              <Button
                aria-label={`Restore revision ${meta.rev}`}
                title="Restore this revision"
                onClick={() => void restore(meta.rev)}
              >
                <RotateCcw size={13} />
              </Button>
            )}
          </div>
        ))}
      </div>
      {selected !== null && selected !== head && (
        <div className="history__diff">
          {diff.isPending && <div className="note-list__empty">Loading diff…</div>}
          {diff.data && (
            <div className="history__sides">
              <DiffPane ops={diffSides(diff.data.ops).left} label={`r${selected}`} />
              <DiffPane ops={diffSides(diff.data.ops).right} label={`r${head} (latest)`} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
