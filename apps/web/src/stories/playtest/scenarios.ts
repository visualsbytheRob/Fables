/**
 * Choice-path scenarios (F536/F537): named recorded playthroughs persisted in
 * localStorage per story. The runner replays each scenario against the
 * current build and diffs transcripts so regressions show up as failed chips.
 */
import type { IrProgram } from '@fables/forge-vm';
import { startRun, transcriptOf } from './engine.js';
import { makeSimHost, type SimMocks } from '../knowledgeSim.js';

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly seed: number | string;
  /** Choice texts, in order. */
  readonly choices: readonly string[];
  /** Transcript recorded when the scenario was saved. */
  readonly baseline: string;
  readonly createdAt: string;
}

export interface DiffLine {
  readonly op: 'equal' | 'add' | 'del';
  readonly text: string;
}

export type ScenarioStatus = 'pass' | 'fail' | 'error';

export interface ScenarioResult {
  readonly scenario: Scenario;
  readonly status: ScenarioStatus;
  readonly transcript: string;
  readonly diff: readonly DiffLine[];
  readonly error: string | null;
  /**
   * True when replaying the scenario read an `@entity.field` with no mock
   * backing it — i.e. it would hit live data, a determinism risk for the
   * recorded baseline (F647).
   */
  readonly usedLiveBindings: boolean;
}

const storageKey = (storyId: string): string => `fables.playtest.scenarios.${storyId}`;

interface ScenarioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storage = (): ScenarioStorage | null =>
  typeof localStorage === 'undefined' ? null : localStorage;

export function loadScenarios(storyId: string, store: ScenarioStorage | null = storage()): Scenario[] {
  if (store === null) return [];
  try {
    const raw = store.getItem(storageKey(storyId));
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Scenario[]) : [];
  } catch {
    return [];
  }
}

export function persistScenarios(
  storyId: string,
  scenarios: readonly Scenario[],
  store: ScenarioStorage | null = storage(),
): void {
  store?.setItem(storageKey(storyId), JSON.stringify(scenarios));
}

export function saveScenario(
  storyId: string,
  scenario: Omit<Scenario, 'id' | 'createdAt'>,
  store: ScenarioStorage | null = storage(),
): Scenario {
  const saved: Scenario = {
    ...scenario,
    id: `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  persistScenarios(storyId, [...loadScenarios(storyId, store), saved], store);
  return saved;
}

export function deleteScenario(
  storyId: string,
  id: string,
  store: ScenarioStorage | null = storage(),
): void {
  persistScenarios(
    storyId,
    loadScenarios(storyId, store).filter((s) => s.id !== id),
    store,
  );
}

/** Line diff via LCS — transcripts are short, O(n·m) is fine. */
export function diffTranscripts(before: string, after: string): DiffLine[] {
  const a = before.length === 0 ? [] : before.split('\n');
  const b = after.length === 0 ? [] : after.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? (lcs[i + 1]![j + 1] as number) + 1
          : Math.max(lcs[i + 1]![j] as number, lcs[i]![j + 1] as number);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'equal', text: a[i] as string });
      i++;
      j++;
    } else if ((lcs[i + 1]![j] as number) >= (lcs[i]![j + 1] as number)) {
      out.push({ op: 'del', text: a[i] as string });
      i++;
    } else {
      out.push({ op: 'add', text: b[j] as string });
      j++;
    }
  }
  for (; i < n; i++) out.push({ op: 'del', text: a[i] as string });
  for (; j < m; j++) out.push({ op: 'add', text: b[j] as string });
  return out;
}

/**
 * Replay a scenario against the current program and diff transcripts (F537).
 * Entity-field reads are served through a knowledge sim host seeded with
 * `mocks`; any read with no mock flips `usedLiveBindings` so the chip can warn
 * about a non-deterministic baseline (F647).
 */
export function runScenario(
  program: IrProgram,
  scenario: Scenario,
  mocks: SimMocks = new Map(),
): ScenarioResult {
  const sim = makeSimHost(mocks);
  const run = startRun(program, { seed: scenario.seed, host: sim.host }, scenario.choices);
  if (run.error !== null) {
    return {
      scenario,
      status: 'error',
      transcript: '',
      diff: diffTranscripts(scenario.baseline, ''),
      error: run.error,
      usedLiveBindings: sim.usedLiveBindings(),
    };
  }
  const transcript = transcriptOf(run.lines);
  const incomplete = run.divergedAt !== null || run.applied < scenario.choices.length;
  const pass = !incomplete && transcript === scenario.baseline;
  return {
    scenario,
    status: pass ? 'pass' : 'fail',
    transcript,
    diff: diffTranscripts(scenario.baseline, transcript),
    error: null,
    usedLiveBindings: sim.usedLiveBindings(),
  };
}
