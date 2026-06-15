/**
 * ComfyUI adapter (Epic 19, F1861/F1862) — submits a workflow to a local (or
 * cloud) ComfyUI server over its HTTP API and retrieves the generated image.
 * Gracefully unavailable when no server is configured (FABLES_COMFY_URL), so the
 * app degrades to the typographic cover.
 *
 * `fetch` is injectable for testing. Comfy Cloud is the same adapter pointed at a
 * different base URL behind an egress-consent flag (like the Claude cloud
 * adapter, F1364 / F1862).
 */

import type { ImageAdapter, ImageRequest, ImageResult } from './adapter.js';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ComfyOptions {
  name?: string;
  baseUrl?: string | undefined;
  fetchImpl?: FetchLike;
  /** Egress consent for the cloud endpoint (F1862). Local needs no consent. */
  cloudConsent?: boolean;
}

export class ComfyAdapter implements ImageAdapter {
  readonly name: string;
  private readonly baseUrl: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly cloud: boolean;
  private readonly cloudConsent: boolean;

  constructor(opts: ComfyOptions = {}) {
    this.name = opts.name ?? 'comfy-local';
    this.baseUrl = opts.baseUrl ?? process.env['FABLES_COMFY_URL'];
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.cloud = this.name.includes('cloud');
    this.cloudConsent = opts.cloudConsent ?? false;
  }

  async isAvailable(): Promise<boolean> {
    if (this.baseUrl === undefined || this.baseUrl.length === 0) return false;
    // The cloud endpoint requires explicit egress consent (F1862).
    if (this.cloud && !this.cloudConsent) return false;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/system_stats`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    if (this.baseUrl === undefined) throw new Error('ComfyUI is not configured');
    // Submit the workflow (caller-provided or a default txt2img graph).
    const submit = await this.fetchImpl(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: req.workflow ?? this.defaultWorkflow(req) }),
    });
    if (!submit.ok) throw new Error(`ComfyUI submit failed: ${submit.status}`);
    const { prompt_id: promptId } = (await submit.json()) as { prompt_id: string };

    // Poll history for the result, then fetch the image bytes.
    const image = await this.awaitImage(promptId, req.signal);
    return {
      image,
      format: 'png',
      width: req.width ?? 512,
      height: req.height ?? 512,
      provenance: { adapter: this.name, prompt: req.prompt, createdAt: new Date().toISOString() },
    };
  }

  /** A minimal txt2img workflow graph; real deployments override via req.workflow. */
  private defaultWorkflow(req: ImageRequest): Record<string, unknown> {
    return {
      prompt: req.prompt,
      negative: req.negative ?? '',
      width: req.width ?? 512,
      height: req.height ?? 512,
    };
  }

  private async awaitImage(promptId: string, signal?: AbortSignal): Promise<Uint8Array> {
    for (let i = 0; i < 600; i++) {
      if (signal?.aborted) throw new Error('aborted');
      const res = await this.fetchImpl(`${this.baseUrl}/history/${promptId}`, { method: 'GET' });
      if (res.ok) {
        const history = (await res.json()) as Record<string, unknown>;
        const entry = history[promptId] as
          | {
              outputs?: Record<
                string,
                { images?: { filename: string; subfolder: string; type: string }[] }
              >;
            }
          | undefined;
        const img =
          entry?.outputs && Object.values(entry.outputs).flatMap((o) => o.images ?? [])[0];
        if (img) {
          const fileRes = await this.fetchImpl(
            `${this.baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(img.type)}`,
            { method: 'GET' },
          );
          if (fileRes.ok) return new Uint8Array(await fileRes.arrayBuffer());
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('ComfyUI generation timed out');
  }
}
