/**
 * Connections sidebar (F212/F215/F218/F223 + F247): backlinks grouped by
 * source note with context snippets, unlinked mentions with one-click /
 * link-all conversion, and the embedded local graph. Section collapse state
 * persists in localStorage.
 */
import { useState } from 'react';
import { Button, ChevronDown, ChevronRight, useToast, X } from '@fables/ui';
import type { IncomingLinkGroup, IncomingLinkItem } from '../api/client.js';
import { useBacklinks, useConvertMentions, useMentions } from '../api/hooks.js';
import { LocalGraph } from '../graph/LocalGraph.js';
import { loadBacklinksPanel, saveBacklinksPanel } from './prefs.js';
import { relativeTime } from './text.js';

function Snippet({ item }: { item: IncomingLinkItem }) {
  const { text, highlightStart, highlightEnd } = item.snippet;
  return (
    <>
      {text.slice(0, highlightStart)}
      <mark>{text.slice(highlightStart, highlightEnd)}</mark>
      {text.slice(highlightEnd)}
    </>
  );
}

function Section({
  id,
  title,
  count,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="backlinks__section">
      <button
        type="button"
        className="backlinks__section-head"
        aria-expanded={!collapsed}
        onClick={() => onToggle(id)}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span>{title}</span>
        {count !== undefined && <span className="backlinks__count">{count}</span>}
      </button>
      {!collapsed && children}
    </section>
  );
}

function SourceGroup({
  group,
  onOpenAt,
  action,
}: {
  group: IncomingLinkGroup;
  onOpenAt: (noteId: string, position: number) => void;
  action?: (item: IncomingLinkItem) => React.ReactNode;
}) {
  return (
    <div className="backlinks__group">
      <div className="backlinks__group-title">
        <button
          type="button"
          onClick={() => onOpenAt(group.note.id, group.links[0]?.position ?? 0)}
        >
          {group.note.title || 'Untitled'}
        </button>
        <span className="backlinks__meta">
          {group.count > 1 ? `${group.count} · ` : ''}
          {relativeTime(group.note.updatedAt)}
        </span>
      </div>
      {group.links.map((item) => (
        <div key={item.id} className="backlinks__item">
          <button
            type="button"
            className="backlinks__snippet"
            title="Open at this position"
            onClick={() => onOpenAt(group.note.id, item.position)}
          >
            <Snippet item={item} />
          </button>
          {action?.(item)}
        </div>
      ))}
    </div>
  );
}

export function BacklinksPanel({
  noteId,
  onOpenAt,
  onClose,
}: {
  noteId: string;
  /** Open a source note scrolled to a character offset (F215). */
  onOpenAt: (noteId: string, position: number) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const backlinks = useBacklinks(noteId);
  const mentions = useMentions(noteId);
  const convert = useConvertMentions(noteId);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    () => loadBacklinksPanel().collapsed,
  );

  const toggleSection = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveBacklinksPanel({ ...loadBacklinksPanel(), collapsed: next });
      return next;
    });
  };

  const linkMention = (mentionId: string) =>
    convert.mutate(
      { mentionId },
      {
        onSuccess: () => toast('Mention linked'),
        onError: (err) => toast(`Link failed: ${err.message}`, 'error'),
      },
    );

  const linkAll = () =>
    convert.mutate(
      { all: true },
      {
        onSuccess: (res) =>
          toast(`Linked ${res.converted} mention${res.converted === 1 ? '' : 's'}`),
        onError: (err) => toast(`Link all failed: ${err.message}`, 'error'),
      },
    );

  const mentionTotal = mentions.data?.total ?? 0;

  return (
    <aside className="backlinks" aria-label="Connections">
      <div className="backlinks__head">
        <strong>Connections</strong>
        <Button aria-label="Close connections" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      <Section
        id="linked"
        title="Backlinks"
        count={backlinks.data?.total ?? 0}
        collapsed={collapsed['linked'] === true}
        onToggle={toggleSection}
      >
        {backlinks.isPending && <p className="backlinks__empty">Loading…</p>}
        {backlinks.data && backlinks.data.sources.length === 0 && (
          <p className="backlinks__empty">No notes link here yet.</p>
        )}
        {(backlinks.data?.sources ?? []).map((group) => (
          <SourceGroup key={group.note.id} group={group} onOpenAt={onOpenAt} />
        ))}
      </Section>

      <Section
        id="mentions"
        title="Unlinked mentions"
        count={mentionTotal}
        collapsed={collapsed['mentions'] === true}
        onToggle={toggleSection}
      >
        {mentionTotal > 0 && (
          <div className="backlinks__linkall">
            <Button onClick={linkAll} disabled={convert.isPending}>
              Link all ({mentionTotal})
            </Button>
          </div>
        )}
        {mentions.data && mentions.data.sources.length === 0 && (
          <p className="backlinks__empty">No unlinked mentions found.</p>
        )}
        {(mentions.data?.sources ?? []).map((group) => (
          <SourceGroup
            key={group.note.id}
            group={group}
            onOpenAt={onOpenAt}
            action={(item) => (
              <Button
                className="backlinks__link-btn"
                disabled={convert.isPending}
                onClick={() => linkMention(item.id)}
              >
                Link
              </Button>
            )}
          />
        ))}
      </Section>

      <Section
        id="graph"
        title="Local graph"
        collapsed={collapsed['graph'] === true}
        onToggle={toggleSection}
      >
        <LocalGraph noteId={noteId} onOpenNote={(id) => onOpenAt(id, 0)} />
      </Section>
    </aside>
  );
}
