/** Notebook create/rename (F141/F144), move (F142), and delete-with-rehome (F149) dialogs. */
import { useEffect, useState } from 'react';
import { Button, Dialog, Input, Select } from '@fables/ui';
import type { NotebookTreeNode } from '../api/client.js';
import { allNodes, validParents } from './notebookTreeModel.js';

export const NOTEBOOK_COLORS = [
  { id: '', label: 'None' },
  { id: '#b08fff', label: 'Violet' },
  { id: '#82aaff', label: 'Blue' },
  { id: '#a5d6a7', label: 'Green' },
  { id: '#ffcb6b', label: 'Amber' },
  { id: '#ff7878', label: 'Red' },
];

export interface NotebookFormValue {
  name: string;
  icon: string | null;
  color: string | null;
}

export function NotebookEditDialog({
  open,
  title,
  initial,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial: NotebookFormValue;
  onSubmit: (value: NotebookFormValue) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon ?? '');
  const [color, setColor] = useState(initial.color ?? '');

  useEffect(() => {
    if (open) {
      setName(initial.name);
      setIcon(initial.icon ?? '');
      setColor(initial.color ?? '');
    }
  }, [open, initial.name, initial.icon, initial.color]);

  return (
    <Dialog open={open} onClose={onClose}>
      <form
        className="ui-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() === '') return;
          onSubmit({ name: name.trim(), icon: icon.trim() || null, color: color || null });
        }}
      >
        <h3 style={{ margin: 0 }}>{title}</h3>
        <label className="ui-stack" style={{ gap: 'var(--space-1)' }}>
          Name
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <div className="ui-row">
          <label className="ui-stack" style={{ gap: 'var(--space-1)' }}>
            Icon (emoji)
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="📓"
              maxLength={8}
              style={{ width: 90 }}
            />
          </label>
          <label className="ui-stack" style={{ gap: 'var(--space-1)' }}>
            Color
            <Select value={color} onChange={(e) => setColor(e.target.value)}>
              {NOTEBOOK_COLORS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function NotebookMoveDialog({
  open,
  roots,
  notebookId,
  onSubmit,
  onClose,
}: {
  open: boolean;
  roots: NotebookTreeNode[];
  notebookId: string | null;
  onSubmit: (parentId: string | null) => void;
  onClose: () => void;
}) {
  const [parentId, setParentId] = useState('');
  const targets = notebookId === null ? [] : validParents(roots, notebookId);

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="ui-stack">
        <h3 style={{ margin: 0 }}>Move notebook</h3>
        <label className="ui-stack" style={{ gap: 'var(--space-1)' }}>
          New parent
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">(top level)</option>
            {targets
              .filter((t) => t.id !== notebookId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </Select>
        </label>
        <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSubmit(parentId === '' ? null : parentId)}>
            Move
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function NotebookDeleteDialog({
  open,
  roots,
  notebook,
  onSubmit,
  onClose,
}: {
  open: boolean;
  roots: NotebookTreeNode[];
  notebook: NotebookTreeNode | null;
  onSubmit: (moveNotesTo: string | undefined) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState('');
  const others = notebook ? allNodes(roots).filter((n) => n.id !== notebook.id) : [];
  const hasNotes = (notebook?.noteCount ?? 0) > 0;

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="ui-stack">
        <h3 style={{ margin: 0 }}>Delete “{notebook?.name}”?</h3>
        {hasNotes ? (
          <>
            <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
              It contains {notebook?.noteCount} note{notebook?.noteCount === 1 ? '' : 's'}. Where
              should they go?
            </p>
            <Select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Move notes to"
            >
              <option value="">Choose a notebook…</option>
              {others.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </Select>
          </>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
            The notebook is empty; this cannot be undone.
          </p>
        )}
        <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={hasNotes && target === ''}
            onClick={() => onSubmit(hasNotes ? target : undefined)}
          >
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
