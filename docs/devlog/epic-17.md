# Epic 17 — Audio Fables

The server backend for a complete listening experience: hear your stories and
notes narrated, cast characters to distinct voices, layer ambient soundscapes,
record your own narration, export audiobooks, follow along word-by-word, and
listen anywhere with resume + a queue. Built across ten green batches, much of it
by parallel Opus + Sonnet + Haiku agent teams.

Audio is **always optional** and degrades gracefully — every feature has a
`{ available: false }` / empty-result path so the app is fully usable with no
speech engine installed. Nothing in the core hard-depends on audio.

## What shipped (server-side)

### TTS Foundation (F1601–F1610)

A pluggable speech runtime (`TtsRuntime` + `TtsAdapter`) mirroring the Epic-14 AI
runtime, with a `PiperAdapter` that shells out to a local neural-TTS binary and
is gracefully unavailable when absent. A content-addressed synthesis cache
(sha256 of text+voice+rate+pitch) with an LRU budget, **hit-rate stats**, and a
single-flight **priority queue** so "speak this now" jumps ahead of a document
render. Per-vault voice settings, an SSML-ish markup subset, and a pronunciation
lexicon. Migration 030. `docs/audio/tts.md`.

### Voice Casting (F1611–F1620)

Pure dialogue-attribution (said-before/after, curly quotes, "the goblin",
known-speaker disambiguation), narrator/character separation, and cast resolution
with fallback rules. Per-entity voices + saved cast sheets + reusable templates
(migration 031).

### Narration Renderer (F1621–F1630)

`buildScene` turns a Forge path into a voiced audio scene (line / choice / earcon
items); `buildTimeline` is the audio-position ↔ text-position model. **Pre-render**
bakes a path to one WAV through a hand-written `wav.ts` (chunk-scanning parser,
silence, concat — no audio dependency added). `realtimeRatio()` reports
faster-than-realtime synthesis.

### Soundscapes (F1631–F1640)

`# scene:` bindings and `play("…")` triggers extracted from Forge source; a
bundled **CC0 sound library** + attribution manifest; a mixer model
(narration/ambient/effects/master) with ducking. Per-vault mix + accessibility
settings (migration 032).

### Read-Along (F1641–F1650)

A word/sentence alignment model: engine word boundaries when available, else a
length-weighted proportional fallback. Text-generic, so it serves plain notes as
well as stories.

### Recording Studio (F1651–F1660)

Content-addressed human-narration takes (sha256 dedup, migration 033) with take
management — list, pick-best, promote-on-delete. A recording-plan model resolves
each line to human/TTS/uncast and emits a session checklist.

### Audio Export (F1661–F1670)

Audiobook manifest: chapters from knot titles, embedded metadata + cover,
per-format size estimate, and a `.cue` sheet. Story-path and notebook
("listen to everything") exports.

### Playback System (F1671–F1680)

Cross-device resume positions, a listening queue, offline pins, and listening
stats (migration 034).

### Audio Accessibility (F1681–F1690)

Transcripts + WebVTT captions + numbered spoken choice menus; mono / balance /
voice-normalization audio settings.

### Epic Close (F1691–F1700)

An end-to-end pipeline test — one demo fable cast, soundscaped, narrated,
pre-rendered, packaged as an audiobook, and transcribed (F1691/F1697). Cache
hit-rate tuning + disk-budget controls (F1692/F1693). The audio user guide
(`docs/audio/guide.md`, F1696) and this retro (F1700).

## Deferred-with-reason (the Web Audio / web layer)

The browser is where audio actually plays, so the rendering/capture/encode layers
are a dedicated web pass; the server data models, algorithms, and routes they
bind to are all shipped and tested. Deferred: the Web Speech fallback (F1604),
voice audition UI (F1614), live narration + transport controls + sleep timer
(F1623/F1625/F1627/F1628), the Web-Audio ambient engine + crossfade + editor +
import + sample lifecycle (F1631/F1633/F1635/F1636/F1639), read-along
highlight/scroll/karaoke + reading-practice capture (F1641/F1643/F1644/F1645/
F1648), waveform editor + noise processing + mobile mic (F1654/F1655/F1658),
codec muxing for m4b/mp3/opus + the export queue UI (F1664/F1667), Media Session +
background playback + Bluetooth + interruption recovery + CarPlay
(F1671/F1672/F1676/F1677/F1679), and the audio-first a11y review + presets +
visualizations + image descriptions (F1681/F1683/F1685/F1688/F1689). The settings
consolidation page (F1694), demo seed fable (F1695), battery profiling (F1698),
and audio plugin API surface (F1699) are queued too.

## Migrations

030 (tts cache + settings), 031 (casting), 032 (audio/mix settings), 033
(recording takes), 034 (playback state). All numbered, append-only, and listed in
`db.test.ts`.

## Tests

~3,160+ green across 285 files at the Epic-17 checkpoint. Every algorithm —
synthesis cache/queue, markup, lexicon, attribution, separation, resolution,
scene, timeline, wav, prerender, soundscape bindings/triggers, mixer, alignment,
recording plan, audiobook chapters, playback, transcripts — is driven by
in-process fixtures, plus the end-to-end demo-fable pipeline test.

## A note on CI

Mid-epic we discovered every push had been failing CI (back into Epic 16) on a
single benchmark that exceeded vitest's default 5s harness timeout on slower CI
hardware while passing locally. Fixed by giving the import + compile benchmarks
explicit timeouts above their internal budgets. Lesson: run the _full_ CI command
set locally (`build`, `test:coverage`, bundle-size), not just `test`.
