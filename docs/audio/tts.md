# Text-to-Speech (TTS) Foundation

The TTS system turns text into spoken audio—fast, offline, and always gracefully optional. Every synthesis request flows through markup expansion, pronunciation correction, content-addressed caching, a priority queue (to prevent long renders from blocking urgent playback), and finally a local speech engine.

## Principle: Speech is Optional

Like the AI runtime, the TTS foundation mirrors a graceful degradation model: when no engine is available, the server reports `available: false` and the web layer falls back to the browser's Web Speech API or disables playback entirely. Nothing in the app hard-depends on speech.

## Request Flow

1. **Markup expansion** — Text optionally contains `[pause]`, `[pause N]`, `*emphasis*`, `{rate:slow} … {/rate}` syntax; parsed into a flat list of `SpeechSegment` objects.
2. **Lexicon application** — Pronunciation rules (word: respelling) are applied to the plaintext; case-insensitive, longest-match-first.
3. **Cache check** — The hash of text + voice + rate + pitch is looked up in the synthesis cache (content-addressed, LRU); instant hit if already rendered.
4. **Priority queue** — Enqueued at a priority (higher = sooner); serializes engine calls so foreground "speak now" never waits for background batch renders.
5. **Engine synthesis** — Rendered by the active adapter (Piper, Web Speech, mock); audio returned as base64 in the JSON response.
6. **Cache store** — Result is atomically written to the cache with a timestamp for LRU eviction.

## Engines & Setup

### Piper (Local, Offline)

Piper is a neural TTS engine that runs locally on the user's machine. Install it by dropping pre-built voice models into a directory and pointing environment variables:

```
FABLES_PIPER_BIN      # Path to the piper executable
FABLES_PIPER_VOICES   # Directory of *.onnx + *.onnx.json voice models
```

Voice ids are the model file stems (e.g. `en_US-amy-medium`). Piper produces 22.05 kHz mono WAV; gracefully unavailable if the binary or voices directory is absent.

### Web Speech API (Browser Fallback)

When the server reports `available: false`, the web layer uses the browser's built-in Web Speech API for playback—lower quality but always available.

## Quality Matrix: Voice Tiers

Piper voice models come in three qualities. Use this as guidance (not measured benchmarks; no binary in CI):

| Quality                             | Latency      | Naturalness                    | Model Size | Best For                                      |
| ----------------------------------- | ------------ | ------------------------------ | ---------- | --------------------------------------------- |
| **Low** (`-low`)                    | ~100–300 ms  | Basic, clipped                 | ~30 MB     | Fast scrubbing, preview reads, quick feedback |
| **Medium** (no suffix or `-medium`) | ~300–800 ms  | Good prosody, slight artifacts | ~70 MB     | Interactive reading, normal playback          |
| **High** (- `-high`)                | ~800–1500 ms | Natural inflection, smooth     | ~150 MB    | Final narration export, archival quality      |

Choose low for interactive features with latency constraints; medium for standard reads; high for published or curated audio.

## Caching & Performance

### Content-Addressed Cache

Each synthesis request produces a stable SHA256 hash from its text, voice, rate, and pitch. The cache uses this hash as a key:

- **Instant re-reads** — Reading the same passage twice via the same voice yields a cache hit on the second request (sub-10ms DB lookup).
- **Storage efficient** — Only the audio bytes and metadata are stored; the hash is deterministic.
- **LRU eviction** — When the cache exceeds `cacheBudgetMb` (default 200 MB, configurable per vault), least-recently-used entries are discarded until it fits.

### Priority Queue

The synthesis queue serializes all engine calls. A task enqueued at priority 100 runs before one at priority 0, even if the latter was queued first. Within the same priority, insertion order (FIFO) breaks ties.

- **Interactive playback** — Enqueue with high priority (e.g. 50+) to preempt batch renders.
- **Background batch** — Enqueue with priority 0 (default) for document-wide narration.
- **Zero blocking** — The queue doesn't block the event loop; each task awaits the engine, then the next begins.

## API Reference

### GET `/tts/status`

Returns engine availability and voice catalog.

**Response:**

```json
{
  "data": {
    "available": true,
    "voices": [
      {
        "id": "en_US-amy-medium",
        "name": "en_US-amy-medium",
        "lang": "en-US",
        "gender": "female",
        "quality": "medium"
      }
    ],
    "cacheBytes": 12345678
  }
}
```

### GET `/tts/settings` · PUT `/tts/settings`

Fetch or update per-vault voice settings.

**PUT body:**

```json
{
  "defaultVoiceId": "en_US-amy-medium",
  "rate": 1.0,
  "pitch": 1.0,
  "disabled": false,
  "cacheBudgetMb": 200,
  "lexicon": "Mira: MEE-rah\nVale: VAIL"
}
```

### POST `/tts/synthesize`

Render speech with markup expansion and lexicon, served from cache when possible.

**Request:**

```json
{
  "text": "Hello, *world*. [pause 500] [pause]",
  "voiceId": "en_US-amy-medium",
  "rate": 1.0,
  "pitch": 1.0,
  "priority": 10,
  "noCache": false
}
```

**Response:**

```json
{
  "data": {
    "voiceId": "en_US-amy-medium",
    "format": "wav",
    "sampleRate": 22050,
    "durationMs": 2500,
    "cached": false,
    "bytes": 110250,
    "audio": "UklGRi4mA...",
    "segments": [
      { "text": "Hello,", "emphasis": false },
      { "text": "world", "emphasis": true, "pauseAfterMs": 500 }
    ]
  }
}
```

Fields:

- `audio` — base64-encoded audio bytes.
- `format` — container type: `wav`, `mp3`, or `ogg`.
- `sampleRate` — samples per second (Piper uses 22050).
- `durationMs` — playback duration in milliseconds when the engine reports it.
- `cached` — true if served from the synthesis cache.
- `bytes` — byte length of decoded audio.
- `segments` — parsed speech segments with markup expanded.

## Markup & Lexicon

### Speech Markup Syntax

| Syntax                     | Effect                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `[pause]`                  | 500 ms silence after the preceding segment                                                 |
| `[pause 800]`              | 800 ms silence (unit suffix optional: `800ms`)                                             |
| `*word*`                   | emphasize; asterisks stripped from output                                                  |
| `{rate:slow} text {/rate}` | Apply a rate modifier to `text`; valid rates: `x-slow`, `slow`, `normal`, `fast`, `x-fast` |
| Plain text                 | Whitespace collapsed to single spaces                                                      |

**Example markup:**

```
The *dragon* guards the gold. [pause 800] {rate:slow} Enter at your own peril. {/rate}
```

Parsed segments:

```
[
  { "text": "The dragon guards the gold.", "emphasis": true, "pauseAfterMs": 800 },
  { "text": "Enter at your own peril.", "rate": "slow" }
]
```

### Pronunciation Lexicon

Define custom pronunciations for names and invented words. Format is `word: respelling` per line; blank lines and `#` comments are ignored. Matching is case-insensitive on whole-word boundaries; longest keys take precedence.

**Example lexicon:**

```
# Custom pronunciations
Mira: MEE-rah
Vale: VAIL
Avelorn: uh-VEL-orn
```

Applied to the plaintext before synthesis; respellings are emitted verbatim, preserving casing.

---

_TTS Foundation is part of Epic 17: Audio Fables._
