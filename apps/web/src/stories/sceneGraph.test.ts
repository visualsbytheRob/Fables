/**
 * Scene graph tests (F521–F530) — run against real fixture stories from
 * packages/forge-dsl/fixtures/corpus plus targeted synthetic sources.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '@fables/forge-dsl';
import {
  buildSceneGraph,
  edgeKey,
  graphToSvg,
  knotWordCount,
  nodePositions,
  pathsBetween,
  START_NODE,
} from './sceneGraph.js';

const fixture = (name: string): string =>
  readFileSync(
    new URL(`../../../../packages/forge-dsl/fixtures/corpus/${name}`, import.meta.url),
    'utf8',
  );

const graphOf = (source: string) => buildSceneGraph(compile(source));

describe('buildSceneGraph (F521–F523)', () => {
  it('builds nodes and edges for the fox-and-crow fixture', () => {
    const graph = graphOf(fixture('23-fox-and-crow.fable'));
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain(START_NODE);
    expect(ids).toContain('meeting');
    expect(ids).toContain('waiting');
    expect(ids).toContain('drop');

    const keys = graph.edges.map(edgeKey);
    expect(keys).toContain('→meeting'); // start → meeting
    expect(keys).toContain('meeting→waiting');
    expect(keys).toContain('waiting→meeting');
    expect(keys).toContain('meeting→drop'); // tunnel call counts as flow
  });

  it('badges nodes with choice and word counts (F523)', () => {
    const graph = graphOf(fixture('23-fox-and-crow.fable'));
    const meeting = graph.nodes.find((n) => n.id === 'meeting');
    expect(meeting?.choices).toBeGreaterThanOrEqual(4);
    expect(meeting?.words).toBeGreaterThan(10);
    const drop = graph.nodes.find((n) => n.id === 'drop');
    expect(drop?.choices).toBe(0);
  });

  it('flags unreachable knots (F525) and dead ends (F526)', () => {
    const graph = graphOf(
      [
        '-> a',
        '',
        '=== a ===',
        'Choose.',
        '* Go on.',
        '  -> b',
        '+ Loop.',
        '  -> trap',
        '',
        '=== b ===',
        'Done.',
        '-> END',
        '',
        '=== trap ===',
        'No way out.',
        '-> trap',
        '',
        '=== island ===',
        'Nobody diverts here.',
        '-> END',
        '',
      ].join('\n'),
    );
    expect(graph.nodes.find((n) => n.id === 'island')?.reachable).toBe(false);
    expect(graph.nodes.find((n) => n.id === 'trap')?.deadEnd).toBe(true);
    expect(graph.nodes.find((n) => n.id === 'b')?.deadEnd).toBe(false);
    expect(graph.nodes.find((n) => n.id === 'a')?.deadEnd).toBe(false);
    expect(graph.stats.unreachable).toBe(1);
    expect(graph.stats.deadEnds).toBe(1);
  });

  it('lays out layers monotonically along diverts (F522)', () => {
    const graph = graphOf('-> a\n\n=== a ===\n-> b\n\n=== b ===\n-> c\n\n=== c ===\n-> END\n');
    const layer = (id: string) => graph.nodes.find((n) => n.id === id)?.layer ?? -1;
    expect(layer(START_NODE)).toBe(0);
    expect(layer('a')).toBe(1);
    expect(layer('b')).toBe(2);
    expect(layer('c')).toBe(3);
    expect(graph.stats.maxDepth).toBe(3);
    const positions = nodePositions(graph);
    expect((positions.get('b')?.x ?? 0) > (positions.get('a')?.x ?? 0)).toBe(true);
  });

  it('survives cycles in the divert graph', () => {
    const graph = graphOf(
      '-> a\n\n=== a ===\n-> b\n\n=== b ===\n* Again.\n  -> a\n+ Out.\n  -> END\n',
    );
    expect(graph.nodes.find((n) => n.id === 'b')?.layer).toBe(2);
    expect(graph.stats.endings).toBe(1);
  });

  it('computes story stats (F528)', () => {
    const graph = graphOf(fixture('24-lion-court-epic.fable'));
    expect(graph.stats.knots).toBeGreaterThanOrEqual(3);
    expect(graph.stats.words).toBeGreaterThan(50);
    expect(graph.stats.endings).toBeGreaterThanOrEqual(1);
    expect(graph.stats.branchFactor).toBeGreaterThan(0);
  });
});

describe('pathsBetween (F527)', () => {
  it('highlights every node and edge on routes between two knots', () => {
    const graph = graphOf(
      '-> a\n\n=== a ===\n* L.\n  -> b\n+ R.\n  -> c\n\n=== b ===\n-> d\n\n=== c ===\n-> d\n\n=== d ===\n-> END\n\n=== off ===\n-> END\n',
    );
    const { nodes, edges } = pathsBetween(graph, 'a', 'd');
    expect([...nodes].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(edges.has('a→b')).toBe(true);
    expect(edges.has('c→d')).toBe(true);
    expect(nodes.has('off')).toBe(false);
  });

  it('returns nothing when no route exists', () => {
    const graph = graphOf('-> a\n\n=== a ===\n-> END\n\n=== z ===\n-> END\n');
    const { nodes } = pathsBetween(graph, 'z', 'a');
    expect(nodes.size).toBe(0);
  });
});

describe('graphToSvg (F529)', () => {
  it('produces a standalone SVG with all node labels', () => {
    const graph = graphOf(fixture('23-fox-and-crow.fable'));
    const svg = graphToSvg(graph);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('meeting');
    expect(svg).toContain('waiting');
    expect(svg).toContain('marker-end');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('escapes XML in labels', () => {
    expect(graphToSvg(graphOf('-> a\n\n=== a ===\nHi.\n-> END\n'))).not.toContain('<script');
  });
});

describe('knotWordCount', () => {
  it('counts prose words, not markup', () => {
    const source = '-> a\n\n=== a ===\nThree little words.\n~ temp x = 1\n-> END\n';
    const result = compile(source);
    const knot = result.symbols.units[0]?.story.knots[0];
    expect(knot).toBeDefined();
    expect(knotWordCount(source, knot!)).toBe(3);
  });
});

describe('corpus smoke (F530)', () => {
  for (const name of ['01-hello.fable', '05-nested-choices.fable', '13-tunnels.fable']) {
    it(`builds a graph for ${name}`, () => {
      const graph = graphOf(fixture(name));
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(() => graphToSvg(graph)).not.toThrow();
    });
  }
});
