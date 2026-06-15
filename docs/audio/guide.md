# Audio Fables: User Guide

Audio Fables turns your written stories and notes into a complete audio experience—narrated by expressive voices, layered with soundscapes, mixed with your own recordings, and accessible on any device. Every feature degrades gracefully when offline or when speech synthesis isn't available: the app works perfectly well without a microphone, without a voice engine, or without sound effects.

## Overview

Audio Fables lets you:

- **Hear your stories narrated** — by any combination of cast voices, the narrator's voice, or your own human recording.
- **Cast characters to voices** — analyze dialogue, assign a voice per character, and save cast sheets that work across stories.
- **Layer soundscapes** — attach CC0-licensed ambient sounds to scenes and trigger sound effects via inline syntax.
- **Record your own narration** — capture and mix human takes with synthesized speech, pick the best take per line, and build a mixed production.
- **Export audiobooks** — render chapters with metadata, cue sheets, and multiple audio formats (WAV, MP3, m4b, Opus).
- **Read along** — auto-highlight and scroll synchronized to playback; transcripts and captions for accessibility.
- **Listen anywhere** — resume where you left off across devices, queue stories, pin them for offline playback, and track listening stats.

**Core principle:** Audio is always optional. If no Piper voice engine is installed, the web player falls back to your browser's Web Speech API (lower quality but always available). Sound effects are optional per story. Human recordings are optional—every line can also be synthesized. The app is fully usable as text.

## Setting Up a Voice Engine

### Installing Piper

Fables uses [Piper](https://github.com/rhasspy/piper) for high-quality, offline TTS. To set it up:

1. **Download Piper** for your operating system (macOS, Linux, Windows).
2. **Download voice models** from [Piper's voice list](https://huggingface.co/rhasspy/piper-voices). Each model is a pair of files: `{language}-{speaker}-{quality}.onnx` and `{language}-{speaker}-{quality}.onnx.json`. Download the quality tier you prefer (see the quality matrix below).
3. **Set environment variables:**
   ```
   FABLES_PIPER_BIN=/path/to/piper
   FABLES_PIPER_VOICES=/path/to/voices/directory
   ```
4. **Verify** by visiting the web app's audio settings panel or calling `GET /tts/status`. You'll see your installed voices listed with their language, gender, and quality tier.

### Voice Quality Tiers

Piper models come in three quality levels:

| Quality | Latency     | Naturalness            | Best For                             |
| ------- | ----------- | ---------------------- | ------------------------------------ |
| Low     | 100–300 ms  | Basic, clipped         | Fast scrubbing, quick feedback       |
| Medium  | 300–800 ms  | Good prosody, balanced | Interactive reading, normal playback |
| High    | 800–1500 ms | Natural, smooth        | Final audiobook export, archival     |

Choose **low** for interactive features; **medium** for day-to-day listening; **high** for published or curated audio.

### Web Speech Fallback

If no Piper engine is available, the web player automatically falls back to your browser's built-in Web Speech API. It's lower quality and doesn't support markup or lexicon, but it always works—no installation needed.

## Casting Your Characters

Voice casting separates narration from dialogue, then assigns voices to characters so each speaker has a consistent voice throughout your story.

### Analyze Dialogue

Call `POST /casting/analyze` with your story text:

```
POST /casting/analyze
{
  "text": "The dragon growled. 'You dare enter my lair?' asked the dragon.",
  "knownSpeakers": ["dragon"]
}
```

Response: a list of lines, each marked as narration or dialogue with an attributed speaker. The analyzer uses simple heuristics (quoted text, speaker tags) to split the script.

### Assign Voices to Characters

For each character you identified, assign a voice:

```
PUT /entities/{entityId}/voice
{
  "voiceId": "en_US-male-voice",
  "rate": 1.0,
  "pitch": 1.0
}
```

Per-character rates and pitches let you further customize each voice (e.g., slow, deep voices for villains; fast, high voices for children).

### Save and Reuse Cast Sheets

A **cast sheet** binds:

- A **narrator** voice (for unattributed narration)
- **Per-speaker voices** (a map of character name → voice)
- A **default character voice** (fallback for unrecognized speakers)

Save a cast sheet to your story:

```
PUT /stories/{storyId}/cast
{
  "name": "Main Cast",
  "sheet": {
    "narrator": { "voiceId": "en_US-amy-medium" },
    "bySpeaker": {
      "dragon": { "voiceId": "en_US-male-deep-low", "pitch": 0.8 },
      "hero": { "voiceId": "en_US-joe-medium" }
    },
    "defaultCharacter": { "voiceId": "en_US-amy-medium" }
  }
}
```

**Templates:** Save a cast sheet as a reusable template (`POST /casting/templates`) to apply the same cast to multiple stories.

## Narrating a Story

Build a voiced audio scene from a path through your story's knots (chapters/sections).

### Build a Scene

```
POST /stories/{storyId}/narration/scene
{
  "path": ["start", "encounter", "battle"],
  "wpm": 155
}
```

Response: the **scene**—a list of speech items (narration lines, dialogue, choice points) with assigned voices—and a **timeline** showing when each item plays relative to others.

Words-per-minute (`wpm`) estimates the duration of each line so the timeline can be built without rendering audio.

### Prerender (Bake to WAV)

When you're happy with the cast and ready to export or share offline:

```
POST /stories/{storyId}/narration/prerender
{
  "path": ["start", "encounter", "battle"]
}
```

The server renders the entire path to a single WAV file, caching each synthesized line so re-renders are fast. Response includes:

- **format**, **sampleRate**, **durationMs** — audio metadata.
- **realtimeRatio** — playback time relative to render time (e.g., 0.8 = playback is 80% as long as synthesis took).
- **offsets** — where each scene item starts in the audio (for chapter markers or read-along sync).
- **audio** — base64-encoded WAV bytes.

### Live Narration (Web Speech)

If you don't prerender, the web player synthesizes each line on demand using Web Speech or Piper, streaming narration as you play. This is instant for interactive reading but lower quality than pre-render.

## Soundscapes

Soundscapes layer ambient sounds and sound effects under your narration. Fables ships with a CC0-licensed sound library (thunder, rain, footsteps, ambient music, etc.). Use them in your Forge source via **scene tags** and **play triggers**.

### Scene Tags

Mark a scene (knot) with a soundscape ID:

```forge
=== forest_path ===
# scene: forest-ambience
The path winds through ancient trees.
```

The scene-tagged sound plays throughout the knot (looping if needed). Use `# scene: none` to clear the soundscape mid-knot.

### Sound Triggers

Trigger a one-shot sound with `play()`:

```forge
The dragon roars! {play(dragon-roar)}
```

### Mix Levels & Ducking

Adjust the mix levels in the audio settings:

```
PUT /soundscape/mix
{
  "mix": {
    "narration": 1.0,
    "ambient": 0.5,
    "effects": 0.7,
    "master": 0.9
  },
  "duckAmount": 0.3
}
```

- **Ducking** — when speech plays, the ambient layer is reduced by `duckAmount` so dialogue stays clear.
- **Scene overrides** — map a soundscape ID to a different sound per story (`sceneOverrides: { "forest-ambience": "my-custom-forest" }`).

Use `GET /soundscape/library` to see the full bundled library and `GET /soundscape/attribution` for CC0 credits.

## Recording Your Own Narration

Fables' studio lets you record human voice takes, select the best one per line, and mix them with synthesized speech.

### Upload a Take

Record on your phone or desktop, then upload:

```
POST /stories/{storyId}/takes
{
  "lineKey": "opening-narration",
  "format": "opus",
  "durationMs": 5200,
  "audio": "...base64 audio bytes..."
}
```

Supported formats: `opus`, `wav`, `webm`, `mp4`. The server stores takes content-addressed, so re-uploading the same recording is automatic deduplication.

### Pick the Best Take

For each line, see all takes and set the active one:

```
GET /stories/{storyId}/takes/{lineKey}
→ { "takes": [ { id, format, durationMs, timestamp }, ... ] }

PUT /stories/{storyId}/takes/{lineKey}/active
{ "takeId": "..." }
```

When narrating, if a line has an active human take, it plays instead of TTS. If you re-record, just set the new take active; the old one remains in storage.

### Recording Plan & Checklist

Before you start recording, build a plan:

```
POST /stories/{storyId}/recording-plan
{
  "lines": [
    { "lineKey": "opening", "text": "...", "cast": false },
    { "lineKey": "dialog-1", "text": "...", "cast": true }
  ]
}
```

Response: a **plan** that shows which lines are TTS-only, which are recorded, which still need takes; and a **session checklist** to track your progress.

## Read-Along & Accessibility

Narration syncs word-by-word with spoken audio so readers can follow along, highlight, and seek by tapping a word. Transcripts and captions are available in text or WebVTT format.

### Word-by-Word Alignment

The engine reports word boundaries when synthesizing speech. Fallback alignment uses proportional timing when boundaries aren't available.

```
POST /readalong/align
{
  "text": "Hello world this is a test.",
  "totalMs": 2500,
  "boundaries": [
    { "index": 0, "startMs": 0, "endMs": 300 },
    { "index": 1, "startMs": 300, "endMs": 650 }
  ]
}
```

Response: **words** and **sentences** arrays, each with start/end times for highlighting and auto-scroll.

### Transcripts & Captions

Generate a transcript or WebVTT captions:

```
POST /stories/{storyId}/transcript
{
  "path": ["start", "encounter"],
  "format": "vtt"
}
```

Response:

- **text**: Full plaintext transcript with speaker labels.
- **vtt**: WebVTT captions (`.vtt` file) with timings for subtitling.
- **choiceMenus**: For each choice point, a numbered spoken menu ("Press 1 for yes, 2 for no") to enable audio-first navigation.

### Accessibility Settings

Enable **mono** (single-channel) audio, adjust **balance** (left/right), and enable **normalizeVoices** (reduce volume variance between narrators):

```
PUT /soundscape/mix
{
  "mono": true,
  "balance": 0,
  "normalizeVoices": true
}
```

## Exporting Audiobooks

Export a story path as a complete audiobook with chapters, metadata, and a cue sheet for chapter-aware players.

### Audiobook Manifest

```
POST /stories/{storyId}/audiobook
{
  "path": ["start", "middle", "end"],
  "format": "m4b",
  "metadata": {
    "title": "My Adventure",
    "author": "Me",
    "narrator": "Amy",
    "cover": "...base64 image..."
  }
}
```

Response: **manifest** with:

- Chapter list (title, knot, start offset in audio)
- Metadata (title, author, narrator, cover image)
- Size estimate (for pre-download warnings)
- Format (WAV, MP3, Opus, m4b)

### Cue Sheet

The **cue** response is a `.cue` file you can feed to audiobook exporters to encode chapters:

```
FILE "audiobook.wav" WAVE
  TRACK 01 AUDIO
    TITLE "Start"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Middle"
    INDEX 01 02:30:50
```

### Notebook Audiobooks

Convert a whole notebook to audio (one chapter per note):

```
POST /notebooks/{notebookId}/audiobook
{
  "format": "m4b",
  "metadata": { "author": "Notes" }
}
```

## Listening & Playback

Resume where you left off, queue stories, pin them offline, and track your listening habits.

### Resume Position

Save playback position and track listening time:

```
PUT /playback/{type}/{id}
{
  "positionMs": 45000,
  "durationMs": 600000,
  "listenedDeltaMs": 5000
}
```

Retrieve position on app start:

```
GET /playback/story/my-story-id
→ { "itemType": "story", "itemId": "...", "positionMs": 45000, "completed": false }
```

### Queue

Build a listening queue (stories, notes, audiobooks):

```
POST /playback/queue
{ "itemType": "story", "itemId": "my-story", "title": "My Adventure" }

GET /playback/queue
→ { "queue": [ { "entryId": "...", "itemType": "story", "itemId": "...", "title": "..." }, ... ] }

PUT /playback/queue/order
{ "ids": [ "entry-2", "entry-1", "entry-3" ] }
```

### Offline Pins

Pin items for offline listening (pre-downloads the entire audio):

```
PUT /playback/pins/{type}/{id}
{ "pinned": true, "title": "My Adventure" }
```

Pinned items sync across devices and stay available even when offline.

### Listening Stats

Track total listening time and completion:

```
GET /playback/stats
→ {
  "totalListenedMs": 123456,
  "itemsCompleted": 5,
  "byItem": [ { "itemType": "story", "itemId": "...", "listenedMs": 12000 } ]
}
```

## End-to-End Example

Here's a complete walkthrough: cast a story, add soundscapes, and export an audiobook.

1. **Upload story** to the app (or use an existing one).

2. **Analyze and cast:**

   ```
   POST /casting/analyze { "text": "..." }
   ```

   Identify speakers, then assign voices:

   ```
   PUT /entities/dragon/voice { "voiceId": "en_US-male-deep" }
   PUT /entities/hero/voice { "voiceId": "en_US-joe-medium" }
   ```

3. **Save a cast sheet:**

   ```
   PUT /stories/my-story/cast {
     "name": "Default",
     "sheet": { "narrator": {...}, "bySpeaker": {...} }
   }
   ```

4. **Add soundscapes** (edit your Forge source to include `# scene:` tags and `play()` triggers).

5. **Build the narration scene:**

   ```
   POST /stories/my-story/narration/scene
   { "path": ["start", "encounter", "battle"] }
   ```

6. **Prerender to WAV** (optional, for offline or archival):

   ```
   POST /stories/my-story/narration/prerender
   { "path": ["start", "encounter", "battle"] }
   ```

7. **Export as audiobook:**

   ```
   POST /stories/my-story/audiobook {
     "path": ["start", "encounter", "battle"],
     "format": "m4b",
     "metadata": { "title": "My Adventure", "author": "Me" }
   }
   ```

   Use the returned cue sheet and manifest to encode to m4b format.

8. **Listen and resume:** The app tracks where you stopped and syncs across your devices.

---

_Audio Fables is part of Epic 17. For API details, see `/tts/status`, `/casting/resolve`, `/stories/:id/narration/scene`, `/soundscape/library`, `/playback/stats`, and other audio endpoints in the server route registry._
