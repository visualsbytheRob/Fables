# The Modality Mesh

> Fables' plan for generating and involving **every data modality** in one
> coherent story-world. Your notes are the world; the Mesh is how that world
> renders itself as text, image, voice, sound, music, video, 3D, and more —
> with many models (transformer _and_ diffusion _and_ specialized) working
> together, swappable, and degrading gracefully when a backend isn't there.

## Why a mesh and not a pile of integrations

The naïve approach wires each feature to a specific model: "the cover-art button
calls SDXL." That hardcodes a model into a feature and rots the moment a better
model appears or the GPU is offline. The Mesh inverts it: **features request a
_capability_, never a model.** A scene says "I need a portrait of @hero"; the
Mesh decides how — local model, cloud burst, or a cached prior render.

This is the same agentic pattern the rest of Fables already uses: a transformer
**conductor** (the Claude co-writer, Epic 14) plans _what_ should exist and how
it connects; **renderer** models (diffusion and friends) produce the continuous
stuff — pixels, waveforms, geometry. The conductor keeps them coherent so a
character's portrait, voice, and theme music all match the description living in
your notes.

## The division of labor

| Model family                    | Good at                                                | Fables uses it for                                                                      |
| ------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Transformers** (Claude)       | Reasoning, structure, language, planning, tool-calling | The conductor: narrative, branching logic, deciding what to render and with what prompt |
| **Encoder transformers**        | Mapping anything → vectors                             | The bridge layer: semantic search, "related," story↔note links (already live)           |
| **Diffusion / flow models**     | Generating continuous signals                          | Images, audio, music, video, 3D geometry                                                |
| **Autoregressive media models** | Sequential continuous generation                       | Speech (TTS), some audio/music                                                          |
| **Recognition models**          | Signal → symbol                                        | STT (voice capture, already via Whisper), OCR, handwriting/ink, image tagging           |
| **Symbolic / classical**        | Exact, cheap, deterministic                            | Tabular state, geo math, graph ops, time-series analytics                               |

The insight worth internalizing: **transformers decide, diffusion renders,
encoders connect, recognizers ingest.** Everything else is plumbing — and the
plumbing is the Mesh.

## Architecture

```
                        ┌─────────────────────────────────────────┐
   Story / note  ──────▶│            Capability Router             │
   requests a           │  text · image · speech · audio · music   │
   capability           │  video · 3d · embed · ocr · ink · geo    │
                        └───────────────┬─────────────────────────┘
                                        │  picks a provider by
                                        │  capability + availability + policy
                        ┌───────────────▼─────────────────────────┐
                        │              Adapter layer               │
                        │  ClaudeAdapter · ComfyUIAdapter ·        │
                        │  TTSAdapter · MusicAdapter · VideoAdapter │
                        │  · MeshAdapter<Caps> (typed contract)     │
                        └───────────────┬─────────────────────────┘
                                        │  heavy/slow work →
                        ┌───────────────▼─────────────────────────┐
                        │      Job queue + content-addressed cache  │
                        │  (dedupe by hash of {prompt,model,seed})  │
                        └───────────────┬─────────────────────────┘
                                        │  artifacts are first-class
                        ┌───────────────▼─────────────────────────┐
                        │   Vault (Epic 13): media encrypted at     │
                        │   rest + provenance {model,seed,prompt}   │
                        └───────────────────────────────────────────┘
```

### The five load-bearing pieces

1. **Adapter interface** — one typed contract per capability
   (`generateImage`, `synthesizeSpeech`, `scoreScene`, `generateVideo`,
   `generate3D`, `embed`, `recognizeInk`, …). Adapters are interchangeable; a
   feature depends on the capability, never the concrete adapter.
2. **Capability router** — given a request, selects a provider by capability,
   current availability (is the GPU/cloud reachable?), and user policy
   (local-only vs. allow-cloud-burst). This is where graceful degradation lives.
3. **Job queue** — diffusion, video, and 3D are slow, so generation is an async
   background job with progress, cancellation, and priority. The UI requests and
   subscribes; it never blocks.
4. **Content-addressed cache** — every artifact is stored by a hash of
   `{capability, model, prompt, seed, inputs}`. The same request never re-renders;
   results are reproducible and shareable.
5. **Provenance + vault integration** — generated media is first-class vault
   content (encrypted at rest, Epic 13) carrying its full recipe, so any render
   is auditable and re-creatable.

### Graceful degradation (the Fables house style)

Every capability ships in two tiers, exactly as embeddings (ONNX), voice
(Whisper), and art (ComfyUI) already do:

- **Degraded/local**: always works offline — a placeholder, a pure-JS
  approximation, or a small local model. The app is never broken by a missing GPU.
- **Rich/backend**: when a capable backend is present (local GPU via ComfyUI, or
  an opt-in cloud endpoint), the same capability returns the high-fidelity result.

## Modality coverage map

How each modality plugs into the Mesh and where it lives in the roadmap. ✅ = the
plan already covers it; ➕ = added by the Mesh expansion.

| Modality             | Capability             | Story-world use                            | Status                                                |
| -------------------- | ---------------------- | ------------------------------------------ | ----------------------------------------------------- |
| Text                 | `text`                 | Notes, `.fable` scripts, co-writer         | ✅ Epic 14                                            |
| Embeddings           | `embed`                | Search, "related," story↔note links        | ✅ (live)                                             |
| Graph                | `graph`                | Knowledge graph, branch maps               | ✅ (live)                                             |
| Tabular / state      | `state`                | Inventory, stats, save state               | ✅ (Forge VM)                                         |
| Image                | `image`                | Portraits, scene art, item icons, maps     | ✅ Epic 19 (ComfyUI) — reframed onto Mesh             |
| Voice / speech       | `speech` (TTS) + `stt` | Narration, character voices; voice capture | ✅ STT (Whisper) + TTS (Epic 17) — reframed onto Mesh |
| Audio / ambience     | `audio`                | Per-scene soundscapes, SFX                 | ✅ Epic 17 (Audio Fables) — reframed onto Mesh        |
| Music                | `music`                | Adaptive score                             | ➕ extends Epic 17                                    |
| Video / animation    | `video`                | Cutscenes, animated covers                 | ➕ new                                                |
| 3D                   | `model3d`              | Explorable dioramas, 3D characters/world   | ➕ new                                                |
| Geospatial           | `geo`                  | World atlas, travel routes                 | ➕ extends Epic 16                                    |
| Ink / handwriting    | `ink`                  | Apple Pencil capture → notes               | ➕ extends Epic 16                                    |
| OCR / vision tagging | `ocr`                  | Clip/import images → searchable text       | ✅ (clip/ingest)                                      |
| Symbolic / math      | `symbolic`             | World-rule & puzzle systems                | (later)                                               |

## How this reshapes the plan

The Mesh is a **cross-cutting core**, not a single epic bolted on the end. The
existing modality-bearing epics become Mesh consumers, and the missing
modalities are added as new capability adapters:

- **Epic 14 — AI & Modality Mesh core.** Opens with the Mesh itself (adapter
  interface, capability router, job queue, content-addressed cache, provenance),
  then the Claude transformer adapter as the conductor and the first consumer.
- **Epic 16 — Canvas & Spatial Views** gains the `geo` and `ink` capabilities.
- **Epic 17 — Audio Fables** is reframed onto the Mesh and gains `speech` (TTS)
  and `music` alongside `audio`.
- **Epic 19 — Story Interop & Distribution** keeps the ComfyUI `image` adapter,
  now a Mesh provider, and adds `video` + `model3d` so a published fable can ship
  with generated illustration, narration, score, and explorable scenes.

The total stays at ~2,000 features; the back half is **restructured around the
Mesh** rather than extended past it. Each capability follows the same shape —
adapter contract, router entry, degraded + rich tiers, cache, tests — so once the
core lands, every new modality is a well-worn path rather than a fresh
integration.

## Configuring multi-model work effectively (field notes)

The reusable lessons, beyond Fables:

- **Route by capability, not model.** Hardcoding a model into a feature is the
  bug; a capability registry that picks the model is the fix.
- **Make the transformer the conductor.** Let the reasoning model plan and call
  the renderers as tools — the agentic pattern — instead of orchestrating them
  with brittle glue code.
- **Treat heavy generation as jobs.** Queue, progress, cancel, prioritize. Never
  block a UI on a diffusion run.
- **Content-address everything.** Hash the recipe; cache the artifact. Free
  reproducibility, free dedupe, free sharing.
- **Two tiers, always.** A degraded-but-works path plus a rich-when-available
  path keeps the product whole on any hardware.
- **Carry provenance.** Store `{model, seed, prompt, inputs}` with every
  artifact so renders are auditable and re-creatable — and, in Fables, encrypted
  with the rest of the vault.
