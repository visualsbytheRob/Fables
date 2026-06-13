/**
 * End-of-story card (F567/F568): branch explorer (% of knots visited this
 * run, from VM visit counts) and the endings collection with an optional
 * undiscovered-count hint. Total endings come from the scene graph stats.
 */
import { Button } from '@fables/ui';
import type { KnotProgress } from './engine.js';
import type { EndingRecord } from './prefs.js';

export function EndScreen({
  endingLabel,
  progress,
  endings,
  totalEndings,
  showHints,
  onReplay,
  onTranscript,
  onExit,
}: {
  endingLabel: string;
  progress: KnotProgress;
  endings: readonly EndingRecord[];
  /** Static ending count from the scene graph; null if the build failed. */
  totalEndings: number | null;
  showHints: boolean;
  onReplay: () => void;
  onTranscript: () => void;
  onExit: () => void;
}) {
  const undiscovered =
    totalEndings === null ? null : Math.max(0, totalEndings - endings.length);
  return (
    <div className="player-end" data-testid="player-end">
      <h2>The End</h2>
      <p style={{ color: 'var(--pl-dim)' }}>“{endingLabel}”</p>

      <p style={{ marginBottom: 4 }}>
        You saw {progress.visited} of {progress.total} scenes — {progress.pct}%
      </p>
      <div className="player-progressbar" role="img" aria-label={`${progress.pct}% of content seen`}>
        <span style={{ width: `${progress.pct}%` }} />
      </div>

      <div className="player-endings" aria-label="Endings collected">
        {endings.map((ending) => (
          <span key={ending.id} className="player-ending-chip">
            {ending.label}
            {ending.timesReached > 1 ? ` ×${ending.timesReached}` : ''}
          </span>
        ))}
        {showHints && undiscovered !== null && undiscovered > 0 ? (
          <span className="player-ending-chip undiscovered">
            {undiscovered} undiscovered ending{undiscovered === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={onReplay}>
          Play again
        </Button>
        <Button onClick={onTranscript}>Read transcript</Button>
        <Button onClick={onExit}>Back to library</Button>
      </div>
    </div>
  );
}
