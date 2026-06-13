/**
 * Scene graph view (F521–F529): interactive SVG of the story flow. Click a
 * node to open its knot in the editor; select two nodes (click, then
 * shift-click) to highlight every route between them; export downloads a
 * standalone SVG.
 */
import { useMemo, useState } from 'react';
import { Button, Download } from '@fables/ui';
import type { CompileResult } from '@fables/forge-dsl';
import {
  buildSceneGraph,
  DEFAULT_LAYOUT,
  edgeKey,
  graphToSvg,
  nodePositions,
  pathsBetween,
  svgSize,
  START_NODE,
  type SceneGraph,
} from './sceneGraph.js';

export interface SceneGraphViewProps {
  result: CompileResult | null;
  /** Open the knot's file in the editor at the header offset (F524). */
  onOpenKnot: (file: string | undefined, offset: number) => void;
}

function downloadSvg(graph: SceneGraph): void {
  const blob = new Blob([graphToSvg(graph)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'story-graph.svg';
  a.click();
  URL.revokeObjectURL(url);
}

export function SceneGraphView({ result, onOpenKnot }: SceneGraphViewProps) {
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);

  const graph = useMemo(() => (result === null ? null : buildSceneGraph(result)), [result]);
  const highlight = useMemo(
    () =>
      graph !== null && selectedA !== null && selectedB !== null
        ? pathsBetween(graph, selectedA, selectedB)
        : null,
    [graph, selectedA, selectedB],
  );

  if (graph === null) {
    return <p className="scene-graph-toolbar">Compile the story to see its flow graph.</p>;
  }

  const layout = DEFAULT_LAYOUT;
  const positions = nodePositions(graph, layout);
  const { width, height } = svgSize(graph, layout);

  const select = (id: string, additive: boolean): void => {
    if (additive && selectedA !== null) {
      setSelectedB(id === selectedA ? null : id);
    } else {
      setSelectedA(id === selectedA ? null : id);
      setSelectedB(null);
    }
  };

  return (
    <div className="scene-graph">
      <div className="scene-graph-toolbar">
        <span>
          {selectedA === null
            ? 'Click a node to select; shift-click a second to trace routes (F527).'
            : selectedB === null
              ? `From "${graph.nodes.find((n) => n.id === selectedA)?.label}": shift-click a target.`
              : `Routes ${selectedA || '(start)'} → ${selectedB || '(start)'} highlighted.`}
        </span>
        <span style={{ flex: 1 }} />
        <Button onClick={() => downloadSvg(graph)} title="Export graph as SVG (F529)">
          <Download size={13} /> SVG
        </Button>
      </div>
      <div className="scene-graph-canvas">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Story flow graph"
        >
          <defs>
            <marker
              id="scene-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
            </marker>
          </defs>
          {graph.edges.map((edge) => {
            const a = positions.get(edge.from);
            const b = positions.get(edge.to);
            if (a === undefined || b === undefined) return null;
            const x1 = a.x + layout.nodeWidth;
            const y1 = a.y + layout.nodeHeight / 2;
            const x2 = b.x;
            const y2 = b.y + layout.nodeHeight / 2;
            const mid = (x1 + x2) / 2;
            const onPath = highlight?.edges.has(edgeKey(edge)) === true;
            return (
              <path
                key={edgeKey(edge)}
                className={`scene-edge${onPath ? ' on-path' : ''}`}
                d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                markerEnd="url(#scene-arrow)"
              />
            );
          })}
          {graph.nodes.map((node) => {
            const p = positions.get(node.id);
            if (p === undefined) return null;
            const classes = [
              'scene-node',
              !node.reachable ? 'unreachable' : '',
              node.deadEnd ? 'dead-end' : '',
              node.id === selectedA || node.id === selectedB ? 'selected' : '',
              highlight?.nodes.has(node.id) === true ? 'on-path' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <g
                key={node.id || '(start)'}
                className={classes}
                transform={`translate(${p.x}, ${p.y})`}
                data-knot={node.id}
                onClick={(e) => {
                  select(node.id, e.shiftKey);
                  if (!e.shiftKey && node.id !== START_NODE) onOpenKnot(node.file, node.offset);
                }}
              >
                <title>
                  {node.label}
                  {!node.reachable ? ' — unreachable (F525)' : ''}
                  {node.deadEnd ? ' — no route to END (F526)' : ''}
                </title>
                <rect width={layout.nodeWidth} height={layout.nodeHeight} rx={8} />
                <text x={10} y={20} fontWeight={600}>
                  {node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label}
                </text>
                <text className="scene-badges" x={10} y={38}>
                  {node.choices} ch · {node.words} w{node.ending ? ' · END' : ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="scene-stats">
        <span>
          knots <b>{graph.stats.knots}</b>
        </span>
        <span>
          words <b>{graph.stats.words}</b>
        </span>
        <span>
          endings <b>{graph.stats.endings}</b>
        </span>
        <span>
          branch factor <b>{graph.stats.branchFactor}</b>
        </span>
        <span>
          depth <b>{graph.stats.maxDepth}</b>
        </span>
        <span>
          unreachable <b>{graph.stats.unreachable}</b>
        </span>
        <span>
          dead ends <b>{graph.stats.deadEnds}</b>
        </span>
      </div>
    </div>
  );
}
