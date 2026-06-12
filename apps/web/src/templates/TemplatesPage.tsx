/**
 * Template management (F269): templates are plain notes in the Templates
 * notebook, so manage = a filtered list with edit / duplicate / trash
 * actions plus the starter-template seeder.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Copy, Pencil, Trash2, useToast } from '@fables/ui';
import { useQuery } from '@tanstack/react-query';
import { notebooksApi, notesApi } from '../api/client.js';
import {
  useDeleteNote,
  useDuplicateNote,
  useInvalidateNotes,
  useNotebookTree,
} from '../api/hooks.js';
import { Skeleton } from '../components/Skeleton.js';
import { findTemplatesNotebook } from '../notes/TemplatePicker.js';
import { extractPromptVars } from './variables.js';
import { builtinTemplates } from './builtins.js';
import { relativeTime, snippet } from '../notes/text.js';

export function TemplatesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const tree = useNotebookTree();
  const invalidate = useInvalidateNotes();
  const duplicateNote = useDuplicateNote();
  const deleteNote = useDeleteNote();
  const [seeding, setSeeding] = useState(false);

  const templatesNotebook = findTemplatesNotebook(tree.data ?? []);
  const templates = useQuery({
    queryKey: ['notes', 'templates', templatesNotebook?.id ?? 'none'],
    queryFn: () => notesApi.list({ notebookId: templatesNotebook!.id, limit: 200 }),
    enabled: templatesNotebook !== null,
  });

  const seed = async () => {
    setSeeding(true);
    try {
      const notebookId =
        templatesNotebook?.id ?? (await notebooksApi.create({ name: 'Templates' })).id;
      const existing = new Set(
        (await notesApi.list({ notebookId, limit: 200 })).data.map((n) =>
          n.title.trim().toLowerCase(),
        ),
      );
      let added = 0;
      for (const tpl of builtinTemplates) {
        if (existing.has(tpl.title.toLowerCase())) continue;
        await notesApi.create({ notebookId, title: tpl.title, body: tpl.body });
        added += 1;
      }
      invalidate();
      toast(
        added > 0
          ? `Added ${added} starter template${added === 1 ? '' : 's'}`
          : 'All starter templates already exist',
      );
    } catch (error) {
      toast(`Seeding failed: ${(error as Error).message}`, 'error');
    } finally {
      setSeeding(false);
    }
  };

  const list = templates.data?.data ?? [];

  return (
    <div className="ui-stack" style={{ maxWidth: 720 }}>
      <div className="ui-row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Templates</h1>
        <Button disabled={seeding} onClick={() => void seed()}>
          {seeding ? 'Seeding…' : 'Add starter templates'}
        </Button>
      </div>
      <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
        Templates are plain notes in the “Templates” notebook. Variables: <code>{'{{date}}'}</code>,{' '}
        <code>{'{{time}}'}</code>, <code>{'{{title}}'}</code>, <code>{'{{cursor}}'}</code>,{' '}
        <code>{'{{prompt:Name}}'}</code>.
      </p>

      {tree.isPending && <Skeleton height={160} />}
      {!tree.isPending && !templatesNotebook && (
        <p style={{ color: 'var(--text-dim)' }}>
          No Templates notebook yet — seed the starters to create one.
        </p>
      )}

      {list.map((tpl) => {
        const promptVars = extractPromptVars(`${tpl.title}\n${tpl.body}`);
        return (
          <div key={tpl.id} className="template-manage__row">
            <div className="template-manage__info">
              <strong>{tpl.title || 'Untitled'}</strong>
              <span style={{ color: 'var(--text-dim)', fontSize: 'var(--text-xs)' }}>
                {snippet(tpl.body, 70)}
                {promptVars.length > 0 ? ` · asks: ${promptVars.join(', ')}` : ''} ·{' '}
                {relativeTime(tpl.updatedAt)}
              </span>
            </div>
            <div className="ui-row" style={{ gap: 'var(--space-1)' }}>
              <Button
                aria-label={`Edit ${tpl.title || 'Untitled'}`}
                title="Edit"
                onClick={() => navigate(`/notes/${tpl.id}`)}
              >
                <Pencil size={14} />
              </Button>
              <Button
                aria-label={`Duplicate ${tpl.title || 'Untitled'}`}
                title="Duplicate"
                onClick={() =>
                  duplicateNote.mutate(tpl.id, {
                    onSuccess: () => toast('Template duplicated'),
                    onError: (err) => toast(`Duplicate failed: ${err.message}`, 'error'),
                  })
                }
              >
                <Copy size={14} />
              </Button>
              <Button
                aria-label={`Trash ${tpl.title || 'Untitled'}`}
                title="Move to trash"
                onClick={() =>
                  deleteNote.mutate(tpl.id, {
                    onSuccess: () => toast('Template moved to trash'),
                    onError: (err) => toast(`Delete failed: ${err.message}`, 'error'),
                  })
                }
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        );
      })}
      {templatesNotebook && list.length === 0 && !templates.isPending && (
        <p style={{ color: 'var(--text-dim)' }}>The Templates notebook is empty.</p>
      )}
    </div>
  );
}
