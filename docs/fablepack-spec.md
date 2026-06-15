# .fablepack format specification (v1)

A `.fablepack` is a **deterministic ZIP archive** bundling everything needed to
play a Fable elsewhere. The same input always produces byte-identical output, so
a pack's hash is a stable identity (reproducible builds).

## Layout

```
manifest.json        # required — metadata + hash tree + optional signature
story/<path>.fable   # one or more story source files
bytecode.bin         # optional — compiled bytecode
casting.json         # optional — voice casting sheet
assets/<name>        # optional — images, audio, etc.
```

Entries (other than `manifest.json`) are written in sorted order; the ZIP writer
uses zero timestamps. Determinism is part of the contract (F1802).

## manifest.json

```jsonc
{
  "format": "fablepack",
  "version": 1,
  "story": { "id": "...", "title": "...", "description": "..." },
  "release": "v1", // release label (F1841)
  "capabilities": ["audio", "ai", "..."], // required to play fully (F1804)
  "compat": { "min": 1, "max": null }, // app schema-version range (F1807)
  "contentWarnings": ["..."], // F1806
  "entries": { "story/main.fable": "<sha256>", "...": "..." }, // hash tree (F1808)
  "signature": "<hmac-sha256 hex>", // optional (F1808)
  "createdAt": "1970-01-01T00:00:00.000Z", // fixed for reproducibility
}
```

**Capabilities** (`audio`, `ai`, `knowledge`, `images`, `soundscape`) tell a
reader what a pack needs; a reader missing a capability can still play, degrading
gracefully (e.g. no narration).

**Compatibility** (`compat.min`/`max`) is the app schema-version range the pack
targets; readers refuse packs outside their range.

## Integrity (F1808)

`entries` is a hash tree: every content entry maps to the sha256 of its bytes.
Validation recomputes each hash, requires every declared entry to be present, and
rejects any **undeclared** entry (no smuggled content). When a `signingKey` is
provided, `signature` is an HMAC-SHA256 over the canonical manifest (sorted keys,
signature field removed) and must verify.

## Security

A pack carries **data, never executable code** — story source compiles to the
sandboxed Fable Forge VM (effects allowlist, no eval). Unpacking validates the
hash tree before trusting any entry. Packs are not scripts (F1893).

## Reference implementation

`apps/server/src/export/fablepack/pack.ts` — `packFable`, `unpackFable`,
`validatePack`. Conformance tests in `pack.test.ts` pin determinism, round-trip
fidelity, tamper detection, and signing. HTTP surface: `POST /stories/:id/pack`,
`POST /packs/validate`, `POST /packs/unpack`.
