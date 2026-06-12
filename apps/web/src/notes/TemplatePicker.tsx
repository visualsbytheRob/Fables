/**
 * Templates v0 (F192): notes living in a notebook named "Templates" become
 * templates; the picker creates a new note from one into the target notebook.
 */
import { Button, Dialog, useToast } from '@fables/ui';
import { useQuery } from '@tanstack/react-query';
import { notesApi, type NotebookTreeNode } from '../api/client.js';
import { useCreateNote } from '../api/hooks.js';
import { allNodes } from './notebookTreeModel.js';
import { snippet } from './text.js';

export function findTemplatesNotebook(roots: NotebookTreeNode[]): NotebookTreeNode | null {
  return allNodes(roots).find((n) => n.name.toLowerCase() === 'templates') ?? null;
}

export function TemplatePicker({
  open,
  roots,
  targetNotebookId,
  onCreated,
  onClose,
}: {
  open: boolean;
  roots: NotebookTreeNode[];
  targetNotebookId: string;
  onCreated: (noteId: string) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const createNote = useCreateNote();
  const templatesNotebook = findTemplatesNotebook(roots);
  const templates = useQuery({
    queryKey: ['notes', 'templates', templatesNotebook?.id ?? 'none'],
    queryFn: () => notesApi.list({ notebookId: templatesNotebook!.id, limit: 100 }),
    enabled: open && templatesNotebook !== null,
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="ui-stack" style={{ minWidth: 340 }}>
        <h3 style={{ margin: 0 }}>New note from template</h3>
        {!templatesNotebook && (
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
            Create a notebook named “Templates” and add notes to it — they show up here.
          </p>
        )}
        {(templates.data?.data ?? []).map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            className="ui-menu__item"
            onClick={() =>
              createNote.mutate(
                { notebookId: targetNotebookId, title: tpl.title, body: tpl.body },
                {
                  onSuccess: (note) => {
                    toast(`Created from “${tpl.title || 'Untitled'}”`);
                    onClose();
                    onCreated(note.id);
                  },
                  onError: (err) => toast(`Create failed: ${err.message}`, 'error'),
                },
              )
            }
          >
            <span className="ui-stack" style={{ gap: 0, alignItems: 'flex-start' }}>
              <strong>{tpl.title || 'Untitled'}</strong>
              <span style={{ color: 'var(--text-dim)', fontSize: 'var(--text-xs)' }}>
                {snippet(tpl.body, 60)}
              </span>
            </span>
          </button>
        ))}
        {templatesNotebook && (templates.data?.data ?? []).length === 0 && !templates.isPending && (
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
            The Templates notebook is empty.
          </p>
        )}
        <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
