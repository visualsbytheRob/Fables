/**
 * Templates v1 (F261–F267, F269): notes in the "Templates" notebook are
 * templates. The picker previews the selected template, asks for
 * {{prompt:Name}} answers at instantiation, supports insert-at-cursor mode,
 * remembers a default template per notebook, and can seed the starter
 * entity/scene templates.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Input, useToast } from '@fables/ui';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { notebooksApi, notesApi, type Note, type NotebookTreeNode } from '../api/client.js';
import { useCreateNote, useInvalidateNotes } from '../api/hooks.js';
import { MarkdownPreview } from '../preview/MarkdownPreview.js';
import { builtinTemplates } from '../templates/builtins.js';
import { extractPromptVars, renderTemplate } from '../templates/variables.js';
import { allNodes } from './notebookTreeModel.js';
import { loadDefaultTemplates, saveDefaultTemplate } from './prefs.js';

export function findTemplatesNotebook(roots: NotebookTreeNode[]): NotebookTreeNode | null {
  return allNodes(roots).find((n) => n.name.toLowerCase() === 'templates') ?? null;
}

export interface TemplatePickerProps {
  open: boolean;
  roots: NotebookTreeNode[];
  /** Notebook a new note lands in (create mode) / default-template scope. */
  targetNotebookId: string;
  /** 'create' makes a new note; 'insert' hands rendered text back (F264). */
  mode?: 'create' | 'insert';
  /** Value for {{title}} in insert mode (the open note's title). */
  noteTitle?: string;
  onCreated?: (noteId: string) => void;
  onInsert?: (text: string, cursorOffset: number | null) => void;
  onClose: () => void;
}

export function TemplatePicker({
  open,
  roots,
  targetNotebookId,
  mode = 'create',
  noteTitle,
  onCreated,
  onInsert,
  onClose,
}: TemplatePickerProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const createNote = useCreateNote();
  const invalidate = useInvalidateNotes();
  const templatesNotebook = findTemplatesNotebook(roots);
  const templates = useQuery({
    queryKey: ['notes', 'templates', templatesNotebook?.id ?? 'none'],
    queryFn: () => notesApi.list({ notebookId: templatesNotebook!.id, limit: 200 }),
    enabled: open && templatesNotebook !== null,
  });

  const list = useMemo(() => templates.data?.data ?? [], [templates.data]);
  const defaultId = loadDefaultTemplates()[targetNotebookId] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<{
    names: string[];
    values: Record<string, string>;
  } | null>(null);
  const [seeding, setSeeding] = useState(false);

  // Preselect the notebook's default template whenever the dialog opens (F269).
  useEffect(() => {
    if (open) {
      setSelectedId(defaultId);
      setPrompts(null);
    }
  }, [open]);

  const selected = list.find((t) => t.id === selectedId) ?? null;

  const instantiate = (tpl: Note, answers: Record<string, string>) => {
    if (mode === 'insert') {
      const rendered = renderTemplate(tpl.body, {
        title: noteTitle ?? '',
        prompts: answers,
      });
      onClose();
      onInsert?.(rendered.text, rendered.cursorOffset);
      return;
    }
    const titleRendered = renderTemplate(tpl.title, { prompts: answers }).text;
    const bodyRendered = renderTemplate(tpl.body, { title: titleRendered, prompts: answers });
    createNote.mutate(
      { notebookId: targetNotebookId, title: titleRendered, body: bodyRendered.text },
      {
        onSuccess: (note) => {
          toast(`Created from “${tpl.title || 'Untitled'}”`);
          onClose();
          onCreated?.(note.id);
        },
        onError: (err) => toast(`Create failed: ${err.message}`, 'error'),
      },
    );
  };

  const applyTemplate = (tpl: Note) => {
    const names = extractPromptVars(`${tpl.title}\n${tpl.body}`);
    if (names.length === 0) {
      instantiate(tpl, {});
      return;
    }
    setPrompts({ names, values: Object.fromEntries(names.map((n) => [n, ''])) });
  };

  // Seed starter entity/scene templates, creating the notebook if missing (F265/F266).
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
          : 'Starter templates already present',
      );
    } catch (error) {
      toast(`Seeding failed: ${(error as Error).message}`, 'error');
    } finally {
      setSeeding(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="ui-stack template-picker" style={{ minWidth: 340 }}>
        <h3 style={{ margin: 0 }}>
          {mode === 'insert' ? 'Insert template at cursor' : 'New note from template'}
        </h3>

        {prompts === null && (
          <>
            {!templatesNotebook && (
              <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
                Create a notebook named “Templates” and add notes to it — they show up here.
              </p>
            )}
            <div className="template-picker__cols">
              <div className="template-picker__list">
                {list.map((tpl) => (
                  <div
                    key={tpl.id}
                    className={`template-picker__row${
                      tpl.id === selectedId ? ' template-picker__row--active' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="ui-menu__item template-picker__name"
                      onClick={() => setSelectedId(tpl.id)}
                      onDoubleClick={() => applyTemplate(tpl)}
                    >
                      {tpl.title || 'Untitled'}
                      {tpl.id === defaultId && <span title="Default for this notebook"> ★</span>}
                    </button>
                  </div>
                ))}
                {templatesNotebook && list.length === 0 && !templates.isPending && (
                  <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
                    The Templates notebook is empty.
                  </p>
                )}
              </div>
              {selected && (
                <div className="template-picker__preview" aria-label="Template preview">
                  <MarkdownPreview source={selected.body} />
                </div>
              )}
            </div>
            <div className="ui-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div className="ui-row">
                <Button disabled={seeding} onClick={() => void seed()}>
                  {seeding ? 'Seeding…' : 'Add starter templates'}
                </Button>
                <Button
                  onClick={() => {
                    onClose();
                    navigate('/templates');
                  }}
                >
                  Manage
                </Button>
              </div>
              <div className="ui-row">
                {selected && mode === 'create' && (
                  <Button
                    onClick={() => {
                      const next = selected.id === defaultId ? null : selected.id;
                      saveDefaultTemplate(targetNotebookId, next);
                      toast(next ? 'Default template set' : 'Default template cleared');
                      setSelectedId(selected.id); // re-render with new star
                    }}
                  >
                    {selected.id === defaultId ? 'Unset default' : 'Set as default'}
                  </Button>
                )}
                {selected && (
                  <Button variant="primary" onClick={() => applyTemplate(selected)}>
                    {mode === 'insert' ? 'Insert' : 'Create note'}
                  </Button>
                )}
                <Button onClick={onClose}>Close</Button>
              </div>
            </div>
          </>
        )}

        {prompts !== null && selected && (
          <form
            className="ui-stack"
            onSubmit={(e) => {
              e.preventDefault();
              instantiate(selected, prompts.values);
            }}
          >
            <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
              “{selected.title || 'Untitled'}” asks for:
            </p>
            {prompts.names.map((name, i) => (
              <label key={name} className="ui-stack" style={{ gap: 'var(--space-1)' }}>
                <span style={{ fontSize: 'var(--text-sm)' }}>{name}</span>
                <Input
                  autoFocus={i === 0}
                  value={prompts.values[name] ?? ''}
                  onChange={(e) =>
                    setPrompts((p) =>
                      p ? { ...p, values: { ...p.values, [name]: e.target.value } } : p,
                    )
                  }
                />
              </label>
            ))}
            <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
              <Button type="button" onClick={() => setPrompts(null)}>
                Back
              </Button>
              <Button type="submit" variant="primary">
                {mode === 'insert' ? 'Insert' : 'Create note'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
