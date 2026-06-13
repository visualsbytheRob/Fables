/** First-run tour logic tests (F697): step bounds + dismissal roundtrip. */
import { describe, expect, it } from 'vitest';
import {
  TOUR_STEPS,
  TOUR_STEP_COUNT,
  TOUR_STORAGE_KEY,
  clampStep,
  dismissTour,
  isLastStep,
  isTourDismissed,
  nextStep,
  prevStep,
  resetTour,
  type StorageLike,
} from './tour.js';

/** In-memory localStorage stand-in so tests run without a DOM. */
const memoryStore = (): StorageLike => {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

describe('tour steps (F697)', () => {
  it('has five steps covering the fusion features', () => {
    expect(TOUR_STEP_COUNT).toBe(5);
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(['entities', 'codex', 'lore', 'journal', 'demo']);
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(3);
      expect(step.body.length).toBeGreaterThan(10);
    }
  });
});

describe('step navigation bounds', () => {
  it('clamps out-of-range indices', () => {
    expect(clampStep(-5)).toBe(0);
    expect(clampStep(99)).toBe(TOUR_STEP_COUNT - 1);
    expect(clampStep(2.7)).toBe(2);
    expect(clampStep(NaN)).toBe(0);
  });

  it('advances and retreats without leaving the range', () => {
    expect(prevStep(0)).toBe(0);
    expect(nextStep(0)).toBe(1);
    expect(nextStep(TOUR_STEP_COUNT - 1)).toBe(TOUR_STEP_COUNT - 1);
    expect(prevStep(TOUR_STEP_COUNT - 1)).toBe(TOUR_STEP_COUNT - 2);
  });

  it('identifies the last step', () => {
    expect(isLastStep(TOUR_STEP_COUNT - 1)).toBe(true);
    expect(isLastStep(0)).toBe(false);
    expect(isLastStep(99)).toBe(true);
  });
});

describe('dismissal roundtrip', () => {
  it('persists and reads the dismissed flag', () => {
    const store = memoryStore();
    expect(isTourDismissed(store)).toBe(false);
    dismissTour(store);
    expect(store.getItem(TOUR_STORAGE_KEY)).toBe('1');
    expect(isTourDismissed(store)).toBe(true);
    resetTour(store);
    expect(isTourDismissed(store)).toBe(false);
  });

  it('treats a null storage as never-dismissed and never throws', () => {
    expect(isTourDismissed(null)).toBe(false);
    expect(() => dismissTour(null)).not.toThrow();
    expect(() => resetTour(null)).not.toThrow();
  });
});
