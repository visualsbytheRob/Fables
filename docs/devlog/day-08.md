# Day 8 — Search & Insights (rebuilt) (F701–F800)

**Shipped:** FTS5 full-text search with keyword queries, global search overlay, in-note find, related notes panel, and the insights dashboard. 1,461 tests green. Day 8 was rebuilt clean after an idle-gap loss; two process lessons adopted: commit-per-lane on green, and agents build directly rather than delegating to sub-agents.

## Full-Text Search (F701–F720)

- **Backend:** SQLite FTS5 virtual tables over notes (title, body), entities, and story source
  + transcripts, maintained by triggers on create/update/delete. BM25 ranking tuned with title
  weighting; <50ms query latency benchmarked at 10k notes. Phrase queries, prefix queries,
  NEAR operator supported. Rebuild + consistency-check commands.
- **Global search overlay (⌘⇧F):** grouped results (notes/entities/stories), keyboard navigation,
  FQL (F271) filter bar integration, recent searches + query suggestions, result preview pane
  on desktop widths, empty/no-result states, local search analytics for zero-result queries.
- **In-note find (⌘F):** match cycling within the current note.
- **Search tests:** FTS-specific tests covering ranking, snippet generation, trigger consistency.

## Related Notes Panel (F751–F760)

- Appears in note view sidebar: semantic neighbors + shared-link neighbors (hybrid approach
  using link-graph + co-mention heuristics until embeddings ship F721+).
- For stories in author mode: related entities for the current scene, "relevant lore"
  suggestions (binding suggestions for story text).
- Dismiss affordance per suggestion; don't-show-again feedback. Caching + background refresh
  under 100ms from cache. Similar-note detection on create (duplicate warning).
- Cross-type relatedness (note ↔ story scene ↔ entity) with configurable thresholds.

## Insights Dashboard (F791–F800)

- **Overview:** vault stats (notes, notebooks, entities, stories, links, orphan counts, words
  total) at a glance.
- **Growth chart:** per-day trends for notes/links/words over configurable date ranges.
- **Activity heatmap:** GitHub-style 365-day grid showing daily-note streaks + longest-streak
  badge.
- **Stale notes:** high-degree notes untouched 14+ days, sorted by importance.
- **Suggested links:** top unlinked-mention candidates for the weekly digest.
- **Reading insights:** story plays, turns, completion rates, top-scene heatmap.
- **Dead-ends report:** unified orphan notes + broken links list (read-only; one-click accept
  for suggested-links digest integration).
- **Vault health score:** 0–100 health metric with actionable checklist (note density, link
  diversity, maintenance gaps).
- **Weekly digest:** opt-in automated note generation pulling all above metrics into a
  shareable summary.
- Insights routes (F791–F800) pure aggregation over existing tables; no new deps.

## Incident & Process

Day 8 was built in parallel with Day 7's web halves (agent concurrency). The **first cut was
lost** when the idle-gap container (ephemeral, reclaiming unused resources) evicted the working
tree mid-session — search + insights code existed locally but was never committed. The work
was rebuilt clean from scratch, testing-first, and shipped.

**Two process lessons adopted:**
1. **Commit per lane on green:** each agent pushes immediately after reaching a passing test
   suite, not at session end. Prevents single-agent loss from cascading.
2. **Agents build directly:** agents implement features directly rather than delegating to
   sub-agents, keeping work localized and reducing coordination overhead.

## Completed: Document Ingestion & Voice (F761–F790)

The ingestion wave is now **fully complete**. PDF/EPUB/HTML document extraction, the web clipper
for URL articles, and Whisper.cpp voice transcription all shipped with graceful degradation:

- **PDF/EPUB/HTML ingestion** (F761–F770): text extraction with OCR fallback (tesseract-wasm)
  for scanned documents, page-anchored citations, auto-tagging, FTS indexing, and safe file-size
  handling.
- **Web clipper** (F771–F780): bookmarklet + iOS share-sheet integration, clipped articles land
  in an inbox notebook, with duplicate detection and failure recovery for paywalled pages.
- **Voice capture** (F781–F790): MediaRecorder for voice memos saved as attachments, Whisper.cpp
  integration for local transcription, audio player with transcript follow-along, and quick-capture
  voice-to-daily-note shortcut. All gracefully degrade if Whisper binary is unavailable.

---

## Deferred (next wave)

**F721–F750 (embeddings + hybrid search):** the local-intelligence layer is building now
(sentence-transformer embeddings, vector store, hybrid RRF ranking, fallback chain for
no-deps scenarios). Pure-JS fallback ensures graceful degradation when native models unavailable.

---

**Final:** 1,461 tests green. 766/2000 features complete. Day 8 (F701–F800) is fully shipped.
Next: F801 (PWA & offline).
