/**
 * Resource-aware AI guardrails (F1307).
 *
 * A pure policy that decides whether an AI generation should run given the
 * device's current state — battery level, charging status, CPU load, memory
 * pressure — against a configurable budget. Local models are heavy; on a phone
 * over Tailscale you don't want a summary draining the battery. The resolver is
 * deterministic so the decision is testable and explainable.
 */

export interface ResourceState {
  /** 0..1, when known. */
  batteryLevel?: number | undefined;
  charging?: boolean | undefined;
  /** Normalised 0..1 load average, when known. */
  cpuLoad?: number | undefined;
  /** Normalised 0..1 memory pressure, when known. */
  memoryPressure?: number | undefined;
}

export interface ResourceGuardrails {
  /** Block AI below this battery level unless charging. Default 0.2. */
  minBatteryLevel: number;
  /** When true, only block on low battery if not charging. Default true. */
  allowOnCharger: boolean;
  /** Block AI above this CPU load. Default 0.9. */
  maxCpuLoad: number;
  /** Block AI above this memory pressure. Default 0.9. */
  maxMemoryPressure: number;
  /** Master switch — when false, guardrails never block. Default true. */
  enabled: boolean;
}

export const DEFAULT_GUARDRAILS: ResourceGuardrails = {
  minBatteryLevel: 0.2,
  allowOnCharger: true,
  maxCpuLoad: 0.9,
  maxMemoryPressure: 0.9,
  enabled: true,
};

export type BlockReason = 'low-battery' | 'high-cpu' | 'memory-pressure';

export interface ResourceDecision {
  allowed: boolean;
  /** Why it was blocked (empty when allowed). */
  reasons: BlockReason[];
  /** Human-readable explanation. */
  detail: string;
}

/** Decide whether AI may run under the current resource state (F1307). */
export function resolveAiAllowed(
  state: ResourceState,
  config: ResourceGuardrails = DEFAULT_GUARDRAILS,
): ResourceDecision {
  if (!config.enabled) {
    return { allowed: true, reasons: [], detail: 'guardrails disabled' };
  }

  const reasons: BlockReason[] = [];

  const onCharger = state.charging === true;
  if (
    state.batteryLevel !== undefined &&
    state.batteryLevel < config.minBatteryLevel &&
    !(config.allowOnCharger && onCharger)
  ) {
    reasons.push('low-battery');
  }

  if (state.cpuLoad !== undefined && state.cpuLoad > config.maxCpuLoad) {
    reasons.push('high-cpu');
  }

  if (state.memoryPressure !== undefined && state.memoryPressure > config.maxMemoryPressure) {
    reasons.push('memory-pressure');
  }

  if (reasons.length === 0) {
    return { allowed: true, reasons: [], detail: 'resources within budget' };
  }

  return { allowed: false, reasons, detail: explain(reasons, state, config) };
}

function explain(reasons: BlockReason[], state: ResourceState, config: ResourceGuardrails): string {
  const parts = reasons.map((r) => {
    switch (r) {
      case 'low-battery':
        return `battery ${pct(state.batteryLevel)} below ${pct(config.minBatteryLevel)}${
          config.allowOnCharger ? ' (and not charging)' : ''
        }`;
      case 'high-cpu':
        return `CPU load ${pct(state.cpuLoad)} above ${pct(config.maxCpuLoad)}`;
      case 'memory-pressure':
        return `memory pressure ${pct(state.memoryPressure)} above ${pct(config.maxMemoryPressure)}`;
    }
  });
  return `AI paused: ${parts.join('; ')}`;
}

const pct = (n: number | undefined): string => (n === undefined ? '?' : `${Math.round(n * 100)}%`);
