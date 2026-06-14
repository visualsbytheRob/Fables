/**
 * Cloud backend policy (F1362–F1365, F1368).
 *
 * Pure decision logic that gates whether — and how — content may be sent to a
 * cloud model. Keeping it free of I/O makes the privacy rules exhaustively
 * testable. The wiring (config storage, UI consent dialog, indicators) layers on
 * top; the rules themselves live here:
 *
 *   F1362  API-key handling: masking + client-side format validation.
 *   F1363  Per-feature routing: creative tasks prefer the cloud when enabled.
 *   F1364  Egress consent: nothing leaves the machine until the user has agreed.
 *   F1365  Per-notebook exclusions: private notebooks never reach any cloud.
 *   F1368  Cache-friendly request shaping for repeated vault context.
 */

import type { AiTask } from './prompt.js';
import type { GenerateRequest } from './adapter.js';
import { looksLikeApiKey } from './claude.js';

// ── API key handling (F1362) ─────────────────────────────────────────────────

/** Mask a key for display/logging: keep the prefix and last 4, redact the rest. */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

export interface KeyValidation {
  valid: boolean;
  reason?: string;
}

/** Client-side format validation before any network call (F1362). */
export function validateApiKey(key: string): KeyValidation {
  const trimmed = key.trim();
  if (trimmed.length === 0) return { valid: false, reason: 'empty' };
  if (!looksLikeApiKey(trimmed)) return { valid: false, reason: 'unexpected format' };
  return { valid: true };
}

// ── Policy state ─────────────────────────────────────────────────────────────

export interface CloudPolicy {
  /** Master switch: cloud backends usable at all (F1363). */
  enabled: boolean;
  /** The user has explicitly consented to egress (F1364). */
  consentGiven: boolean;
  /** Notebook ids that must never be sent to any cloud backend (F1365). */
  excludedNotebooks: ReadonlySet<string>;
}

export const DEFAULT_CLOUD_POLICY: CloudPolicy = {
  enabled: false,
  consentGiven: false,
  excludedNotebooks: new Set(),
};

// ── Per-feature routing (F1363) ──────────────────────────────────────────────

/** Tasks that default to the cloud when it's enabled — the creative, large ones. */
export const CLOUD_PREFERRED_TASKS: ReadonlySet<AiTask> = new Set<AiTask>(['prose', 'dialogue']);

/** Whether a given task should route to the cloud under this policy (F1363). */
export function shouldRouteToCloud(task: AiTask, policy: CloudPolicy): boolean {
  return policy.enabled && policy.consentGiven && CLOUD_PREFERRED_TASKS.has(task);
}

// ── Egress gate (F1364 + F1365) ──────────────────────────────────────────────

export interface EgressContext {
  /** Notebook the content originates from, if any. */
  notebookId?: string | undefined;
}

export interface EgressDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * The single chokepoint every cloud call must pass (F1364, F1365). Denies unless
 * cloud is enabled, consent is on the record, and the source notebook is not on
 * the exclusion list.
 */
export function canSendToCloud(policy: CloudPolicy, ctx: EgressContext = {}): EgressDecision {
  if (!policy.enabled) return { allowed: false, reason: 'cloud backends disabled' };
  if (!policy.consentGiven) return { allowed: false, reason: 'egress consent not given' };
  if (ctx.notebookId !== undefined && policy.excludedNotebooks.has(ctx.notebookId)) {
    return { allowed: false, reason: 'notebook excluded from cloud' };
  }
  return { allowed: true };
}

// ── Cache-friendly request shaping (F1368) ───────────────────────────────────

export interface CacheShapeInput {
  /** Stable, repeated context (e.g. the vault/world brief) — becomes a cache prefix. */
  stableContext: string;
  /** The variable per-call instruction. */
  variable: string;
  /** Optional extra system guidance appended after the stable context. */
  system?: string | undefined;
}

/**
 * Shape a request so the large, repeated context is a stable prefix in `system`
 * and only the small variable turn changes between calls (F1368). This maximises
 * prompt-cache hits on the cloud path, cutting latency and cost for repeated
 * vault context.
 */
export function shapeCacheFriendly(
  input: CacheShapeInput,
): Pick<GenerateRequest, 'system' | 'prompt'> {
  const system = input.system ? `${input.stableContext}\n\n${input.system}` : input.stableContext;
  return { system, prompt: input.variable };
}
