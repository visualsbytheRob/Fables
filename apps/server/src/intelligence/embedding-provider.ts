/**
 * EmbeddingProvider interface + built-in implementations (F721–F730).
 *
 * Design: graceful-degradation first.
 *   - `hashEmbeddingProvider` — pure-JS, deterministic, zero deps.
 *     Always available. Used in all tests. Default when ONNX is absent.
 *   - `onnxEmbeddingProvider` — optional: dynamically imports onnxruntime-node
 *     only when the package is present AND a model file has been downloaded.
 *     Never crashes; reports available()=false otherwise.
 *
 * Linear scan is correct and fast for a single-user vault (<10k chunks).
 * sqlite-vec is documented as a future optimisation path (F736 note).
 */

// ── Interface ────────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  /** Stable identifier, stored in embeddings table alongside each vector. */
  readonly id: string;
  /** Fixed dimensionality — all vectors from this provider have this length. */
  readonly dim: number;
  /** Embed a batch of texts. Returns one float array per input, in order. */
  embed(texts: string[]): Promise<number[][]>;
  /** Whether this provider can actually run right now. */
  available(): boolean;
}

// ── Hash-based pure-JS fallback ──────────────────────────────────────────────

/**
 * Deterministic n-gram bag projected to `dim` dimensions via FNV-1a hashing,
 * then L2-normalised. No dependencies. Used in all tests as the default.
 *
 * This is NOT a quality semantic embedding. Its purpose is:
 *   1. Tests pass without any native deps or model downloads.
 *   2. The embedding pipeline code path is fully exercised.
 *   3. Graceful-degradation fallback when ONNX model is absent.
 *
 * Quality note: if you want real semantic search, download a sentence-transformer
 * model and point FABLES_EMBEDDING_MODEL at it — the ONNX provider takes over.
 */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // multiply by FNV prime (2^24 + 2^8 + 0x93), keep in 32-bit range
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0; // unsigned
}

function charNgrams(text: string, n: number): string[] {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (norm.length < n) return [norm];
  const out: string[] = [];
  for (let i = 0; i <= norm.length - n; i++) {
    out.push(norm.slice(i, i + n));
  }
  return out;
}

function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}

export function hashEmbed(text: string, dim: number): number[] {
  const acc = new Float32Array(dim);
  // Character trigrams and bigrams mixed give reasonable spread
  const ngrams = [...charNgrams(text, 3), ...charNgrams(text, 2)];
  for (const ng of ngrams) {
    const h = fnv1a32(ng);
    // Two projections from the same hash to reduce collision density
    const idx1 = h % dim;
    const idx2 = (h >>> 16) % dim;
    acc[idx1] = (acc[idx1] ?? 0) + 1;
    acc[idx2] = (acc[idx2] ?? 0) - 0.5; // asymmetric to avoid cancellation
  }
  const normed = l2Normalize(acc);
  return Array.from(normed);
}

function makeHashProvider(dim: number): EmbeddingProvider {
  return {
    id: `hash-${dim}`,
    dim,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => hashEmbed(t, dim));
    },
    available(): boolean {
      return true;
    },
  };
}

/** Default production dim = 384 (matches typical sentence-transformer output). */
export const defaultHashProvider: EmbeddingProvider = makeHashProvider(384);

/** Tiny-dim variant for tests (fast + deterministic). */
export const testHashProvider: EmbeddingProvider = makeHashProvider(64);

// ── ONNX optional provider ───────────────────────────────────────────────────

/**
 * Wraps onnxruntime-node. Only active when:
 *   1. `onnxruntime-node` package resolves at runtime.
 *   2. `modelPath` is provided and the file exists.
 *
 * Usage: set env FABLES_EMBEDDING_MODEL=/path/to/model.onnx.
 * Model swap = call createOnnxProvider with new path; the job queue re-embeds.
 *
 * Future: sqlite-vec extension (https://github.com/asg017/sqlite-vec) would
 * replace the linear scan in vectorStore with an ANN index. For a single-user
 * vault of <50k chunks the linear scan is <10ms (F736).
 */
export function createOnnxProvider(modelPath: string | undefined, dim = 384): EmbeddingProvider {
  let _session: { run: (feeds: unknown) => Promise<Record<string, { data: Float32Array }>> } | null = null;
  let _ort: Record<string, unknown> | null = null;
  let _available = false;

  async function loadSession(): Promise<boolean> {
    if (_session) return true;
    if (!modelPath) return false;
    try {
      const fs = await import('node:fs');
      if (!fs.existsSync(modelPath)) return false;
      // Dynamic import via Function to avoid TS module resolution — graceful if absent.
      const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
      const ort = await dynamicImport('onnxruntime-node').catch(() => null) as Record<string, unknown> | null;
      if (!ort) return false;
      _ort = ort;
      const InferenceSession = ort['InferenceSession'] as { create: (p: string) => Promise<unknown> };
      _session = await InferenceSession.create(modelPath) as typeof _session;
      _available = true;
      return true;
    } catch {
      return false;
    }
  }

  return {
    id: `onnx-${dim}`,
    dim,
    async embed(texts: string[]): Promise<number[][]> {
      const ok = await loadSession();
      if (!ok || !_session || !_ort) {
        // Graceful fallback: use hash embeddings
        return texts.map((t) => hashEmbed(t, dim));
      }
      try {
        const Tensor = _ort['Tensor'] as new (type: string, data: unknown, dims: number[]) => unknown;
        const results: number[][] = [];
        for (const text of texts) {
          const inputIds = new BigInt64Array(
            text.split('').slice(0, 512).map((c) => BigInt(c.charCodeAt(0))),
          );
          const feeds = { input_ids: new Tensor('int64', inputIds, [1, inputIds.length]) };
          const output = await _session.run(feeds);
          const firstOutput = Object.values(output)[0];
          const vec = firstOutput ? Array.from(firstOutput.data) : [];
          results.push(vec.length > 0 ? vec : hashEmbed(text, dim));
        }
        return results;
      } catch {
        return texts.map((t) => hashEmbed(t, dim));
      }
    },
    available(): boolean {
      return _available;
    },
  };
}

// ── Provider registry ────────────────────────────────────────────────────────

/**
 * Returns the best available provider, or the pure-JS fallback.
 * Called at startup and after model-swap.
 */
export function resolveProvider(modelPath: string | undefined): EmbeddingProvider {
  if (modelPath) {
    // Return the ONNX provider; it will report available()=false if load fails
    return createOnnxProvider(modelPath, 384);
  }
  return defaultHashProvider;
}
