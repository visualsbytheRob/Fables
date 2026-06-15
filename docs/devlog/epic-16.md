# Epic 16 — Canvas & Spatial Views

The server foundation for an infinite spatial canvas: arrange your notes as cards,
connect them, lay them out, map your stories. Built across several green batches,
much of it by parallel Opus+2×Sonnet+Haiku agent teams.

## What shipped (server-side)

### Canvas Engine (F1501–F1510)

- **Document model** (F1502) + **autosave persistence** (F1508) — canvases and
  objects (note/entity/text/sticky/image/query/embed/shape/knot/group), migration
  028, snapshot-in-one-transaction autosave, DB-level region cull.
- **Spatial index** (F1503) — a bulk-loaded bounding-volume R-tree, **property-
  tested against brute force** (2k rects × 200 queries) and benchmarked at **10k
  objects** (F1591) — sub-2ms build, sub-1ms query.
- **Snapping & alignment** (F1505), **undo/group/lock editor** (F1506/F1507) —
  an inverse-recording command stack, exact unlimited undo, locked objects pinned.

### Connectors (F1521–F1530)

- Edges repo + routes (migration 029), **validity rules** (F1528), **edge routing**
  (orthogonal/curved, F1522), and the gem: a **"link" connector between two note
  cards writes a real link in the knowledge graph** (F1523) — drawing the line is
  writing the wikilink.

### Drawing (F1531–F1540)

- Ink math: Chaikin **smoothing** + Ramer–Douglas–Peucker **simplification** +
  compact delta **serialization** (F1531/F1533/F1538).

### Story Mapping (F1541)

- **`buildStoryMap`** parses Forge source → a knot card per knot + a divert
  connector per branch, tree-laid-out. The bridge between the Fable Forge compiler
  and the canvas.

### Boards (F1551–F1560)

- A Kanban engine: group notes by tag/field into columns, WIP limits, templates,
  and a pure `moveItem` that mutates the underlying field (F1551–1557). Route
  `POST /board`.

### Interop + Embedding (F1561–F1594)

- **Import Obsidian Canvas + Excalidraw** (F1594), **SVG export** (F1593),
  **note→canvas backlinks** (F1563), **canvas object search** (F1567), **deep
  links** to regions (F1562). Auto-layout (grid/tree/force, F1524).

### Auto-layout (F1524)

- `gridLayout` / `treeLayout` / `forceLayout` — pure, deterministic.

## Deferred-with-reason (the visual/web layer)

The rendered canvas is a dedicated web pass; the server data model, spatial math,
layout, routing, ink, boards, interop, and story-map generation it draws are all
shipped and tested. Deferred: pan/zoom rendering + LOD (F1501), 60fps render
benchmark (F1504), minimap (F1509), shape/eraser/lasso tools + drawing layers +
palm rejection (F1532/1534/1535/1537/1539), the **Touch & Mobile** group
(F1571–1580), the **Sync & Collab** group (F1581–1590, an Epic-12 CRDT
integration), keyboard spatial nav (F1592), the plugin API surface (F1595), demo
seed canvases (F1596), and PNG/PDF rasterization (F1593 ships SVG).

## Tests

~2,909 green across 252 files at this checkpoint. Every algorithm (spatial index,
layout, ink, routing, boards, interop, story-map, embedding) is driven by
in-process synthetic fixtures.
