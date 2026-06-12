/**
 * Graph view (F241–F246, F248, F249): full-graph canvas over GET /graph with
 * a filter toolbar bound to the API params, search-to-center, click popover /
 * double-click navigation, and a layout settings panel. Lazy route — keeps
 * the initial bundle clean.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Select, Settings2 } from '@fables/ui';
import type { GraphFilterParams, GraphLinkKind, GraphNode } from '../api/client.js';
import { useGraph, useNotebookTree, useTags } from '../api/hooks.js';
import { Skeleton } from '../components/Skeleton.js';
import { allNodes } from '../notes/notebookTreeModel.js';
import { GraphCanvas } from './GraphCanvas.js';
import { defaultLayout, type LayoutSettings } from './simulation.js';
import './graph.css';

const KINDS: GraphLinkKind[] = ['wikilink', 'mention', 'binding', 'relation'];

export function GraphPage() {
  const navigate = useNavigate();
  const [notebookId, setNotebookId] = useState('');
  const [tag, setTag] = useState('');
  const [kinds, setKinds] = useState<GraphLinkKind[]>(['wikilink']);
  const [search, setSearch] = useState('');
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutSettings>({ ...defaultLayout });
  const [frozen, setFrozen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [popover, setPopover] = useState<{ node: GraphNode; x: number; y: number } | null>(null);

  const filter = useMemo<GraphFilterParams>(
    () => ({
      ...(notebookId !== '' ? { notebookId } : {}),
      ...(tag !== '' ? { tag } : {}),
      ...(kinds.length > 0 ? { kinds } : {}),
    }),
    [notebookId, tag, kinds],
  );

  const graph = useGraph(filter);
  const tree = useNotebookTree();
  const tags = useTags();

  const data = graph.data;
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === '' || !data) return [];
    return data.nodes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8);
  }, [search, data]);

  const toggleKind = (kind: GraphLinkKind) =>
    setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));

  return (
    <div className="graph-page">
      <div className="graph-page__toolbar" role="toolbar" aria-label="Graph filters">
        <Select
          aria-label="Notebook filter"
          value={notebookId}
          onChange={(e) => setNotebookId(e.target.value)}
        >
          <option value="">All notebooks</option>
          {allNodes(tree.data ?? []).map((nb) => (
            <option key={nb.id} value={nb.id}>
              {nb.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Tag filter" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {(tags.data ?? []).map((t) => (
            <option key={t.id} value={t.name}>
              #{t.name}
            </option>
          ))}
        </Select>
        <span className="graph-page__kinds">
          {KINDS.map((kind) => (
            <label key={kind} className="graph-page__kind">
              <input
                type="checkbox"
                checked={kinds.includes(kind)}
                onChange={() => toggleKind(kind)}
              />
              {kind}
            </label>
          ))}
        </span>
        <span className="graph-page__search">
          <Input
            aria-label="Search graph"
            placeholder="Find a note…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setFocusNodeId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) {
                setFocusNodeId(matches[0].id);
                setSearch(matches[0].title);
              }
            }}
          />
          {matches.length > 0 && focusNodeId === null && (
            <div className="graph-page__matches" role="listbox">
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setFocusNodeId(m.id);
                    setSearch(m.title);
                  }}
                >
                  {m.title || 'Untitled'}
                </button>
              ))}
            </div>
          )}
        </span>
        <Button
          aria-label="Layout settings"
          title="Layout settings"
          onClick={() => setShowSettings((v) => !v)}
        >
          <Settings2 size={14} />
        </Button>
        <Button aria-pressed={frozen} title="Freeze layout" onClick={() => setFrozen((v) => !v)}>
          {frozen ? 'Unfreeze' : 'Freeze'}
        </Button>
      </div>

      {showSettings && (
        <div className="graph-page__settings" aria-label="Layout settings">
          <label>
            Gravity
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.01}
              value={layout.gravity}
              onChange={(e) => setLayout((l) => ({ ...l, gravity: Number(e.target.value) }))}
            />
          </label>
          <label>
            Link distance
            <input
              type="range"
              min={20}
              max={200}
              step={5}
              value={layout.linkDistance}
              onChange={(e) => setLayout((l) => ({ ...l, linkDistance: Number(e.target.value) }))}
            />
          </label>
          <label>
            Repulsion
            <input
              type="range"
              min={200}
              max={5000}
              step={100}
              value={layout.repulsion}
              onChange={(e) => setLayout((l) => ({ ...l, repulsion: Number(e.target.value) }))}
            />
          </label>
          <Button onClick={() => setLayout({ ...defaultLayout })}>Reset</Button>
        </div>
      )}

      <div className="graph-page__canvas">
        {graph.isPending && <Skeleton height={320} />}
        {graph.isError && <p className="graph-page__empty">Could not load the graph.</p>}
        {data && data.nodes.length === 0 && (
          <p className="graph-page__empty">No linked notes match these filters yet.</p>
        )}
        {data && data.nodes.length > 0 && (
          <GraphCanvas
            nodes={data.nodes}
            edges={data.edges}
            layout={layout}
            frozen={frozen}
            focusNodeId={focusNodeId}
            onNodeClick={(node, screen) => setPopover({ node, x: screen.x, y: screen.y })}
            onNodeDoubleClick={(node) => navigate(`/notes/${node.id}`)}
            onBackgroundClick={() => setPopover(null)}
          />
        )}
        {popover && (
          <div
            className="graph-popover"
            role="dialog"
            aria-label={`Preview of ${popover.node.title || 'Untitled'}`}
            style={{ left: popover.x + 12, top: popover.y + 12 }}
          >
            <strong>{popover.node.title || 'Untitled'}</strong>
            <span className="graph-popover__meta">
              {popover.node.degree} link{popover.node.degree === 1 ? '' : 's'}
              {popover.node.orphan ? ' · orphan' : ''}
            </span>
            <div className="ui-row">
              <Button variant="primary" onClick={() => navigate(`/notes/${popover.node.id}`)}>
                Open note
              </Button>
              <Button onClick={() => setPopover(null)}>Close</Button>
            </div>
          </div>
        )}
      </div>

      {data && (
        <div className="graph-page__stats" role="status">
          {data.stats.nodes} notes · {data.stats.edges} links · {data.stats.orphans} orphans ·{' '}
          {data.stats.communities} clusters
        </div>
      )}
    </div>
  );
}
