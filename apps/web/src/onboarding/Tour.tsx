/**
 * First-run tour overlay (F697). A dismissible five-step walkthrough of the
 * fusion features (entities, codex, lore embeds, journal, demo world). It
 * auto-opens once — keyed off localStorage — and never reappears after the
 * reader skips or finishes. Step text and dismissal logic live in `tourLogic.ts`;
 * this component is the presentation + persistence shell.
 *
 * Mounting is someone else's job: just render <Tour /> wherever the app shell
 * lives. It self-suppresses when already dismissed.
 */
import { useState } from 'react';
import { Button, BookOpen, ChevronRight, Check, X } from '@fables/ui';
import {
  TOUR_STEPS,
  TOUR_STEP_COUNT,
  dismissTour,
  isLastStep,
  isTourDismissed,
  nextStep,
  prevStep,
  type StorageLike,
} from './tourLogic.js';
import './onboarding.css';

export interface TourProps {
  /** Injectable storage (tests); defaults to localStorage when available. */
  storage?: StorageLike | null;
  /** Force-open regardless of the dismissed flag (a "replay tour" entry). */
  forceOpen?: boolean;
  /** Notified after the tour is skipped or completed. */
  onClose?: () => void;
}

const defaultStorage = (): StorageLike | null =>
  typeof localStorage === 'undefined' ? null : localStorage;

export function Tour({ storage, forceOpen = false, onClose }: TourProps) {
  const store = storage === undefined ? defaultStorage() : storage;
  const [open, setOpen] = useState(() => forceOpen || !isTourDismissed(store));
  const [step, setStep] = useState(0);

  if (!open) return null;

  const current = TOUR_STEPS[step] ?? TOUR_STEPS[0];
  if (current === undefined) return null;
  const last = isLastStep(step);

  const close = (): void => {
    dismissTour(store);
    setOpen(false);
    onClose?.();
  };

  return (
    <div
      className="tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Fables"
      data-testid="tour"
    >
      <div className="tour-card">
        <button className="tour-skip" onClick={close} aria-label="Skip the tour">
          <X size={16} />
        </button>
        <div className="tour-icon">
          <BookOpen size={20} />
        </div>
        <h2 className="tour-title">{current.title}</h2>
        <p className="tour-body">{current.body}</p>

        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((s, i) => (
            <span key={s.id} className={`tour-dot${i === step ? ' active' : ''}`} />
          ))}
        </div>

        <div className="tour-actions">
          <button className="tour-link" onClick={close}>
            Skip
          </button>
          <span className="tour-progress">
            {step + 1} / {TOUR_STEP_COUNT}
          </span>
          {step > 0 ? <Button onClick={() => setStep((i) => prevStep(i))}>Back</Button> : null}
          {last ? (
            <Button variant="primary" onClick={close}>
              <Check size={14} /> Done
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setStep((i) => nextStep(i))}>
              Next <ChevronRight size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
