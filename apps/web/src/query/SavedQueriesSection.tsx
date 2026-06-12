/**
 * Saved-queries sidebar section (F282): smart folders — clicking one runs its
 * FQL in the note list. Supports save-current, rename, pin to the top bar
 * (F287, pinned queries also surface as chips above the query bar), and
 * delete via context menu.
 */
import { useState } from 'react';
import type { MouseEvent } from 'react';
import {
  Button,
  Dialog,
  Input,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  useToast,
} from '@fables/ui';
import type { SavedQuery } from '../api/client.js';
import {
  useCreateSavedQuery,
  useDeleteSavedQuery,
  usePatchSavedQuery,
  useSavedQueries,
} from '../api/hooks.js';
import { ContextMenu, type MenuState } from '../notes/ContextMenu.js';
import './query.css';

export interface SavedQueriesSectionProps {
  /** Run a saved query in the note list (smart-folder click). */
  onRun: (saved: SavedQuery) => void;
  /** The saved query currently active in the list, if any. */
  activeId: string | null;
  /** Current query-bar text, offered by the “save current query” flow. */
  currentFql: string;
}

export function SavedQueriesSection({ onRun, activeId, currentFql }: SavedQueriesSectionProps) {
  const { toast } = useToast();
  const savedQueries = useSavedQueries();
  const createSaved = useCreateSavedQuery();
  const patchSaved = usePatchSavedQuery();
  const deleteSaved = useDeleteSavedQuery();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<SavedQuery | null>(null);

  const items = savedQueries.data ?? [];

  const togglePin = (saved: SavedQuery) =>
    patchSaved.mutate(
      { id: saved.id, patch: { pinned: !saved.pinned } },
      {
        onSuccess: (next) => toast(next.pinned ? 'Pinned to top bar' : 'Unpinned'),
        onError: (err) => toast(`Failed: ${err.message}`, 'error'),
      },
    );

  const openMenu = (e: MouseEvent, saved: SavedQuery) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: 'run', label: 'Run query', icon: Search, run: () => onRun(saved) },
        {
          id: 'pin',
          label: saved.pinned ? 'Unpin from top bar' : 'Pin to top bar',
          icon: saved.pinned ? PinOff : Pin,
          run: () => togglePin(saved),
        },
        { id: 'rename', label: 'Rename…', icon: Pencil, run: () => setRenaming(saved) },
        'sep',
        {
          id: 'delete',
          label: 'Delete saved query',
          icon: Trash2,
          danger: true,
          run: () =>
            deleteSaved.mutate(saved.id, {
              onSuccess: () => toast(`Deleted “${saved.name}”`),
              onError: (err) => toast(`Delete failed: ${err.message}`, 'error'),
            }),
        },
      ],
    });
  };

  return (
    <div className="saved-queries" aria-label="Saved queries">
      <div className="tag-section__head">
        <span className="tag-section__title">Smart folders</span>
        <button
          type="button"
          className="tag-section__mode"
          title="Save the current query"
          aria-label="Save current query"
          onClick={() => setCreating(true)}
        >
          <Plus size={12} />
        </button>
      </div>
      {items.length === 0 && (
        <div className="tag-section__empty">No saved queries yet — run one, then save it.</div>
      )}
      {items.map((saved) => (
        <button
          key={saved.id}
          type="button"
          className={`tag-section__row${saved.id === activeId ? ' tag-section__row--active' : ''}`}
          title={saved.fql}
          onClick={() => onRun(saved)}
          onContextMenu={(e) => openMenu(e, saved)}
        >
          <span aria-hidden>{saved.icon ?? '🔍'}</span>
          <span className="nb-tree__name">{saved.name}</span>
          {saved.pinned && <Pin size={11} aria-label="Pinned to top bar" />}
        </button>
      ))}

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />

      <Dialog open={creating} onClose={() => setCreating(false)}>
        {creating && (
          <SavedQueryForm
            title="Save query"
            initialName=""
            initialFql={currentFql}
            submitLabel="Save"
            onClose={() => setCreating(false)}
            onSubmit={(name, fql) =>
              createSaved.mutate(
                { name, fql },
                {
                  onSuccess: () => {
                    toast(`Saved “${name}”`);
                    setCreating(false);
                  },
                  onError: (err) => toast(`Save failed: ${err.message}`, 'error'),
                },
              )
            }
          />
        )}
      </Dialog>

      <Dialog open={renaming !== null} onClose={() => setRenaming(null)}>
        {renaming && (
          <SavedQueryForm
            title={`Edit “${renaming.name}”`}
            initialName={renaming.name}
            initialFql={renaming.fql}
            submitLabel="Save changes"
            onClose={() => setRenaming(null)}
            onSubmit={(name, fql) =>
              patchSaved.mutate(
                { id: renaming.id, patch: { name, fql } },
                {
                  onSuccess: () => {
                    toast('Saved query updated');
                    setRenaming(null);
                  },
                  onError: (err) => toast(`Update failed: ${err.message}`, 'error'),
                },
              )
            }
          />
        )}
      </Dialog>
    </div>
  );
}

function SavedQueryForm({
  title,
  initialName,
  initialFql,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initialName: string;
  initialFql: string;
  submitLabel: string;
  onSubmit: (name: string, fql: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [fql, setFql] = useState(initialFql);
  return (
    <form
      className="ui-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() !== '' && fql.trim() !== '') onSubmit(name.trim(), fql.trim());
      }}
    >
      <h3 style={{ margin: 0 }}>{title}</h3>
      <label className="ui-stack" style={{ gap: 'var(--space-1)' }}>
        Name
        <Input
          autoFocus
          aria-label="Saved query name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label className="ui-stack" style={{ gap: 'var(--space-1)' }}>
        FQL
        <Input
          aria-label="Saved query FQL"
          value={fql}
          onChange={(e) => setFql(e.target.value)}
          placeholder="tag:reading sort:updated desc"
          required
        />
      </label>
      <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
