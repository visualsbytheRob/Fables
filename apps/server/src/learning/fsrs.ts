/**
 * FSRS-5 spaced-repetition scheduler (Epic 18, F1702).
 *
 * A faithful, dependency-free implementation of the Free Spaced Repetition
 * Scheduler (v5) — the memory model that decides when each card is next due.
 * It models a card with two latent variables:
 *
 *   - **stability** (S): days for retrievability to fall from 100% to 90%.
 *   - **difficulty** (D): 1–10, how hard the card is to make stable.
 *
 * After each review the rating (Again/Hard/Good/Easy) updates S and D; the next
 * interval is chosen so the card is due when predicted retrievability drops to
 * the requested retention. Pure functions, no I/O — see fsrs.test.ts for the
 * conformance + property checks (F1708/F1709).
 */

/** Again, Hard, Good, Easy. */
export type Rating = 1 | 2 | 3 | 4;
export const RATING = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;

/** The 19 FSRS-5 weights, in order. */
export type FsrsParams = readonly number[];

/** Published FSRS-5 default weights. */
export const DEFAULT_PARAMS: FsrsParams = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];

/** Forgetting-curve constants (S is defined at R = 0.9). */
const DECAY = -0.5;
const FACTOR = 19 / 81; // = 0.9^(1/DECAY) - 1

const MIN_STABILITY = 0.01;
const MIN_D = 1;
const MAX_D = 10;

export interface FsrsState {
  /** Memory stability, in days. */
  stability: number;
  /** Difficulty, 1–10. */
  difficulty: number;
}

const clampD = (d: number): number => Math.min(MAX_D, Math.max(MIN_D, d));
const clampS = (s: number): number => Math.max(MIN_STABILITY, s);

/** Retrievability after `elapsedDays` for a card of the given `stability`. */
export function retrievability(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
}

/** Days until retrievability decays to `requestRetention` (0<r<1) for `stability`. */
export function intervalForRetention(stability: number, requestRetention: number): number {
  return (stability / FACTOR) * (Math.pow(requestRetention, 1 / DECAY) - 1);
}

/** Initial difficulty after the first rating (F1702). */
export function initialDifficulty(params: FsrsParams, grade: Rating): number {
  return clampD(params[4]! - Math.exp(params[5]! * (grade - 1)) + 1);
}

/** Initial stability after the first rating: the per-grade seed weight. */
export function initialStability(params: FsrsParams, grade: Rating): number {
  return clampS(params[grade - 1]!);
}

/** Difficulty target for mean-reversion: the initial difficulty of an Easy rating. */
function difficultyEasyAnchor(params: FsrsParams): number {
  return initialDifficulty(params, RATING.Easy);
}

/** Next difficulty after a review (linear damping + mean reversion). */
export function nextDifficulty(params: FsrsParams, difficulty: number, grade: Rating): number {
  const deltaD = -params[6]! * (grade - 3);
  const damped = difficulty + (deltaD * (10 - difficulty)) / 9;
  const reverted = params[7]! * difficultyEasyAnchor(params) + (1 - params[7]!) * damped;
  return clampD(reverted);
}

/** Next stability after a successful review (Hard/Good/Easy). */
export function nextStabilityRecall(
  params: FsrsParams,
  difficulty: number,
  stability: number,
  reviewR: number,
  grade: Rating,
): number {
  const hardPenalty = grade === RATING.Hard ? params[15]! : 1;
  const easyBonus = grade === RATING.Easy ? params[16]! : 1;
  const inc =
    Math.exp(params[8]!) *
    (11 - difficulty) *
    Math.pow(stability, -params[9]!) *
    (Math.exp(params[10]! * (1 - reviewR)) - 1) *
    hardPenalty *
    easyBonus;
  return clampS(stability * (1 + inc));
}

/** Next stability after a lapse (Again). Never exceeds the pre-lapse stability. */
export function nextStabilityForget(
  params: FsrsParams,
  difficulty: number,
  stability: number,
  reviewR: number,
): number {
  const sForget =
    params[11]! *
    Math.pow(difficulty, -params[12]!) *
    (Math.pow(stability + 1, params[13]!) - 1) *
    Math.exp(params[14]! * (1 - reviewR));
  return clampS(Math.min(sForget, stability));
}

/** Same-day (short-term) stability bump when reviewing again before a day passes. */
export function shortTermStability(params: FsrsParams, stability: number, grade: Rating): number {
  return clampS(stability * Math.exp(params[17]! * (grade - 3 + params[18]!)));
}

export interface ScheduleResult {
  state: FsrsState;
  /** Whole-day interval until the card is next due. */
  intervalDays: number;
  /** Predicted retrievability that was used to schedule (for logging). */
  reviewR: number;
}

export interface ScheduleOptions {
  params?: FsrsParams;
  /** Target retention, 0<r<1. Default 0.9. */
  requestRetention?: number;
  /** Hard ceiling on the interval, in days. Default 100 years. */
  maximumIntervalDays?: number;
}

/**
 * Schedule the next review (F1702). `prev` is null for a brand-new card.
 * `elapsedDays` is days since the card was last reviewed (0 for same-day).
 */
export function schedule(
  prev: FsrsState | null,
  grade: Rating,
  elapsedDays: number,
  options: ScheduleOptions = {},
): ScheduleResult {
  const params = options.params ?? DEFAULT_PARAMS;
  const requestRetention = options.requestRetention ?? 0.9;
  const maxInterval = options.maximumIntervalDays ?? 365 * 100;

  let state: FsrsState;
  let reviewR = 1;

  if (!prev) {
    // First review: seed S and D from the grade.
    state = {
      stability: initialStability(params, grade),
      difficulty: initialDifficulty(params, grade),
    };
  } else {
    reviewR = retrievability(elapsedDays, prev.stability);
    const difficulty = nextDifficulty(params, prev.difficulty, grade);
    let stability: number;
    if (elapsedDays < 1) {
      stability = shortTermStability(params, prev.stability, grade);
    } else if (grade === RATING.Again) {
      stability = nextStabilityForget(params, prev.difficulty, prev.stability, reviewR);
    } else {
      stability = nextStabilityRecall(params, prev.difficulty, prev.stability, reviewR, grade);
    }
    state = { stability, difficulty };
  }

  const raw = intervalForRetention(state.stability, requestRetention);
  const intervalDays = Math.min(maxInterval, Math.max(1, Math.round(raw)));
  return { state, intervalDays, reviewR };
}
