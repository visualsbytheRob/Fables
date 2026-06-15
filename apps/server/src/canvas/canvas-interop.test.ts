import { describe, it, expect } from 'vitest';
import { importObsidianCanvas, importExcalidraw } from './canvas-interop.js';

// ---------------------------------------------------------------------------
// importObsidianCanvas
// ---------------------------------------------------------------------------

describe('importObsidianCanvas', () => {
  const minimalCanvas = JSON.stringify({
    nodes: [
      { id: 'n1', type: 'text', x: 10, y: 20, width: 100, height: 50, text: 'Hello world' },
      { id: 'n2', type: 'file', x: 200, y: 20, width: 150, height: 80, file: 'notes/foo.md' },
    ],
    edges: [{ id: 'e1', fromNode: 'n1', toNode: 'n2', label: 'links to' }],
  });

  it('maps text node to kind "text" with correct coords', () => {
    const { objects } = importObsidianCanvas(minimalCanvas);
    const n1 = objects.find((o) => o.id === 'n1')!;
    expect(n1.kind).toBe('text');
    expect(n1.x).toBe(10);
    expect(n1.y).toBe(20);
    expect(n1.width).toBe(100);
    expect(n1.height).toBe(50);
    expect(n1.data?.['text']).toBe('Hello world');
  });

  it('maps file node to kind "note" with file in data', () => {
    const { objects } = importObsidianCanvas(minimalCanvas);
    const n2 = objects.find((o) => o.id === 'n2')!;
    expect(n2.kind).toBe('note');
    expect(n2.data?.['file']).toBe('notes/foo.md');
  });

  it('maps link node to kind "embed" with url', () => {
    const linkCanvas = JSON.stringify({
      nodes: [
        { id: 'l1', type: 'link', x: 0, y: 0, width: 200, height: 100, url: 'https://example.com' },
      ],
      edges: [],
    });
    const { objects } = importObsidianCanvas(linkCanvas);
    expect(objects[0]!.kind).toBe('embed');
    expect(objects[0]!.data?.['url']).toBe('https://example.com');
  });

  it('maps group node to kind "group"', () => {
    const groupCanvas = JSON.stringify({
      nodes: [{ id: 'g1', type: 'group', x: 0, y: 0, width: 500, height: 400, label: 'My Group' }],
      edges: [],
    });
    const { objects } = importObsidianCanvas(groupCanvas);
    expect(objects[0]!.kind).toBe('group');
    expect(objects[0]!.data?.['label']).toBe('My Group');
  });

  it('converts edges to EdgeDraft with fromId / toId and label', () => {
    const { edges } = importObsidianCanvas(minimalCanvas);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.fromId).toBe('n1');
    expect(edges[0]!.toId).toBe('n2');
    expect(edges[0]!.kind).toBe('line');
    expect(edges[0]!.label).toBe('links to');
  });

  it('handles missing edges array', () => {
    const noEdges = JSON.stringify({
      nodes: [{ id: 'x', type: 'text', x: 0, y: 0, width: 100, height: 50 }],
    });
    const { edges } = importObsidianCanvas(noEdges);
    expect(edges).toHaveLength(0);
  });

  it('throws on invalid JSON', () => {
    expect(() => importObsidianCanvas('not json')).toThrow(/invalid JSON/i);
  });

  it('throws when nodes is missing', () => {
    expect(() => importObsidianCanvas(JSON.stringify({ edges: [] }))).toThrow(/nodes/i);
  });
});

// ---------------------------------------------------------------------------
// importExcalidraw
// ---------------------------------------------------------------------------

describe('importExcalidraw', () => {
  const rectId = 'rect-1';
  const textId = 'text-1';
  const arrowId = 'arrow-1';

  const excalidrawDoc = JSON.stringify({
    type: 'excalidraw',
    elements: [
      { id: rectId, type: 'rectangle', x: 0, y: 0, width: 120, height: 80, isDeleted: false },
      { id: textId, type: 'text', x: 150, y: 10, width: 60, height: 30, text: 'Label' },
      {
        id: arrowId,
        type: 'arrow',
        x: 0,
        y: 0,
        width: 100,
        height: 5,
        startBinding: { elementId: rectId },
        endBinding: { elementId: textId },
      },
      { id: 'del-1', type: 'rectangle', x: 300, y: 300, width: 50, height: 50, isDeleted: true },
    ],
  });

  it('maps rectangle to kind "shape" with shape data', () => {
    const { objects } = importExcalidraw(excalidrawDoc);
    const rect = objects.find((o) => o.id === rectId)!;
    expect(rect.kind).toBe('shape');
    expect(rect.data?.['shape']).toBe('rectangle');
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(120);
    expect(rect.height).toBe(80);
  });

  it('maps text element to kind "text" with text data', () => {
    const { objects } = importExcalidraw(excalidrawDoc);
    const text = objects.find((o) => o.id === textId)!;
    expect(text.kind).toBe('text');
    expect(text.data?.['text']).toBe('Label');
  });

  it('produces exactly 2 objects (deleted and arrow excluded)', () => {
    const { objects } = importExcalidraw(excalidrawDoc);
    expect(objects).toHaveLength(2);
    expect(objects.every((o) => o.id !== 'del-1')).toBe(true);
    expect(objects.every((o) => o.id !== arrowId)).toBe(true);
  });

  it('produces 1 edge from the bound arrow', () => {
    const { edges } = importExcalidraw(excalidrawDoc);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.fromId).toBe(rectId);
    expect(edges[0]!.toId).toBe(textId);
    expect(edges[0]!.kind).toBe('line');
  });

  it('skips deleted elements', () => {
    const { objects } = importExcalidraw(excalidrawDoc);
    const ids = objects.map((o) => o.id);
    expect(ids).not.toContain('del-1');
  });

  it('normalizes negative width/height', () => {
    const doc = JSON.stringify({
      type: 'excalidraw',
      elements: [{ id: 'neg', type: 'rectangle', x: 100, y: 200, width: -60, height: -40 }],
    });
    const { objects } = importExcalidraw(doc);
    const o = objects[0]!;
    expect(o.x).toBe(40); // 100 + (-60)
    expect(o.y).toBe(160); // 200 + (-40)
    expect(o.width).toBe(60);
    expect(o.height).toBe(40);
  });

  it('arrow without both bindings is skipped (not emitted as edge or object)', () => {
    const doc = JSON.stringify({
      type: 'excalidraw',
      elements: [
        {
          id: 'a1',
          type: 'arrow',
          x: 0,
          y: 0,
          width: 50,
          height: 5,
          startBinding: { elementId: 'x' },
        },
      ],
    });
    const { objects, edges } = importExcalidraw(doc);
    expect(objects).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it('throws on invalid JSON', () => {
    expect(() => importExcalidraw('bad')).toThrow(/invalid JSON/i);
  });

  it('throws when elements array is missing', () => {
    expect(() => importExcalidraw(JSON.stringify({ type: 'excalidraw' }))).toThrow(/elements/i);
  });
});
