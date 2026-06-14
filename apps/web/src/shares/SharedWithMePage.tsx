/**
 * F1147 — Shared-with-me page wrapper
 *
 * Thin page shell hosting SharedWithMeView at the /shared-with-me route.
 */
import { SharedWithMeView } from './SharedWithMeView.js';

export function SharedWithMePage() {
  return (
    <div className="ui-stack">
      <h1>Shared with Me</h1>
      <SharedWithMeView />
    </div>
  );
}
