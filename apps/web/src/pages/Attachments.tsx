/**
 * Attachment manager (F169): every uploaded file with size, type, owning
 * note, open + delete actions.
 */
import { useMemo } from 'react';
import { Button, Paperclip, Trash2, useToast } from '@fables/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { attachmentUrl, notesApi } from '../api/client.js';
import { useAttachments, useDeleteAttachment } from '../api/hooks.js';
import { formatBytes, relativeTime } from '../notes/text.js';

export function AttachmentsPage() {
  const { toast } = useToast();
  const attachments = useAttachments();
  const deleteAttachment = useDeleteAttachment();
  const notesIndex = useQuery({
    queryKey: ['notes', 'title-index'],
    queryFn: () => notesApi.list({ limit: 200 }),
  });

  const titles = useMemo(
    () => new Map((notesIndex.data?.data ?? []).map((n) => [n.id, n.title || 'Untitled'])),
    [notesIndex.data],
  );

  const rows = attachments.data?.data ?? [];
  const total = rows.reduce((sum, a) => sum + a.size, 0);

  return (
    <div className="ui-stack">
      <h1 className="ui-row">
        <Paperclip size={22} /> Attachments
      </h1>
      <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
        {rows.length} file{rows.length === 1 ? '' : 's'} · {formatBytes(total)} total
      </p>
      {attachments.isPending && <p>Loading…</p>}
      {rows.length === 0 && !attachments.isPending && (
        <p>No attachments yet — paste or drop a file into any note.</p>
      )}
      {rows.length > 0 && (
        <table className="attachments-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Size</th>
              <th>Note</th>
              <th>Added</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  <a href={attachmentUrl(a.id)} target="_blank" rel="noreferrer">
                    {a.filename}
                  </a>
                </td>
                <td>{a.mime}</td>
                <td>{formatBytes(a.size)}</td>
                <td>
                  {a.noteId ? (
                    <Link to={`/notes/${a.noteId}`}>{titles.get(a.noteId) ?? 'Open note'}</Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{relativeTime(a.createdAt)}</td>
                <td>
                  <Button
                    aria-label={`Delete ${a.filename}`}
                    onClick={() =>
                      deleteAttachment.mutate(a.id, {
                        onSuccess: () => toast('Attachment deleted'),
                        onError: (err) => toast(`Delete failed: ${err.message}`, 'error'),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
