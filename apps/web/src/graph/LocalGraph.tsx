/**
 * Local graph mode (F247): the n-hop neighborhood of one note, embedded in
 * the note view's connections sidebar with a hops selector.
 */
import { useState } from 'react';
import { Select } from '@fables/ui';
import { useLocalGraph } from '../api/hooks.js';
import { Skeleton } from '../components/Skeleton.js';
import { GraphCanvas } from './GraphCanvas.js';
import { defaultLayout } from './simulation.js';
import './graph.css';

export function LocalGraph({
  noteId,
  onOpenNote,
  height = 220,
}: {
  noteId: string;
  onOpenNote: (id: string) => void;
  height?: number;
}) {
  const [hops, setHops] = useState(1);
  const graph = useLocalGraph(noteId, hops);

  return (
    <div className="local-graph">
      <div className="local-graph__bar">
        <span>Local graph</span>
        <Select
          aria-label="Hops"
          value={String(hops)}
          onChange={(e) => setHops(Number(e.target.value))}
        >
          <option value="1">1 hop</option>
          <option value="2">2 hops</option>
          <option value="3">3 hops</option>
        </Select>
      </div>
      {graph.isPending && <Skeleton height={height} />}
      {graph.data && graph.data.nodes.length <= 1 && (
        <p
          style={{
            margin: 0,
            padding: 'var(--space-3)',
            color: 'var(--text-dim)',
            fontSize: 'var(--text-xs)',
          }}
        >
          No connections within {hops} hop{hops === 1 ? '' : 's'} yet.
        </p>
      )}
      {graph.data && graph.data.nodes.length > 1 && (
        <GraphCanvas
          nodes={graph.data.nodes}
          edges={graph.data.edges}
          layout={{ ...defaultLayout, linkDistance: 50 }}
          frozen={false}
          focusNodeId={noteId}
          height={height}
          onNodeDoubleClick={(node) => onOpenNote(node.id)}
          onNodeClick={(node) => {
            if (node.id !== noteId) onOpenNote(node.id);
          }}
        />
      )}
    </div>
  );
}
