# Day 11 — Epic 17 (Audio Fables): the first 40

Opened Epic 17 and shipped its server-side audio backend through soundscapes —
four feature groups, F1601–F1640, each green-gated and pushed to `main`. Built
with the usual formation: an Opus orchestrator owning the collision points
(migrations, routes, registries, the green-gate) and Sonnet lanes on disjoint
pure-logic modules.

Test count moved 2,909 → **3,106 green** (274 files). Migrations 030–032 added.

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

Next is **F1641 (Read-Along)** — the alignment model (synthesis timestamp
extraction + fallback) is server/pure; highlight/scroll/karaoke are web. Then
Recording Studio (F1651), Audio Export (F1661, fits the Epic-15 export
framework), Playback (F1671), Accessibility (F1681), and the Epic 17 close
(F1691–F1700). The vault keystone (field codec through the notes service)
remains queued for its own focused session.
