/**
 * Canvas graph renderer (F241–F245, F248, F249): draws the force layout with
 * devicePixelRatio-aware crispness, pan/zoom (wheel, drag, two-pointer
 * pinch), node drag, hover neighborhood highlight, single-click popover
 * callback and double-click navigation, community colors, degree sizing,
 * and a freeze toggle. No graph/rendering dependencies.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { GraphEdge, GraphNode } from '../api/client.js';
import { createSimulation, type LayoutSettings, type Simulation } from './simulation.js';

export interface GraphCanvasHandle {
  /** Center the viewport on a node (graph search, F248). */
  centerOn(nodeId: string): void;
}

export interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: LayoutSettings;
  frozen: boolean;
  /** Highlight + center this node when it changes (F248). */
  focusNodeId?: string | null;
  onNodeClick?: (node: GraphNode, screen: { x: number; y: number }) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
  onBackgroundClick?: () => void;
  height?: number | string;
}

export const communityColor = (community: number): string =>
  `hsl(${(community * 137.508) % 360} 62% 55%)`;

export const nodeRadius = (degree: number): number => Math.min(14, 3.5 + Math.sqrt(degree) * 1.8);

interface Transform {
  x: number;
  y: number;
  scale: number;
}

export function GraphCanvas({
  nodes,
  edges,
  layout,
  frozen,
  focusNodeId = null,
  onNodeClick,
  onNodeDoubleClick,
  onBackgroundClick,
  height = '100%',
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation | null>(null);
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const hoverRef = useRef<string | null>(null);
  const dirtyRef = useRef(true);
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  const callbacksRef = useRef({ onNodeClick, onNodeDoubleClick, onBackgroundClick });
  callbacksRef.current = { onNodeClick, onNodeDoubleClick, onBackgroundClick };

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const n of nodes) map.set(n.id, new Set());
    for (const e of edges) {
      map.get(e.source)?.add(e.target);
      map.get(e.target)?.add(e.source);
    }
    return map;
  }, [nodes, edges]);

  // (Re)build the simulation when the dataset changes.
  useEffect(() => {
    simRef.current = createSimulation(
      nodes.map((n) => ({ id: n.id, degree: n.degree })),
      edges,
      { ...layout },
    );
    dirtyRef.current = true;
  }, [nodes, edges]);

  // Layout settings changes re-heat the existing layout instead of resetting it.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.settings.gravity = layout.gravity;
    sim.settings.linkDistance = layout.linkDistance;
    sim.settings.repulsion = layout.repulsion;
    sim.reheat();
    dirtyRef.current = true;
  }, [layout]);

  // Center on the focused node (search).
  useEffect(() => {
    if (!focusNodeId) return;
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas) return;
    const node = sim.nodes.find((n) => n.id === focusNodeId);
    if (!node) return;
    const t = transformRef.current;
    t.scale = Math.max(t.scale, 1.2);
    t.x = canvas.clientWidth / 2 - node.x * t.scale;
    t.y = canvas.clientHeight / 2 - node.y * t.scale;
    dirtyRef.current = true;
  }, [focusNodeId]);

  // Render + interaction wiring.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      return dpr;
    };

    // Initial view: origin at canvas center.
    if (transformRef.current.x === 0 && transformRef.current.y === 0) {
      transformRef.current.x = canvas.clientWidth / 2;
      transformRef.current.y = canvas.clientHeight / 2;
    }

    const styles = () => {
      const cs = getComputedStyle(canvas);
      return {
        edge: cs.getPropertyValue('--border').trim() || '#3a3a44',
        dim: 'rgba(128,128,140,0.18)',
        label: cs.getPropertyValue('--text').trim() || '#ddd',
        halo: cs.getPropertyValue('--accent').trim() || '#7aa2f7',
      };
    };

    const draw = () => {
      const dpr = fit();
      const t = transformRef.current;
      const sim = simRef.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!sim) return;
      ctx.translate(t.x, t.y);
      ctx.scale(t.scale, t.scale);

      const palette = styles();
      const hovered = hoverRef.current;
      const hoodlum = hovered ? neighbors.get(hovered) : null;
      const inHood = (id: string) => !hovered || id === hovered || hoodlum?.has(id) === true;

      const pos = new Map(sim.nodes.map((n) => [n.id, n]));

      // Edges first.
      for (const e of edges) {
        const a = pos.get(e.source);
        const b = pos.get(e.target);
        if (!a || !b) continue;
        const lit = !hovered || e.source === hovered || e.target === hovered;
        ctx.strokeStyle = lit ? palette.edge : palette.dim;
        ctx.lineWidth = Math.min(3, 0.6 + e.weight * 0.4) / t.scale;
        ctx.globalAlpha = lit ? 0.85 : 0.25;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Nodes.
      for (const sn of sim.nodes) {
        const meta = nodeById.get(sn.id);
        if (!meta) continue;
        const r = nodeRadius(meta.degree);
        const lit = inHood(sn.id);
        ctx.beginPath();
        ctx.arc(sn.x, sn.y, r, 0, Math.PI * 2);
        ctx.fillStyle = lit ? communityColor(meta.community) : palette.dim;
        ctx.fill();
        if (sn.id === hovered || sn.id === focusNodeId) {
          ctx.strokeStyle = palette.halo;
          ctx.lineWidth = 2 / t.scale;
          ctx.stroke();
        }
      }

      // Labels at readable zoom, hovered neighborhood only when hovering.
      if (t.scale > 0.7) {
        ctx.fillStyle = palette.label;
        ctx.font = `${11 / t.scale}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        for (const sn of sim.nodes) {
          const meta = nodeById.get(sn.id);
          if (!meta || !inHood(sn.id)) continue;
          if (!hovered && t.scale <= 1.1 && meta.degree < 3) continue;
          ctx.fillText(
            meta.title || 'Untitled',
            sn.x,
            sn.y + nodeRadius(meta.degree) + 12 / t.scale,
          );
        }
      }
    };

    let raf = 0;
    const loop = () => {
      const sim = simRef.current;
      let ticked = false;
      if (sim && !frozenRef.current && !sim.settled) {
        sim.tick();
        ticked = true;
      }
      if (ticked || dirtyRef.current) {
        dirtyRef.current = false;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const toWorld = (sx: number, sy: number) => {
      const t = transformRef.current;
      return { x: (sx - t.x) / t.scale, y: (sy - t.y) / t.scale };
    };

    const hitTest = (sx: number, sy: number): string | null => {
      const sim = simRef.current;
      if (!sim) return null;
      const { x, y } = toWorld(sx, sy);
      const t = transformRef.current;
      let best: string | null = null;
      let bestDist = Infinity;
      for (const sn of sim.nodes) {
        const meta = nodeById.get(sn.id);
        const r = nodeRadius(meta?.degree ?? 0) + 6 / t.scale;
        const dx = sn.x - x;
        const dy = sn.y - y;
        const d = dx * dx + dy * dy;
        if (d <= r * r && d < bestDist) {
          best = sn.id;
          bestDist = d;
        }
      }
      return best;
    };

    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    // Pointer state: pan, node drag, or two-pointer pinch.
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'idle' | 'pan' | 'drag' | 'pinch' = 'idle';
    let dragNodeId: string | null = null;
    let pinchStart = { dist: 0, scale: 1, cx: 0, cy: 0 };
    let moved = false;

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      moved = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = {
          dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          scale: transformRef.current.scale,
          cx: (a!.x + b!.x) / 2,
          cy: (a!.y + b!.y) / 2,
        };
        mode = 'pinch';
        return;
      }
      const hit = hitTest(p.x, p.y);
      if (hit) {
        mode = 'drag';
        dragNodeId = hit;
      } else {
        mode = 'pan';
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = local(e);
      if (!pointers.has(e.pointerId)) {
        // Plain hover.
        const hit = hitTest(p.x, p.y);
        if (hit !== hoverRef.current) {
          hoverRef.current = hit;
          canvas.style.cursor = hit ? 'pointer' : 'grab';
          dirtyRef.current = true;
        }
        return;
      }
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, p);
      if (Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) > 1) moved = true;
      const t = transformRef.current;

      if (mode === 'pinch' && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinchStart.dist > 0) {
          const next = Math.min(5, Math.max(0.1, pinchStart.scale * (dist / pinchStart.dist)));
          const wx = (pinchStart.cx - t.x) / t.scale;
          const wy = (pinchStart.cy - t.y) / t.scale;
          t.scale = next;
          t.x = pinchStart.cx - wx * next;
          t.y = pinchStart.cy - wy * next;
          dirtyRef.current = true;
        }
        return;
      }
      if (mode === 'drag' && dragNodeId) {
        const sim = simRef.current;
        const node = sim?.nodes.find((n) => n.id === dragNodeId);
        if (node && sim) {
          const w = toWorld(p.x, p.y);
          node.x = w.x;
          node.y = w.y;
          node.fixed = true;
          node.vx = 0;
          node.vy = 0;
          if (!frozenRef.current) sim.reheat(0.25);
          dirtyRef.current = true;
        }
        return;
      }
      if (mode === 'pan') {
        t.x += p.x - prev.x;
        t.y += p.y - prev.y;
        dirtyRef.current = true;
      }
    };

    let clickTimer = 0;
    const onPointerUp = (e: PointerEvent) => {
      const p = local(e);
      pointers.delete(e.pointerId);
      const wasMode = mode;
      if (pointers.size === 0) mode = 'idle';
      if (wasMode === 'drag' && dragNodeId) {
        const node = simRef.current?.nodes.find((n) => n.id === dragNodeId);
        if (node) node.fixed = false;
        dragNodeId = null;
      }
      if (moved) return;
      // Tap: delay the single-click so a double-click can cancel it.
      const hit = hitTest(p.x, p.y);
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => {
        const cb = callbacksRef.current;
        if (hit) {
          const meta = nodeById.get(hit);
          if (meta) cb.onNodeClick?.(meta, { x: p.x, y: p.y });
        } else {
          cb.onBackgroundClick?.();
        }
      }, 220);
    };

    const onDoubleClick = (e: MouseEvent) => {
      window.clearTimeout(clickTimer);
      const p = local(e);
      const hit = hitTest(p.x, p.y);
      if (hit) {
        const meta = nodeById.get(hit);
        if (meta) callbacksRef.current.onNodeDoubleClick?.(meta);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;
      const p = local(e);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = Math.min(5, Math.max(0.1, t.scale * factor));
      const wx = (p.x - t.x) / t.scale;
      const wy = (p.y - t.y) / t.scale;
      t.scale = next;
      t.x = p.x - wx * next;
      t.y = p.y - wy * next;
      dirtyRef.current = true;
    };

    const onLeave = () => {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        dirtyRef.current = true;
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const resize =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            dirtyRef.current = true;
          })
        : null;
    resize?.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(clickTimer);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('wheel', onWheel);
      resize?.disconnect();
    };
  }, [edges, neighbors, nodeById, focusNodeId]);

  return (
    <canvas
      ref={canvasRef}
      className="graph-canvas"
      style={{ width: '100%', height, touchAction: 'none', display: 'block' }}
      aria-label="Note graph"
      role="img"
    />
  );
}
