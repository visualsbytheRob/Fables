# Fables Web — Performance Budget (F921)

## Initial load targets

| Metric | Budget | Current (CI baseline) | Method |
|---|---|---|---|
| Initial JS (gzip) | ≤ 350 KB | ~111 KB | `check-bundle-size.mjs` |
| Total JS (gzip) | ≤ 2048 KB | ~1902 KB | `check-bundle-size.mjs` |
| Time to Interactive | < 2 s (localhost) | Not measured | Lighthouse |
| Route navigation | < 200 ms | Not measured | React DevTools |
| Search response | < 100 ms | Not measured | API + debounce |

## Code splitting (F922)

All heavy routes are `lazy()`-loaded off the initial chunk:
- `NoteEditorPane` (CodeMirror + markdown pipeline) — ~95 KB gzip, loads only when a note opens
- `GraphPage` (force-directed canvas) — ~1.7 KB entry + cytoscape ~138 KB gzip
- `PlayerPage` (forge compiler + VM) — ~14 KB gzip entry
- `ForgePlaygroundPage` — ~2.1 KB gzip entry + compile ~13.7 KB
- `InsightsPage` (SVG charts) — ~3.5 KB gzip
- `AnalyticsPage`, `SettingsPage` — ~1.7–1.8 KB gzip each

## List virtualization (F925)

All long lists use `computeWindow()` from `notes/windowing.ts`:
- Note list (NoteList.tsx): `ROW_HEIGHT=72px`, overscan=5 → renders ≤ ~20 rows at any scroll position regardless of vault size (tested up to 10k notes)
- Search results: capped at 5 per group by the API
- Timeline: grouped items, no unbounded scroll
- Query results: paginated via infinite scroll

Windowing math is verified in `notes/windowing.test.ts` and `notes/windowing.edge.test.ts`.

## Image loading (F926)

- Attachments in the editor preview: loaded via `<img loading="lazy">` (set by the preview renderer)
- No large hero images in the app shell
- Attachment thumbnails are served from the local server — no CDN, no external images

## Graph view (F929)

Frame-rate target: 60fps at 2k nodes.
- Canvas uses `will-change: transform` for GPU compositing
- Force simulation pauses when the browser tab is hidden (`visibilitychange` listener)
- Simulation cools down (alpha < 0.001) and stops automatically
- For real FPS measurement: Chrome DevTools → Performance tab → record while interacting with the graph with a seeded 2k-node vault (`pnpm seed --count 2000`)

## Regression gate

The `scripts/check-bundle-size.mjs` script runs in CI (`pnpm build && node scripts/check-bundle-size.mjs`) and fails the build if:
- Initial entry JS exceeds 350 KB gzip
- Total JS exceeds 2048 KB gzip

_Last reviewed: 2026-06-13 (Day 10)_
