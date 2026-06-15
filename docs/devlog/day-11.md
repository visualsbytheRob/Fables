# Day 11 — Epic 17 (Audio Fables): the first 70 + a CI rescue

Opened Epic 17 and shipped its server-side audio backend through audio export —
seven feature groups, F1601–F1670, each green-gated and pushed to `main`. Built
with the usual formation: an Opus orchestrator owning the collision points
(migrations, routes, registries, the green-gate) and Sonnet lanes on disjoint
pure-logic modules.

Test count moved 2,909 → **3,144 green** (281 files). Migrations 030–033 added.

## CI rescue (mid-session)

Discovered — from failure-email screenshots — that **every** push to `main` had
been failing CI for many commits (back into Epic 16), even though `pnpm test`
was green locally every time. Root cause: the 2,000-note import benchmark
(`epic-close.test.ts`, F1492) holds a 20s internal budget but ran under vitest's
default **5s** harness timeout; on CI's slower hardware vitest killed it before
the assertion. Local hardware finished in ~4s, hiding it. Fix: explicit 30s test
timeouts on that benchmark and the Forge compile benchmark (both had the same
"internal budget > harness default" mismatch). CI run #119 went green; the
email spam stopped. Lesson logged: run the _full_ CI command set locally
(`pnpm build`, `test:coverage`, bundle-size) — not just `test`/`typecheck`/`lint`.

## What shipped

### TTS Foundation (F1601–F1610)

A pluggable speech runtime that mirrors the Epic-14 AI runtime: `TtsRuntime` +
`TtsAdapter`, a `PiperAdapter` that shells out to a local Piper-class binary and
is gracefully unavailable when absent. Content-addressed synthesis cache (sha256
of text+voice+rate+pitch) with an LRU budget, a single-flight **priority queue**
so "speak this now" jumps ahead of a document render, per-vault voice settings,
an SSML-ish markup subset (`[pause]`, `*emphasis*`, `{rate:slow}`) and a
pronunciation lexicon. Routes under `/tts`. `docs/audio/tts.md`. Web Speech
fallback (F1604) is the web layer's; the server signals `available:false` to
trigger it.

### Voice Casting (F1611–F1620)

Pure dialogue-attribution (said-before/after, curly quotes, "the goblin",
known-speaker disambiguation), narrator-vs-character separation, and cast
resolution with fallback rules (narration→narrator, speaker→bySpeaker,
unknown→default→narrator). Per-entity voices + saved cast sheets + reusable
templates (migration 031). Routes `/casting/*`, `/stories/:id/cast`,
`/entities/:id/voice`.

### Narration Renderer (F1621–F1630)

`buildScene` turns a Forge story path into an ordered, voiced audio scene (line /
choice / earcon items) using the cast; `buildTimeline` is the audio-position ↔
text-position model. **Pre-render** bakes a path to one WAV via a hand-written
`wav.ts` (chunk-scanning parser, silence generator, concat) — no audio
dependency added. `realtimeRatio()` reports faster-than-realtime synthesis.
Routes `/stories/:id/narration/scene` + `/prerender`.

### Soundscapes (F1631–F1640)

Scene-tag bindings (`# scene: storm`) and `play("door")` effect triggers
extracted from Forge source; a bundled **CC0 sound library** + attribution
manifest; a mixer model (narration/ambient/effects/master) with a ducking
function and per-vault mix settings (migration 032). Routes `/soundscape/*` and
`POST /stories/:id/soundscape`.

### Read-Along (F1641–F1650)

A word/sentence alignment model (`audio/readalong/align.ts`): engine word
boundaries when available (F1642), else a length-weighted proportional fallback
(F1647) that spreads the known duration across words. Text-generic, so it serves
plain notes as well as stories (F1646). `wordAtTime`/`timeOfWord` for tap-to-seek.
Route `POST /readalong/align`. Highlight/scroll/karaoke styling are web.

### Recording Studio (F1651–F1660)

Content-addressed human-narration takes (sha256 dedup, migration 033) with take
management — list, pick-best, promote-on-delete (F1653). A pure recording-plan
model (`audio/studio/plan.ts`) resolves each line to human/TTS/uncast and emits a
session checklist of what's left to record (F1656/F1657). Routes under
`/stories/:id/takes` + `/recording-plan`. Mic capture, waveform editor, and
noise processing are the web layer.

### Audio Export (F1661–F1670)

Audiobook manifest (`audio/export/audiobook.ts`): chapters from knot titles
(F1662), embedded metadata + cover (F1663), per-format size estimate (F1668), and
a `.cue` chapter sheet (F1661). `POST /stories/:id/audiobook` and a notebook
"listen to everything" export (`POST /notebooks/:id/audiobook`, one chapter per
note, F1666). Container muxing (m4b/mp3/opus encode) is a codec/web concern.

## Decisions & deferrals

- **Web Audio is the web layer.** The ambient playback engine, crossfade, layer
  editor, sound import, and buffer lifecycle (F1631/F1635/F1636/F1639) are
  deferred-with-reason; the server ships the data model, library, bindings,
  triggers, and mix math they bind to — all tested.
- **No audio deps.** WAV parse/concat is hand-written, matching the repo's
  dependency-light ethos (cf. the hand-written ZIP/tar/ENEX readers).
- **The mock TTS adapter now emits valid PCM WAV** so the pre-render path
  (parse + concat) is exercised end-to-end in tests.

## Recurring gotchas handled

- `exactOptionalPropertyTypes` vs zod-inferred `field?: T | undefined`: widened
  the affected interface optionals (`VoiceAssignment`, settings `update`,
  `normalizeMix`) rather than stripping undefined at every call site.
- `StoryRecord` has no `source` field (that's `StoryFile`) — the narration route
  assembles source from the story's scene files.

## Resume tomorrow

Next is **F1671 (Playback System)** — Media Session API, background playback,
position persistence; mostly web, with server-side listening-position +
listening-stats persistence as the shippable core. Then Audio Accessibility
(F1681), and the Epic 17 close (F1691–F1700). Remaining Epic 17 work is
increasingly web/Web-Audio-heavy, so expect more deferred-with-reason items and
smaller server surfaces per group. The vault keystone (field codec through the
notes service) remains queued for its own focused session.
