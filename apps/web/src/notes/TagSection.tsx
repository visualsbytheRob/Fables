/**
 * Tag sidebar (F154–F158): counts, nested `a/b` display, AND/OR filter
 * selection, and rename / recolor / merge / delete via context menu.
 */
import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { Button, Dialog, Input, Select, TagIcon, Trash2, Pencil, Copy, useToast } from '@fables/ui';
import type { TagWithCount } from '../api/client.js';
import { useDeleteTag, useMergeTags, usePatchTag, useTags } from '../api/hooks.js';
import { ContextMenu, type MenuState } from './ContextMenu.js';
import { NOTEBOOK_COLORS } from './NotebookDialogs.js';

export type TagFilterMode = 'and' | 'or';

export interface TagFilter {
  names: string[];
  mode: TagFilterMode;
}

/** Indent level for nested tag names (F157): `world/characters` sits under `world`. */
export const tagDepth = (name: string): number => name.split('/').length - 1;

export const tagLeaf = (name: string): string => name.split('/').pop() ?? name;

export function TagSection({
  filter,
  onFilterChange,
}: {
  filter: TagFilter;
  onFilterChange: (filter: TagFilter) => void;
}) {
  const { toast } = useToast();
  const tags = useTags();
  const patchTag = usePatchTag();
  const mergeTags = useMergeTags();
  const deleteTag = useDeleteTag();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<TagWithCount | null>(null);
  const [merging, setMerging] = useState<TagWithCount | null>(null);

  const sorted = useMemo(
    () => [...(tags.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [tags.data],
  );

  const toggle = (name: string) => {
    const names = filter.names.includes(name)
      ? filter.names.filter((n) => n !== name)
      : [...filter.names, name];
    onFilterChange({ ...filter, names });
  };

  const openMenu = (e: MouseEvent, tag: TagWithCount) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: 'edit', label: 'Rename / color…', icon: Pencil, run: () => setEditing(tag) },
        { id: 'merge', label: 'Merge into…', icon: Copy, run: () => setMerging(tag) },
        'sep',
        {
          id: 'delete',
          label: 'Delete tag',
          icon: Trash2,
          danger: true,
          run: () =>
            deleteTag.mutate(tag.id, {
              onSuccess: () => toast(`Deleted #${tag.name}`),
              onError: (err) => toast(`Delete failed: ${err.message}`, 'error'),
            }),
        },
      ],
    });
  };

  return (
    <div className="tag-section">
      <div className="tag-section__head">
        <span className="tag-section__title">Tags</span>
        {filter.names.length > 1 && (
          <button
            type="button"
            className="tag-section__mode"
            title="Combine selected tags with AND or OR"
            onClick={() =>
              onFilterChange({ ...filter, mode: filter.mode === 'and' ? 'or' : 'and' })
            }
          >
            {filter.mode.toUpperCase()}
          </button>
        )}
        {filter.names.length > 0 && (
          <button
            type="button"
            className="tag-section__mode"
            onClick={() => onFilterChange({ names: [], mode: filter.mode })}
          >
            clear
          </button>
        )}
      </div>
      {sorted.length === 0 && (
        <div className="tag-section__empty">No tags yet — type #tag in a note.</div>
      )}
      {sorted.map((tag) => (
        <button
          key={tag.id}
          type="button"
          className={`tag-section__row${filter.names.includes(tag.name) ? ' tag-section__row--active' : ''}`}
          style={{ paddingLeft: `calc(var(--space-2) + ${tagDepth(tag.name) * 14}px)` }}
          onClick={() => toggle(tag.name)}
          onContextMenu={(e) => openMenu(e, tag)}
        >
          <TagIcon size={12} color={tag.color ?? undefined} />
          <span className="nb-tree__name">{tagLeaf(tag.name)}</span>
          <span className="ui-badge">{tag.noteCount}</span>
        </button>
      ))}

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />

      <Dialog open={editing !== null} onClose={() => setEditing(null)}>
        {editing && (
          <TagEditForm
            tag={editing}
            onClose={() => setEditing(null)}
            onSubmit={(patch) => {
              patchTag.mutate(
                { id: editing.id, patch },
                {
                  onSuccess: () => toast('Tag updated'),
                  onError: (err) => toast(`Update failed: ${err.message}`, 'error'),
                },
              );
              setEditing(null);
            }}
          />
        )}
      </Dialog>

      <Dialog open={merging !== null} onClose={() => setMerging(null)}>
        {merging && (
          <TagMergeForm
            tag={merging}
            tags={sorted}
            onClose={() => setMerging(null)}
            onSubmit={(targetId) => {
              mergeTags.mutate(
                { id: merging.id, targetId },
                {
                  onSuccess: (result) =>
                    toast(`Merged into #${result.target.name} (${result.mergedNotes} notes)`),
                  onError: (err) => toast(`Merge failed: ${err.message}`, 'error'),
                },
              );
              setMerging(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function TagEditForm({
  tag,
  onSubmit,
  onClose,
}: {
  tag: TagWithCount;
  onSubmit: (patch: { name?: string; color?: string | null }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color ?? '');
  return (
    <form
      className="ui-stack"
      onSubmit={(e) => {
        e.preventDefault();
        const patch: { name?: string; color?: string | null } = { color: color || null };
        if (name.trim() !== tag.name) patch.name = name.trim();
        onSubmit(patch);
      }}
    >
      <h3 style={{ margin: 0 }}>Edit #{tag.name}</h3>
      <label className="ui-stack" style={{ gap: 'var(--space-1)' }}>
        Name (rename rewrites #{tag.name} in every note)
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
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
      <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Save
        </Button>
      </div>
    </form>
  );
}

function TagMergeForm({
  tag,
  tags,
  onSubmit,
  onClose,
}: {
  tag: TagWithCount;
  tags: TagWithCount[];
  onSubmit: (targetId: string) => void;
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState('');
  return (
    <div className="ui-stack">
      <h3 style={{ margin: 0 }}>Merge #{tag.name} into…</h3>
      <Select
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        aria-label="Merge target"
      >
        <option value="">Choose a tag…</option>
        {tags
          .filter((t) => t.id !== tag.id)
          .map((t) => (
            <option key={t.id} value={t.id}>
              #{t.name}
            </option>
          ))}
      </Select>
      <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
        Every #{tag.name} in note bodies is rewritten and the tag is removed.
      </p>
      <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={targetId === ''} onClick={() => onSubmit(targetId)}>
          Merge
        </Button>
      </div>
    </div>
  );
}
