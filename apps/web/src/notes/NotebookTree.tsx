/**
 * Notebook tree sidebar (F142–F149): nesting with persisted expand state,
 * note-count badges, icons + colors, context-menu CRUD, archive, default
 * capture notebook, and drag-and-drop (drag a notebook to re-parent it,
 * drop a note row from the list to move the note).
 */
import { useMemo, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Pin,
  Trash2,
  useToast,
} from '@fables/ui';
import type { NotebookTreeNode } from '../api/client.js';
import {
  useCreateNotebook,
  useDeleteNotebook,
  usePatchNote,
  usePatchNotebook,
} from '../api/hooks.js';
import { ContextMenu, type MenuState } from './ContextMenu.js';
import {
  NotebookDeleteDialog,
  NotebookEditDialog,
  NotebookMoveDialog,
  type NotebookFormValue,
} from './NotebookDialogs.js';
import { findNode, flattenTree, subtreeIds } from './notebookTreeModel.js';

export const NOTE_DRAG_TYPE = 'application/x-fables-note';
const NOTEBOOK_DRAG_TYPE = 'application/x-fables-notebook';

export interface NotebookTreeProps {
  roots: NotebookTreeNode[];
  selectedId: string | null;
  onSelect: (notebookId: string | null) => void;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  defaultNotebookId: string | null;
  onSetDefault: (id: string) => void;
  onNewNote: (notebookId: string) => void;
  /** The note moved away from the current view (refresh handled by hooks). */
  onNoteMoved?: (noteId: string, notebookId: string) => void;
}

type DialogState =
  | { kind: 'create'; parentId: string | null }
  | { kind: 'rename'; node: NotebookTreeNode }
  | { kind: 'move'; node: NotebookTreeNode }
  | { kind: 'delete'; node: NotebookTreeNode }
  | null;

export function NotebookTree({
  roots,
  selectedId,
  onSelect,
  expanded,
  onToggleExpanded,
  defaultNotebookId,
  onSetDefault,
  onNewNote,
  onNoteMoved,
}: NotebookTreeProps) {
  const { toast } = useToast();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const createNotebook = useCreateNotebook();
  const patchNotebook = usePatchNotebook();
  const deleteNotebook = useDeleteNotebook();
  const patchNote = usePatchNote();

  const rows = useMemo(() => flattenTree(roots, expanded), [roots, expanded]);

  const openMenu = (e: MouseEvent, node: NotebookTreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: 'new-note', label: 'New note here', icon: FilePlus2, run: () => onNewNote(node.id) },
        {
          id: 'new-child',
          label: 'New sub-notebook',
          icon: FolderPlus,
          run: () => setDialog({ kind: 'create', parentId: node.id }),
        },
        'sep',
        {
          id: 'rename',
          label: 'Rename / appearance…',
          icon: Pencil,
          run: () => setDialog({ kind: 'rename', node }),
        },
        {
          id: 'move',
          label: 'Move to…',
          icon: Folder,
          run: () => setDialog({ kind: 'move', node }),
        },
        {
          id: 'default',
          label: 'Set as default for capture',
          icon: Pin,
          run: () => onSetDefault(node.id),
        },
        {
          id: 'archive',
          label: node.archived ? 'Unarchive' : 'Archive',
          icon: node.archived ? ArchiveRestore : Archive,
          run: () =>
            patchNotebook.mutate(
              { id: node.id, patch: { archived: !node.archived } },
              {
                onSuccess: () => toast(node.archived ? 'Notebook unarchived' : 'Notebook archived'),
              },
            ),
        },
        'sep',
        {
          id: 'delete',
          label: 'Delete…',
          icon: Trash2,
          danger: true,
          run: () => setDialog({ kind: 'delete', node }),
        },
      ],
    });
  };

  const handleDrop = (e: DragEvent, target: NotebookTreeNode | null) => {
    e.preventDefault();
    setDropTarget(null);
    const noteId = e.dataTransfer.getData(NOTE_DRAG_TYPE);
    const notebookId = e.dataTransfer.getData(NOTEBOOK_DRAG_TYPE);
    if (noteId && target) {
      const [id, revText] = noteId.split(':');
      if (!id || revText === undefined) return;
      patchNote.mutate(
        { id, patch: { rev: Number(revText), notebookId: target.id } },
        {
          onSuccess: () => {
            toast(`Moved to ${target.name}`);
            onNoteMoved?.(id, target.id);
          },
          onError: (err) => toast(`Move failed: ${err.message}`, 'error'),
        },
      );
      return;
    }
    if (notebookId) {
      const dragged = findNode(roots, notebookId);
      if (!dragged) return;
      const targetId = target?.id ?? null;
      if (targetId === dragged.parentId || targetId === dragged.id) return;
      // Cycle prevention (F150): a notebook can't move into its own subtree.
      if (target && subtreeIds(dragged).has(target.id)) {
        toast('Cannot move a notebook into its own descendant', 'error');
        return;
      }
      patchNotebook.mutate(
        { id: dragged.id, patch: { parentId: targetId } },
        { onError: (err) => toast(`Move failed: ${err.message}`, 'error') },
      );
    }
  };

  const allowDrop = (e: DragEvent, id: string | null) => {
    if (
      e.dataTransfer.types.includes(NOTE_DRAG_TYPE) ||
      e.dataTransfer.types.includes(NOTEBOOK_DRAG_TYPE)
    ) {
      e.preventDefault();
      setDropTarget(id);
    }
  };

  return (
    <div className="nb-tree" role="tree" aria-label="Notebooks">
      <button
        type="button"
        role="treeitem"
        aria-selected={selectedId === null}
        className={`nb-tree__row${selectedId === null ? ' nb-tree__row--active' : ''}`}
        onClick={() => onSelect(null)}
        onDragOver={(e) => allowDrop(e, null)}
        onDrop={(e) => handleDrop(e, null)}
      >
        <FolderOpen size={14} />
        <span className="nb-tree__name">All notes</span>
      </button>
      {rows.map(({ node, depth, hasChildren }) => (
        <button
          key={node.id}
          type="button"
          role="treeitem"
          aria-selected={selectedId === node.id}
          aria-expanded={hasChildren ? expanded.has(node.id) : undefined}
          draggable
          className={[
            'nb-tree__row',
            selectedId === node.id ? 'nb-tree__row--active' : '',
            node.archived ? 'nb-tree__row--archived' : '',
            dropTarget === node.id ? 'nb-tree__row--drop' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: `calc(var(--space-2) + ${depth * 14}px)` }}
          onClick={() => onSelect(node.id)}
          onContextMenu={(e) => openMenu(e, node)}
          onDragStart={(e) => {
            e.dataTransfer.setData(NOTEBOOK_DRAG_TYPE, node.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => allowDrop(e, node.id)}
          onDragLeave={() => setDropTarget((t) => (t === node.id ? null : t))}
          onDrop={(e) => handleDrop(e, node)}
        >
          <span
            className="nb-tree__chevron"
            aria-hidden="true"
            onClick={(e) => {
              if (!hasChildren) return;
              e.stopPropagation();
              onToggleExpanded(node.id);
            }}
          >
            {hasChildren ? (
              expanded.has(node.id) ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )
            ) : null}
          </span>
          {node.icon ? (
            <span aria-hidden="true">{node.icon}</span>
          ) : (
            <Folder size={14} color={node.color ?? undefined} />
          )}
          <span className="nb-tree__name">
            {node.name}
            {node.id === defaultNotebookId && (
              <span className="nb-tree__default" title="Default notebook for quick capture">
                {' '}
                ◈
              </span>
            )}
          </span>
          <span className="ui-badge">{node.noteCount}</span>
        </button>
      ))}
      <button
        type="button"
        className="nb-tree__row nb-tree__row--new"
        onClick={() => setDialog({ kind: 'create', parentId: null })}
      >
        <FolderPlus size={14} />
        <span className="nb-tree__name">New notebook</span>
      </button>

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />

      <NotebookEditDialog
        open={dialog?.kind === 'create' || dialog?.kind === 'rename'}
        title={dialog?.kind === 'rename' ? 'Edit notebook' : 'New notebook'}
        initial={
          dialog?.kind === 'rename'
            ? { name: dialog.node.name, icon: dialog.node.icon, color: dialog.node.color }
            : { name: '', icon: null, color: null }
        }
        onClose={() => setDialog(null)}
        onSubmit={(value: NotebookFormValue) => {
          if (dialog?.kind === 'rename') {
            patchNotebook.mutate(
              { id: dialog.node.id, patch: value },
              { onError: (err) => toast(`Save failed: ${err.message}`, 'error') },
            );
          } else if (dialog?.kind === 'create') {
            createNotebook.mutate(
              { ...value, parentId: dialog.parentId },
              { onError: (err) => toast(`Create failed: ${err.message}`, 'error') },
            );
          }
          setDialog(null);
        }}
      />
      <NotebookMoveDialog
        open={dialog?.kind === 'move'}
        roots={roots}
        notebookId={dialog?.kind === 'move' ? dialog.node.id : null}
        onClose={() => setDialog(null)}
        onSubmit={(parentId) => {
          if (dialog?.kind === 'move') {
            patchNotebook.mutate(
              { id: dialog.node.id, patch: { parentId } },
              { onError: (err) => toast(`Move failed: ${err.message}`, 'error') },
            );
          }
          setDialog(null);
        }}
      />
      <NotebookDeleteDialog
        open={dialog?.kind === 'delete'}
        roots={roots}
        notebook={dialog?.kind === 'delete' ? dialog.node : null}
        onClose={() => setDialog(null)}
        onSubmit={(moveNotesTo) => {
          if (dialog?.kind === 'delete') {
            const { node } = dialog;
            deleteNotebook.mutate(
              moveNotesTo !== undefined ? { id: node.id, moveNotesTo } : { id: node.id },
              {
                onSuccess: () => {
                  toast('Notebook deleted');
                  if (selectedId === node.id) onSelect(null);
                },
                onError: (err) => toast(`Delete failed: ${err.message}`, 'error'),
              },
            );
          }
          setDialog(null);
        }}
      />
    </div>
  );
}
