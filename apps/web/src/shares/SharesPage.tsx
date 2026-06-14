/**
 * F1144 / F1147 — Shares page wrapper
 *
 * Hosts both the ShareManagementPanel (/shares) and the SharedWithMeView
 * (/shared-with-me) as separate routes.  Both are lazy-loaded via the
 * standard lazyPage() pattern in App.tsx.
 */
import { ShareManagementPanel } from './ShareManagementPanel.js';

export function SharesPage() {
  return (
    <div className="ui-stack">
      <h1>Share Management</h1>
      <ShareManagementPanel />
    </div>
  );
}
