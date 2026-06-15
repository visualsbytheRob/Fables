# Epic 18 — Spaced Repetition & Learning

Turning your notes into durable memory. A faithful FSRS-5 scheduler, card
authoring straight from note content, decks as live filters, story-driven review
(due cards become fables), insights, habit support, and Anki interop — F1701–
F1800, built across ten green batches. Inspired by Greg McDonald's **Socrates**
(see `docs/credits.md`).

## What shipped (server-side)

### Scheduler Core (F1701–F1710)

A dependency-free **FSRS-5** implementation (`learning/fsrs.ts`, 19 default
weights) modelling each card's stability + difficulty. Card model + an immutable
review log (migration 035), a timezone-correct due queue, new-card limits,
suspend/bury, and orphan-on-note-delete. Verified against the exact
forgetting-curve identities and monotonicity properties (below).

### Card Authoring (F1711–F1720)

Cloze (multi-index), Q&A blocks, and definition/list auto-suggestions
(`learning/extract.ts`); a **live-link sync** that reconciles a note's cards by
block-ref while preserving review history; a filtered card browser.

### Review Experience (F1721–F1730, server core)

Undo-last-rating (restores the prior FSRS state and drops the log row) and a
review session summary. The phone-first review UI is the web layer.

### Story-Driven Learning (F1731–F1740)

`generateReviewStory` turns due cards into a **provably-compilable Fable Forge
"review fable"**; a mastery gate by current retrievability; card creation from
story source.

### Decks & Organization (F1741–F1750)

Decks as dynamic saved card-filters (migration 036) with per-deck scheduler
settings, dashboards + forecast, cross-deck review, tag/notebook composition,
`.fdeck` export/import, and custom study.

### Memory Insights (F1751–F1760)

True retention, review heatmap, workload forecast, difficulty distribution, leech
detection + remediation, knowledge coverage, and review streaks — all computed
locally from the review log.

### Sibling & Edge Cases (F1761–F1770)

Sibling spacing, duplicate detection, vacation mode, catch-up caps, priority
overrides, and max-interval (migration 037); a polished `/review/session`.

### Notifications & Habits (F1771–F1780, server core)

Best-review-time analysis, non-nagging reminder copy with quiet-hours
suppression, and a weekly learning digest note.

### Anki Interop (F1781–F1790)

`.apkg` import (ZIP → SQLite collection → cards, with SM-2→FSRS scheduling
translation + media), `.apkg` export, round-trip fidelity, and a large-collection
benchmark — all on the hand-written ZIP reader/writer, no new deps.

### Epic Close (F1791–F1800)

A full learning-loop e2e (note → cards → reviews → retention → review fable), a
phone-session performance check, the user guide (`docs/learning/guide.md`), and
this retro.

## Scientific honesty (F1796)

The scheduler is **FSRS-5 implemented from its published formulas**, not an
approximation dressed up as one. Two claims are pinned by exact mathematical
identities in `fsrs.test.ts`, which would fail if the constants drifted:

- `retrievability(S, S) === 0.9` — by definition, stability is the interval at
  which recall probability is 90%.
- `intervalForRetention(S, 0.9) === S` — the inverse holds exactly.

Beyond those, the tests assert only **directional** properties we can defend:
better grades give longer intervals, lapses never grow stability, difficulty
stays in [1, 10], intervals trend up across successful reviews. We do **not**
claim conformance to any external optimizer's fitted parameters, nor that the
defaults are optimal for any individual — `requestRetention` and the weights are
tunable, and per-user weight optimization (F1704) is explicitly deferred, with
the full review log captured so it can be built honestly later.

## Privacy (F1799)

Every learning analytic — retention, heatmap, streaks, leeches, coverage, the
weekly digest — is computed locally from the on-device review log and returned to
the caller. Nothing is sent anywhere; the insights repo has no network surface.
Anki import/export reads and writes local files only.

## Deferred-with-reason (the web/UX layer)

The phone-first review UI, answer animations, editor-gutter card preview, image
occlusion, local notifications + badge + deep-links, and the settings
consolidation page are the web/PWA pass; the server ships the scheduler, queue,
authoring extractors, decks, insights, habit logic, and interop they drive — all
tested. Per-user FSRS weight optimization (F1704), multi-step relearning
execution (F1768), and the custom-card-type plugin API (F1798) are queued.

## Migrations

035 (cards + review log), 036 (decks), 037 (learning settings). Numbered,
append-only, listed in `db.test.ts`.

## Tests

~3,300 green across ~310 files at the Epic-18 checkpoint, including the FSRS
identity/property suite, the extraction + story-gen compile checks, the decks +
insights + edge + habits suites, the Anki round-trip + scaling benchmark, and the
end-to-end learning-loop test.
