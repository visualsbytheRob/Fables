/**
 * Model capability registry (F1304).
 *
 * Maps a backend-native model name to its context window and speed class so the
 * router (F1314) can pick "small for tags, big for prose" without hardcoding
 * per-model knowledge at every call site. Matching is by case-insensitive
 * substring against known families, with a conservative default for unknowns.
 */

import type { ModelInfo, SpeedClass } from './adapter.js';

interface Capability {
  contextTokens: number;
  speedClass: SpeedClass;
}

/** Ordered: the first family whose key appears in the model name wins. */
const FAMILIES: { match: string; cap: Capability }[] = [
  { match: 'qwen2.5:0.5b', cap: { contextTokens: 32768, speedClass: 'fast' } },
  { match: 'qwen2.5:1.5b', cap: { contextTokens: 32768, speedClass: 'fast' } },
  { match: 'gemma2:2b', cap: { contextTokens: 8192, speedClass: 'fast' } },
  { match: 'phi3', cap: { contextTokens: 4096, speedClass: 'fast' } },
  { match: 'llama3.2:1b', cap: { contextTokens: 131072, speedClass: 'fast' } },
  { match: 'llama3.2:3b', cap: { contextTokens: 131072, speedClass: 'balanced' } },
  { match: 'llama3.1:8b', cap: { contextTokens: 131072, speedClass: 'balanced' } },
  { match: 'llama3', cap: { contextTokens: 8192, speedClass: 'balanced' } },
  { match: 'mistral', cap: { contextTokens: 32768, speedClass: 'balanced' } },
  { match: 'qwen2.5:7b', cap: { contextTokens: 32768, speedClass: 'balanced' } },
  { match: 'qwen2.5:14b', cap: { contextTokens: 32768, speedClass: 'large' } },
  { match: '70b', cap: { contextTokens: 131072, speedClass: 'large' } },
  // Cloud Claude models (F1361). Large context; speed class by tier.
  { match: 'claude-haiku', cap: { contextTokens: 200_000, speedClass: 'fast' } },
  { match: 'claude-sonnet', cap: { contextTokens: 200_000, speedClass: 'balanced' } },
  { match: 'claude-opus', cap: { contextTokens: 200_000, speedClass: 'large' } },
];

const DEFAULT_CAP: Capability = { contextTokens: 4096, speedClass: 'balanced' };

/** Capabilities for a model name (best-effort). */
export function capabilitiesFor(name: string): Capability {
  const lower = name.toLowerCase();
  for (const f of FAMILIES) {
    if (lower.includes(f.match)) return f.cap;
  }
  return DEFAULT_CAP;
}

/** Annotate a raw model name into a full ModelInfo. */
export function toModelInfo(name: string): ModelInfo {
  return { name, ...capabilitiesFor(name) };
}

/** Pick the best model for a desired speed class from an available set (F1314). */
export function selectForSpeed(models: ModelInfo[], desired: SpeedClass): ModelInfo | null {
  if (models.length === 0) return null;
  const exact = models.find((m) => m.speedClass === desired);
  if (exact) return exact;
  // Fall back along the size axis: fast → balanced → large and vice-versa.
  const order: SpeedClass[] = ['fast', 'balanced', 'large'];
  const want = order.indexOf(desired);
  return (
    [...models].sort(
      (a, b) =>
        Math.abs(order.indexOf(a.speedClass) - want) - Math.abs(order.indexOf(b.speedClass) - want),
    )[0] ?? null
  );
}
