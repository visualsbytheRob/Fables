/**
 * F971–F980 — /analytics route: local analytics dashboard + opt-out toggle.
 */
import { AnalyticsDashboard } from './AnalyticsDashboard.js';

export function AnalyticsPage() {
  return (
    <div>
      <div style={{ padding: 'var(--space-5)', borderBottom: '1px solid var(--border)' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>Local Analytics</h1>
        <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>
          Usage statistics collected entirely on your machine.
        </p>
      </div>
      <AnalyticsDashboard />
    </div>
  );
}
