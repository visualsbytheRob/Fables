/**
 * Text-to-speech adapter interface (F1601) — the `speech` capability of the
 * Modality Mesh, mirroring the language-model adapter in src/ai/adapter.ts.
 *
 * Every engine (a local Piper-class binary, the browser's Web Speech API, or the
 * test mock) implements this one contract; callers depend on the capability,
 * never a concrete engine. Nothing here imports a synthesis runtime, so the audio
 * surface stays optional and the app degrades gracefully when no engine is
 * present — speech is always optional in Fables.
 */

/** Audio container produced by an engine. */
export type AudioFormat = 'wav' | 'mp3' | 'ogg';

export interface Voice {
  /** Stable engine-native voice id, e.g. "en_US-amy-medium". */
  id: string;
  /** Human-facing name. */
  name: string;
  /** BCP-47 language tag, e.g. "en-US". */
  lang: string;
  gender?: 'male' | 'female' | 'neutral';
  quality?: 'low' | 'medium' | 'high';
}

export interface SynthesisRequest {
  /** Plain text to speak (markup is expanded before it reaches an engine). */
  text: string;
  /** Engine voice id; when omitted the engine picks a sensible default. */
  voiceId?: string;
  /** Speaking rate multiplier, 1 = normal. Clamped by the engine. */
  rate?: number;
  /** Pitch multiplier, 1 = normal. Clamped by the engine. */
  pitch?: number;
  signal?: AbortSignal;
}

export interface SynthesisResult {
  /** Rendered audio bytes. */
  audio: Uint8Array;
  format: AudioFormat;
  sampleRate: number;
  /** The voice that was actually used. */
  voiceId: string;
  /** Playback duration in ms, when the engine reports it. */
  durationMs?: number;
}

export interface TtsAdapter {
  /** Stable engine id: 'piper' | 'web-speech' | 'mock' | … */
  readonly name: string;
  /** Fast health check — true when this engine can synthesize right now. */
  isAvailable(): Promise<boolean>;
  /** Voices the engine currently offers (empty when unavailable). */
  listVoices(): Promise<Voice[]>;
  /** One-shot synthesis. */
  synthesize(req: SynthesisRequest): Promise<SynthesisResult>;
}
