/**
 * Image generation adapter interface (Epic 19, F1861) — the `image` capability
 * of the Modality Mesh. Every backend (ComfyUI local, Comfy Cloud, the test
 * mock) implements this one contract; callers depend on the capability, never a
 * concrete engine, and the app degrades gracefully when none is present (F1863
 * typographic fallback).
 */

export type ImageFormat = 'png' | 'webp' | 'jpeg' | 'svg';

export interface ImageRequest {
  prompt: string;
  negative?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** Optional explicit ComfyUI workflow JSON; otherwise the adapter builds one. */
  workflow?: unknown;
  signal?: AbortSignal | undefined;
}

export interface ImageResult {
  image: Uint8Array;
  format: ImageFormat;
  width: number;
  height: number;
  /** Provenance for the generated-asset pipeline (F1868). */
  provenance: { adapter: string; prompt: string; createdAt: string };
}

export interface ImageAdapter {
  /** Stable backend id: 'comfy-local' | 'comfy-cloud' | 'mock'. */
  readonly name: string;
  /** Fast health check — true when this backend can generate right now. */
  isAvailable(): Promise<boolean>;
  /** One-shot image generation. */
  generate(req: ImageRequest): Promise<ImageResult>;
}
