# Canvas & Spatial Views — infinite spatial thinking

The Canvas is an infinite 2-D surface where your knowledge becomes _spatial_. Pin
notes as cards, arrange them in mind-maps, connect them with arrows or story-beats,
drag a query result onto the surface to live-update as your graph changes. All of
this — positioning, grouping, zooming, panning — persists and syncs instantly.

Fables believes thinking isn't always linear. Sometimes you need to see how ideas
relate _spatially_, the way you'd arrange index cards on a cork board.

## What ships in the engine (Epic 16)

The Canvas is built on a **server-side spatial data model** that handles all the
hard math — hit-testing, viewport culling, snapping, auto-layout, and connector
routing — so the web layer stays fast and predictable.

### Objects & kinds

Every card on the canvas is an **Object** with a bounding box and metadata:

| Property   | What it is                                                   |
| ---------- | ------------------------------------------------------------ |
| `x, y`     | top-left corner in canvas coordinates                        |
| `width`    | card width (note: text cards can auto-fit)                   |
| `height`   | card height                                                  |
| `z`        | layer order (higher = on top)                                |
| `rotation` | angle in degrees; locked objects ignore rotation if disabled |
| `locked`   | true if pinned, won't respond to drag/delete/group edits     |
| `group`    | optional UUID; grouped objects move/lock/delete as one       |
| `kind`     | type of card: see table below                                |

**Card kinds:**

| Kind     | What it holds                                                         |
| -------- | --------------------------------------------------------------------- |
| `note`   | link to a vault note; title + preview; updates if note changes        |
| `entity` | link to an entity (character, place, object); shows avatar + metadata |
| `text`   | static text label or annotation                                       |
| `sticky` | a mini note pasted directly on the canvas (no backlink)               |
| `image`  | embedded image or screenshot; copyable + draggable                    |
| `query`  | live FQL selection (saved query); refreshes as vault changes          |
| `embed`  | iframe or rich-media embed (video, audio, web page)                   |
| `shape`  | rectangle, circle, line, polygon — for diagramming                    |
| `knot`   | story knot; shows choice-tree preview + branch counts                 |
| `group`  | visual container (no content, just grouping + visual styling)         |

### Spatial index & viewport

The Canvas uses a **bounding-volume R-tree** for fast spatial queries. When you
pan/zoom, only the objects in your viewport are sent to the browser — no matter if
you have 50 or 5,000 cards on the canvas. When you query with a region bound
(`?region=minX,minY,maxX,maxY`), the server returns just the visible cards.

### Snapping & alignment guides

Drag a card and it magnetically clicks into alignment with:

- Neighbors' **left/right edges** and **centers**
- Neighbors' **top/bottom edges** and **centers**
- An optional **grid** (if enabled in canvas settings)

Guides appear as faint lines during drag. Smart spacing is an option — align to
the nearest edge rather than forcing perfect grid positions. Snapping can be
toggled off in real-time.

### Undo/redo

The Canvas tracks every edit as a **reversible command**:

- Move, rotate, resize
- Group/ungroup (reparenting objects)
- Lock/unlock
- Bring to front, send to back (z-order changes)
- Add/delete objects
- Connector edits (add/remove edges, change routing)

The stack is **unlimited and instant** — every undo/redo is a single transaction,
so even 1,000 objects move together without lag. Locked objects never move
unexpectedly; their lock state travels with the undo.

### Autosave & persistence

Every edit is **snapshotted automatically** — the full Object set is atomically
committed to the database on every mutation. You won't lose work if the browser
tabs crash or the device loses power. Snapshots are compact (JSON) and ordered by
timestamp, so you can diff or restore to a prior canvas state if needed.

### Auto-layout

Arrange a selected group of cards automatically:

- **Grid:** rows × columns, with custom spacing
- **Hierarchical tree:** children flow top-down or left-right from a root
- **Force-directed graph:** nodes repel, edges contract — great for knowledge maps

Each layout respects locked objects — they stay in place and others flow around
them.

### Connectors

**Edges** link two objects with typed connections:

- **Arrow:** labeled edge with a direction; shows a label + arrowhead
- **Link:** connects two note cards _and_ creates a real backlink in your graph
  (so moving the connector updates the note's link metadata)
- **Journey:** waypoint sequence for story beats; shows flow with numbers

Edges are **routed** as:

- **Orthogonal:** right-angle paths, great for hierarchies
- **Curve:** smooth Bézier splines, better for organic diagrams

Labels live on the connector; hover to edit. Connectors can be locked like any object.

### Ink (freehand drawing)

Draw freehand strokes directly on the canvas with a stylus or trackpad:

- **Pressure-sensitive** strokes (on compatible devices)
- **Smoothed** with a Ramer-Douglas-Peucker simplification algorithm (reduces
  jitter, keeps sharp corners)
- **Stored compactly** as a sequence of (x, y, pressure, width) points
- **Undoable** like any other edit

Perfect for quick sketches, annotations, or spatial notes on a touch device.

## REST API sketch

Canvas endpoints live under `/api/v1`:

```
POST   /canvas                        Create a new canvas
GET    /canvas                        List all canvases
GET    /canvas/:id                    Get a canvas + all objects
GET    /canvas/:id?region=minX,...    Get objects in a viewport region
PATCH  /canvas/:id                    Rename a canvas
DELETE /canvas/:id                    Delete a canvas & all objects

PUT    /canvas/:id/objects            Autosave the full object set (bulk upsert)

POST   /canvas/:id/edges              Create a connector
GET    /canvas/:id/edges              List connectors
PATCH  /canvas/:id/edges/:edgeId      Edit a connector (routing, label, etc.)
DELETE /canvas/:id/edges/:edgeId      Delete a connector
```

Request bodies are JSON: `{ name, description, defaultGridSize?, ... }` for
canvas settings, and Objects/Edges are typed by their `kind` field.

## What's next: the visual layer

**Important caveat:** The actual _rendered_ Canvas — pan/zoom at 60fps, the minimap,
selection tools, on-screen drawing — lives in the React web app (`apps/web`) and
is a separate implementation pass. This doc covers the _data model_ and _server_
side that makes it possible.

The server does the heavy lifting (spatial math, conflict resolution, layout
algorithms, routing); the browser focuses on smooth interaction and beautiful
rendering. Think of this as the "physics engine" and the visual layer as the
"graphics renderer" — they'll ship independently but speak the same language.

---

_Canvas & Spatial Views is Epic 16 of the 2,026-feature Fables journey._
