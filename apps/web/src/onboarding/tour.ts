/**
 * First-run tour logic (F697). A five-step overlay introduces the fusion
 * features that set Fables apart — entities, the in-player codex, lore embeds,
 * the journal, and the bundled demo world. Pure module: dismissal persists
 * through an injected `StorageLike` (mirrors `player/effects.ts`) so the step
 * machine and the dismissal roundtrip are testable without a DOM.
 */

/** One tour card. */
export interface TourStep {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'entities',
    title: 'Entities are your cast & world',
    body: 'Define characters, places and items once as entities, then reference them anywhere. A story binds to entity fields with @Name and @Name.field — change the source of truth and every story updates.',
  },
  {
    id: 'codex',
    title: 'The codex fills itself in',
    body: 'As a reader meets @entities in prose, a spoiler-safe codex grows beside the story. Tap an entity to open its card; fields surfaced in the text are revealed, the rest stay hidden until earned.',
  },
  {
    id: 'lore',
    title: 'Embed lore inline',
    body: 'Wrap a note title in [[double brackets]] to drop a tappable lore embed into the story. Readers pull the worldbuilding when they want it; deleted notes degrade gracefully to inert links.',
  },
  {
    id: 'journal',
    title: 'The journal remembers',
    body: 'Story flow can write to the journal with @journal(...), and entity changes flow through ENTITY_SET. A reader’s playthrough leaves a trail they can look back on.',
  },
  {
    id: 'demo',
    title: 'Start with the Aesop Engine',
    body: 'A bundled demo world — the Fox, the Crow, the Lion and their fables — shows lore embeds, the codex and the journal working together. Load it from docs/demo/aesop to see it all in motion.',
  },
];

export const TOUR_STEP_COUNT = TOUR_STEPS.length;

/** Storage abstraction so the tour is testable without a browser (F697). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const TOUR_STORAGE_KEY = 'fables.onboarding.tour.dismissed';

/** True once the reader has skipped or finished the tour. */
export function isTourDismissed(storage: StorageLike | null): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(TOUR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the dismissal so the tour never auto-opens again. */
export function dismissTour(storage: StorageLike | null): void {
  try {
    storage?.setItem(TOUR_STORAGE_KEY, '1');
  } catch {
    /* storage unavailable — the tour simply reappears next run */
  }
}

/** Clear the dismissal (e.g. a "replay the tour" affordance). */
export function resetTour(storage: StorageLike | null): void {
  try {
    storage?.removeItem(TOUR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Clamp a step index into range. */
export function clampStep(index: number): number {
  if (Number.isNaN(index) || index < 0) return 0;
  if (index > TOUR_STEP_COUNT - 1) return TOUR_STEP_COUNT - 1;
  return Math.floor(index);
}

/** Advance one step, stopping at the last (bounds-safe). */
export function nextStep(index: number): number {
  return clampStep(index + 1);
}

/** Go back one step, stopping at the first (bounds-safe). */
export function prevStep(index: number): number {
  return clampStep(index - 1);
}

/** True when `index` is the final step (the "Done" button shows). */
export function isLastStep(index: number): boolean {
  return clampStep(index) === TOUR_STEP_COUNT - 1;
}
