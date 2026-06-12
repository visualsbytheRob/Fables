/**
 * Note list pane (F171–F178): windowed rows (F172) with title, snippet,
 * relative updated time and tag chips; sort + filter bar (F173);
 * multi-select bulk actions (F174); context menu (F175); pinned + recent
 * sections (F177/F178). Rows are draggable onto the notebook tree (F143).
 */
import { useMemo, useRef, useState } from 'react';
import type { MouseEvent, UIEvent } from 'react';
import {
  ArrowUpDown,
  Button,
  Copy,
  Dialog,
  FileText,
  Input,
  Pin,
  PinOff,
  Select,
  Trash2,
  useToast,
} from '@fables/ui';
import type { Note, NotebookTreeNode, NoteSort } from '../api/client.js';
import { useBulkNotes, useDeleteNote, useDuplicateNote, usePatchNote } from '../api/hooks.js';
import { ContextMenu, type MenuState } from './ContextMenu.js';
import { NOTE_DRAG_TYPE } from './NotebookTree.js';
import { allNodes } from './notebookTreeModel.js';
import { extractHashtags, relativeTime, snippet } from './text.js';
import { computeWindow } from './windowing.js';

export const ROW_HEIGHT = 72;

export interface NoteListProps {
  notes: Note[];
  roots: NotebookTreeNode[];
  selectedNoteId: string | null;
  onOpen: (id: string) => void;
  recents: string[];
  sort: NoteSort;
  onSortChange: (sort: NoteSort) => void;
  query: string;
  onQueryChange: (query: string) => void;
  attachmentNoteIds: Set<string>;
  attachmentsOnly: boolean;
  onAttachmentsOnlyChange: (value: boolean) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  /** Test hook: fixed viewport height when the DOM can't measure (jsdom). */
  viewportHeight?: number;
}

export function NoteList(props: NoteListProps) {
  const {
    notes,
    roots,
    selectedNoteId,
    onOpen,
    recents,
    sort,
    onSortChange,
    query,
    onQueryChange,
    attachmentNoteIds,
    attachmentsOnly,
    onAttachmentsOnlyChange,
    hasMore,
    onLoadMore,
  } = props;
  const { toast } = useToast();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState<string | null>(null); // dialog open flag
  const [bulkTag, setBulkTag] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const patchNote = usePatchNote();
  const deleteNote = useDeleteNote();
  const duplicateNote = useDuplicateNote();
  const bulkNotes = useBulkNotes();

  const filtered = useMemo(() => {
    let rows = notes;
    if (attachmentsOnly) rows = rows.filter((n) => attachmentNoteIds.has(n.id));
    const q = query.trim().toLowerCase();
    if (q !== '') {
      rows = rows.filter(
        (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [notes, attachmentsOnly, attachmentNoteIds, query]);

  const pinned = useMemo(() => filtered.filter((n) => n.pinned), [filtered]);
  const unpinned = useMemo(() => filtered.filter((n) => !n.pinned), [filtered]);
  const recentNotes = useMemo(() => {
    const byId = new Map(notes.map((n) => [n.id, n]));
    return recents
      .map((id) => byId.get(id))
      .filter((n): n is Note => n !== undefined)
      .slice(0, 5);
  }, [notes, recents]);

  const viewportHeight = props.viewportHeight ?? scrollerRef.current?.clientHeight ?? 600;
  const slice = computeWindow({
    scrollTop,
    viewportHeight,
    rowHeight: ROW_HEIGHT,
    count: unpinned.length,
  });

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrollTop(el.scrollTop);
    if (hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_HEIGHT * 4) {
      onLoadMore();
    }
  };

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openMenu = (e: MouseEvent, note: Note) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: 'open', label: 'Open', icon: FileText, run: () => onOpen(note.id) },
        {
          id: 'pin',
          label: note.pinned ? 'Unpin' : 'Pin',
          icon: note.pinned ? PinOff : Pin,
          run: () =>
            patchNote.mutate(
              { id: note.id, patch: { rev: note.rev, pinned: !note.pinned } },
              { onError: (err) => toast(`Failed: ${err.message}`, 'error') },
            ),
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          icon: Copy,
          run: () =>
            duplicateNote.mutate(note.id, {
              onSuccess: (copy) => {
                toast('Note duplicated');
                onOpen(copy.id);
              },
            }),
        },
        {
          id: 'move',
          label: 'Move to…',
          icon: ArrowUpDown,
          run: () => {
            setChecked(new Set([note.id]));
            setMoveTarget('');
          },
        },
        'sep',
        {
          id: 'delete',
          label: 'Move to trash',
          icon: Trash2,
          danger: true,
          run: () =>
            deleteNote.mutate(note.id, {
              onSuccess: () => toast('Note moved to trash'),
              onError: (err) => toast(`Delete failed: ${err.message}`, 'error'),
            }),
        },
      ],
    });
  };

  const runBulk = (
    action: 'move' | 'delete' | 'tag',
    extra?: { notebookId?: string; tag?: string },
  ) => {
    bulkNotes.mutate(
      { action, noteIds: [...checked], ...extra },
      {
        onSuccess: (result) => {
          toast(
            `${result.affected} note${result.affected === 1 ? '' : 's'} ${action === 'delete' ? 'trashed' : action === 'move' ? 'moved' : 'tagged'}`,
          );
          setChecked(new Set());
        },
        onError: (err) => toast(`Bulk ${action} failed: ${err.message}`, 'error'),
      },
    );
  };

  const row = (note: Note) => (
    <div
      key={note.id}
      role="button"
      tabIndex={0}
      draggable
      className={`note-row${note.id === selectedNoteId ? ' note-row--active' : ''}`}
      style={{ height: ROW_HEIGHT }}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) toggleChecked(note.id);
        else onOpen(note.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(note.id);
      }}
      onContextMenu={(e) => openMenu(e, note)}
      onDragStart={(e) => {
        e.dataTransfer.setData(NOTE_DRAG_TYPE, `${note.id}:${note.rev}`);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <input
        type="checkbox"
        className="note-row__check"
        aria-label={`Select ${note.title || 'untitled'}`}
        checked={checked.has(note.id)}
        onClick={(e) => e.stopPropagation()}
        onChange={() => toggleChecked(note.id)}
      />
      <div className="note-row__main">
        <div className="note-row__title">
          {note.pinned && <Pin size={11} aria-label="Pinned" />}
          {note.title || 'Untitled'}
        </div>
        <div className="note-row__snippet">{snippet(note.body)}</div>
        <div className="note-row__meta">
          <span>{relativeTime(note.updatedAt)}</span>
          {extractHashtags(note.body)
            .slice(0, 3)
            .map((tag) => (
              <span key={tag} className="note-row__tag">
                #{tag}
              </span>
            ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="note-list">
      <div className="note-list__bar">
        <Input
          type="search"
          placeholder="Filter notes…"
          aria-label="Filter notes"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <Select
          aria-label="Sort notes"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as NoteSort)}
          style={{ width: 'auto' }}
        >
          <option value="updated">Updated</option>
          <option value="created">Created</option>
          <option value="title">Title</option>
        </Select>
        <label className="note-list__filter" title="Only notes with attachments">
          <input
            type="checkbox"
            checked={attachmentsOnly}
            onChange={(e) => onAttachmentsOnlyChange(e.target.checked)}
          />
          📎
        </label>
      </div>

      {checked.size > 0 && (
        <div className="note-list__bulk" role="toolbar" aria-label="Bulk actions">
          <span>{checked.size} selected</span>
          <Button onClick={() => setMoveTarget('')}>Move…</Button>
          <Button onClick={() => setBulkTag('')}>Tag…</Button>
          <Button variant="danger" onClick={() => runBulk('delete')}>
            Trash
          </Button>
          <Button onClick={() => setChecked(new Set())}>Clear</Button>
        </div>
      )}

      {recentNotes.length > 0 && query === '' && (
        <div className="note-list__recents" aria-label="Recent notes">
          <span className="note-list__section">Recent</span>
          {recentNotes.map((n) => (
            <button
              key={n.id}
              type="button"
              className="note-list__recent"
              onClick={() => onOpen(n.id)}
            >
              {n.title || 'Untitled'}
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollerRef}
        className="note-list__scroll"
        onScroll={onScroll}
        data-testid="note-scroll"
      >
        {pinned.length > 0 && (
          <>
            <div className="note-list__section">Pinned</div>
            {pinned.map(row)}
            <div className="note-list__section">Notes</div>
          </>
        )}
        <div style={{ height: slice.padTop }} aria-hidden="true" />
        {unpinned.slice(slice.start, slice.end).map(row)}
        <div style={{ height: slice.padBottom }} aria-hidden="true" />
        {filtered.length === 0 && <div className="note-list__empty">No notes match.</div>}
      </div>

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />

      <Dialog open={moveTarget !== null} onClose={() => setMoveTarget(null)}>
        <div className="ui-stack">
          <h3 style={{ margin: 0 }}>
            Move {checked.size} note{checked.size === 1 ? '' : 's'} to…
          </h3>
          <Select
            aria-label="Target notebook"
            value={moveTarget ?? ''}
            onChange={(e) => setMoveTarget(e.target.value)}
          >
            <option value="">Choose a notebook…</option>
            {allNodes(roots).map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
          <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setMoveTarget(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!moveTarget}
              onClick={() => {
                if (moveTarget) runBulk('move', { notebookId: moveTarget });
                setMoveTarget(null);
              }}
            >
              Move
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={bulkTag !== null} onClose={() => setBulkTag(null)}>
        <form
          className="ui-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (bulkTag && bulkTag.trim() !== '') runBulk('tag', { tag: bulkTag.trim() });
            setBulkTag(null);
          }}
        >
          <h3 style={{ margin: 0 }}>
            Tag {checked.size} note{checked.size === 1 ? '' : 's'}
          </h3>
          <Input
            autoFocus
            placeholder="tag-name"
            aria-label="Tag name"
            value={bulkTag ?? ''}
            onChange={(e) => setBulkTag(e.target.value)}
          />
          <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
            <Button type="button" onClick={() => setBulkTag(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Tag
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
