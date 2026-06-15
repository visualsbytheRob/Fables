# Fables Distribution & Interop Guide

Fables stories are portable, verifiable, and long-lived. Package a story into a `.fablepack` to play it anywhere; import stories from Ink and Twine; manage versions with releases; and preserve them forever in archives. Everything stays on your device—nothing leaves without your explicit choice.

## Overview

A **fablepack** is a deterministic ZIP archive that bundles everything needed to play a story: source code, compiled bytecode, voice casting, assets, and metadata. The same story always produces byte-identical packs, so a pack's hash is a stable, verifiable identity.

Fables also bridges older formats: convert Ink and Twine source code to Forge (our story language), guaranteed to compile; then pack and distribute them.

For long-term preservation, bundle multiple packs into a **fablearchive** with fixity checksums and a preservation checklist.

## Packaging a Fable

### Creating a pack

Call `POST /stories/:id/pack` with your story ID and optional metadata:

```
{
  "release": "v1.0",                                    // optional version label
  "capabilities": ["audio", "ai"],                      // optional: audio narration, etc.
  "contentWarnings": ["violence"],                      // optional: content advisories
  "signingKey": "my-secret-key"                         // optional: HMAC-SHA256 signing
}
```

The response contains the pack as base64. Save it as a `.fablepack` file.

**Capabilities** declare what features the story uses—`audio`, `ai`, `knowledge`, `images`, `soundscape`. A reader missing a capability can still play, with graceful degradation (e.g., no voice narration without audio support).

**Content warnings** are metadata tags for readers (e.g., "contains violence," "flashing lights").

**Signing** is optional: if you provide a key, the pack gets an HMAC-SHA256 signature over its manifest. Verification proves no tampering occurred.

### What's inside a pack

A `.fablepack` contains:

- **`manifest.json`** – metadata (story ID, title, release label, capabilities, content warnings, hash tree, optional signature)
- **`story/`** – your story source files (`.fable` format)
- **`bytecode.bin`** – optional compiled bytecode for faster loading
- **`casting.json`** – optional voice actor assignments
- **`assets/`** – optional images, audio, and other files (content-addressed by SHA256)

See [fablepack-spec.md](../fablepack-spec.md) for the exact format.

### Validating a pack

To check a pack's integrity before unpacking:

```
POST /packs/validate
{
  "pack": "<base64-encoded-fablepack>",
  "signingKey": "my-secret-key"                        // optional: verify signature
}
```

Validation recomputes every file's SHA256 hash, requires every declared entry to be present, rejects any undeclared entries (no smuggled content), and checks the signature if provided. You get:

```
{
  "valid": true,
  "manifest": { ... },
  "hashes": { "story/main.fable": "<sha256>", ... },
  "signatureMatch": true                               // if signingKey was provided
}
```

### Reading a pack

To extract a pack's contents:

```
POST /packs/unpack
{ "pack": "<base64-encoded-fablepack>" }
```

Returns the manifest, all story source files, and casting sheet. Unpacking validates the hash tree first—a corrupted pack is rejected immediately.

## Releases & Versioning

Create release snapshots as your story evolves. Each release captures a named version of your story's files.

### Naming and creating releases

Create a release via your story editor, assigning a label (e.g., `v1.0`, `beta-2024-01`, `released`). The label becomes part of the pack's metadata.

### Diffing releases

Compare two releases structurally:

```
GET /stories/:id/releases/:a/diff/:b
```

Returns files added, modified, and removed between releases `a` and `b`.

### Changelog

Generate a human-readable changelog:

```
GET /stories/:id/releases/:a/changelog/:b
```

Produces markdown summarizing changes (new passages, removals, edits).

### Save-file compatibility

Check if save files from one release work with another:

```
GET /stories/:id/releases/:a/compat/:b
```

Returns a compatibility report: which variable changes (additions, removals, type shifts) might affect existing saves.

### Rolling back

If you make a mistake, restore a release's files:

```
POST /stories/:id/releases/:rel/rollback
```

Updates any files that still exist in your project; re-creates files the release had but you've lost.

## Importing from Ink & Twine

Bring stories from other platforms into Fables.

### Importing Ink

```
POST /import/ink
{
  "source": "<ink-source-code>",
  "title": "My Ink Story"                              // optional: create a story
}
```

Converts Ink syntax to Forge (our story language). Returns:

```
{
  "forge": "<compiled-forge-source>",
  "unsupported": [ "SHUFFLE", "INCLUDE", ... ],       // constructs that don't map
  "storyId": "abc123"                                  // if title was provided
}
```

The converter reports unsupported Ink features (shuffles, includes, complex expressions) but guarantees the output compiles.

### Importing Twine

```
POST /import/twine
{
  "source": "<twee-source-code>",
  "title": "My Twine Story"                            // optional: create a story
}
```

Converts Twee 3 syntax to Forge. Returns:

```
{
  "forge": "<compiled-forge-source>",
  "start": "Start",                                    // entry passage
  "passages": { "Start": { ... }, ... },              // passage structure
  "unsupported": [ "macro1", "script", ... ],
  "storyId": "abc123"                                  // if title was provided
}
```

The converter handles macro expansion and reports incompatible constructs, but output is guaranteed to compile.

## Generated Art

Cover images and entity portraits integrate seamlessly with your stories.

### Story covers

Generate a cover image:

```
POST /stories/:id/cover
{
  "theme": "cyberpunk noir",                           // optional: style guidance
  "style": "oil-painting"                              // optional: preset style
}
```

If a ComfyUI backend is configured, returns a high-quality generated image. Otherwise, returns a clean typographic fallback—every story gets a cover.

```
{
  "hash": "<sha256-content-hash>",
  "format": "png" or "svg",
  "fallback": false or true
}
```

### Entity portraits

Generate a portrait for a character:

```
POST /entities/:id/portrait
{ "style": "oil-painting" }                            // optional preset style
```

Returns the portrait hash and format, or `{ "available": false, "prompt": "..." }` if no backend is configured.

### Style presets

Browse available styles:

```
GET /art/styles
```

Returns a catalogue of named presets (e.g., "photorealism," "watercolor," "concept-art").

### Fetching assets

Retrieve a generated image by its content hash:

```
GET /art/assets/:hash
```

Returns `{ "format": "png", "base64": "..." }`. Assets are content-addressed, so identical generations produce the same hash.

## Reader Feedback

Collect and analyze how readers experience your story.

### Adding feedback

Readers can leave per-moment notes while playing:

```
POST /stories/:id/feedback
{
  "knot": "passage-name",                              // optional: where they were
  "kind": "note",                                      // "note", "reaction", or "bug"
  "text": "This part confused me",
  "sentiment": "confused"                              // optional: emotional label
}
```

### Feedback inbox

Retrieve all reader notes:

```
GET /stories/:id/feedback
```

Returns timestamped feedback with reader context (knot, kind, sentiment).

### Choice statistics

See which choices readers pick most:

```
GET /stories/:id/feedback/choice-stats
```

Returns counts per choice, aggregated across all play sessions.

### Drop-off analysis

Identify where readers abandon the story:

```
GET /stories/:id/feedback/drop-off
```

Shows per-knot exit counts and drop-off rates.

### Ending distribution

See which endings readers reach:

```
GET /stories/:id/feedback/endings
```

Returns ending names and completion rates.

### Exporting feedback

Bundle all feedback and play events for analysis elsewhere:

```
POST /stories/:id/feedback/export
{ "anonymize": true }                                  // optional: strip reader identities
```

### Importing feedback

Merge feedback from another source (e.g., a reader community):

```
POST /stories/:id/feedback/import
{
  "feedback": [
    { "knot": "x", "text": "...", "kind": "note" },
    ...
  ]
}
```

All feedback stays local; nothing is sent to a server without your explicit request.

## Archiving for the Long Haul

Preserve stories forever with content-addressed archives and fixity verification.

### Building an archive

Bundle multiple story packs into a single archive:

```
POST /archive/build
{ "storyIds": ["story1", "story2", "story3"] }
```

Returns a `.fablearchive` file (base64):

```
{
  "archive": "<base64>",
  "bytes": 1048576,
  "packs": 3
}
```

A `.fablearchive` is a ZIP containing:

- **`packs/`** – all story `.fablepack` files
- **`manifest.json`** – archive metadata and SHA256 hash tree
- **`index.json`** – human-readable index of stories

### Verifying fixity

Before relying on an archived story, verify it hasn't been corrupted:

```
POST /archive/verify
{ "archive": "<base64-fablearchive>" }
```

Returns:

```
{
  "valid": true,
  "packs": 3,
  "corrupted": [],                                     // any packs with hash mismatches
  "manifest": { ... }
}
```

If any hashes don't match, those packs have been corrupted and should not be trusted.

### Preservation checklist

Before archiving, evaluate your pack's readiness for long-term storage:

```
POST /archive/checklist
{ "pack": "<base64-fablepack>" }
```

Returns:

```
{
  "checklist": {
    "hasCover": true,
    "hasDescription": true,
    "hasContentWarnings": false,                       // consider adding these
    "hasCasting": false,
    "hasAssets": true,
    "isCompiled": true,
    "signature": false,                                // consider signing
    "recommendations": [
      "Add content warnings if this story has mature themes",
      "Consider adding a signature for tamper-proofing"
    ]
  }
}
```

Use this to ensure your pack is complete and well-documented before archiving.

## Quick Walkthrough

Here's a typical workflow:

1. **Write** your story in Fables, or import it from Ink/Twine.
2. **Test** with readers; collect feedback via the feedback API.
3. **Create a release** when you're happy (e.g., `v1.0`).
4. **Pack it** (`POST /stories/:id/pack`, optional: set release, capabilities, warnings, signing key).
5. **Validate** the pack (`POST /packs/validate`).
6. **Share** the `.fablepack` file—it's a complete, playable story, safe to distribute.
7. **Archive** when you reach a milestone (`POST /archive/build` with multiple packs, then `POST /archive/verify` to confirm).
8. **Preserve** the `.fablearchive` on a reliable storage medium—it's tamper-evident and reproducible.

## Key Properties

- **Data, not code** – packs contain story source, which compiles safely in the sandboxed Forge VM. No arbitrary code execution.
- **Deterministic** – same story always produces byte-identical packs. Hash stability enables reproducible builds and long-term verification.
- **Local** – all operations (pack, unpack, validate, import, feedback) run on your device. Nothing leaves unless you explicitly export or share.
- **Verifiable** – hash trees and optional signatures prove integrity. Archival fixity checks detect corruption.
- **Portable** – a `.fablepack` plays anywhere Fables runs. No server, no subscription, no lock-in.
