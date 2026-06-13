/**
 * F972/F975/F976/F979 — Local analytics dashboard.
 * Displays feature counters, hourly activity, slow ops, and client errors.
 * Everything is purely local — no server data is involved.
 */
import { useEffect, useState } from 'react';
import { Button } from '@fables/ui';
import {
  activityByHour,
  loadClientErrors,
  loadSlowOps,
  purgeAll,
  topFeatures,
  type ClientError,
  type FeatureCounter,
  type SlowOp,
} from './analyticsStore.js';
import './analytics.css';

function HourBar({ hour, count, max }: { hour: number; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="analytics-hour-bar" title={`${hour}:00 — ${count} events`}>
      <div className="analytics-hour-bar__fill" style={{ height: `${pct}%` }} />
      <div className="analytics-hour-bar__label">{hour}</div>
    </div>
  );
}

function FeatureRow({ counter }: { counter: FeatureCounter }) {
  const date = counter.lastUsedAt ? new Date(counter.lastUsedAt).toLocaleDateString() : '—';
  return (
    <tr className="analytics-table__row">
      <td className="analytics-table__cell analytics-table__cell--feature">{counter.id}</td>
      <td className="analytics-table__cell analytics-table__cell--num">{counter.count}</td>
      <td className="analytics-table__cell analytics-table__cell--date">{date}</td>
    </tr>
  );
}

function ErrorRow({ error }: { error: ClientError }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr className="analytics-table__row analytics-table__row--error">
        <td className="analytics-table__cell analytics-table__cell--msg">{error.message}</td>
        <td className="analytics-table__cell analytics-table__cell--num">{error.count}</td>
        <td className="analytics-table__cell analytics-table__cell--date">
          {new Date(error.lastSeenAt).toLocaleDateString()}
        </td>
        <td className="analytics-table__cell">
          {error.stack && (
            <button
              type="button"
              className="analytics-expand-btn"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse stack trace' : 'Expand stack trace'}
            >
              {expanded ? '−' : '+'}
            </button>
          )}
        </td>
      </tr>
      {expanded && error.stack && (
        <tr>
          <td colSpan={4} className="analytics-table__stack">
            <pre>{error.stack}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

function SlowOpRow({ op }: { op: SlowOp }) {
  return (
    <tr className="analytics-table__row">
      <td className="analytics-table__cell">{op.op}</td>
      <td className="analytics-table__cell analytics-table__cell--num">{op.durationMs} ms</td>
      <td className="analytics-table__cell analytics-table__cell--date">
        {new Date(op.recordedAt).toLocaleDateString()}
      </td>
    </tr>
  );
}

export function AnalyticsDashboard() {
  const [features, setFeatures] = useState<FeatureCounter[]>([]);
  const [hourly, setHourly] = useState<Record<number, number>>({});
  const [slowOps, setSlowOps] = useState<SlowOp[]>([]);
  const [errors, setErrors] = useState<ClientError[]>([]);

  function reload() {
    setFeatures(topFeatures(20));
    setHourly(activityByHour());
    setSlowOps(loadSlowOps().slice(-50).reverse());
    setErrors(loadClientErrors().slice().sort((a, b) => b.count - a.count));
  }

  useEffect(() => {
    reload();
  }, []);

  const maxHourly = Math.max(...Object.values(hourly), 1);

  return (
    <div className="analytics-dashboard" role="main" aria-label="Local analytics dashboard">
      {/* Privacy notice (F979) */}
      <div className="analytics-privacy" role="note" aria-label="Privacy notice">
        <strong>Everything stays on your machine.</strong> No analytics data is ever sent to any
        server or third party. All data is stored only in your browser's localStorage.
      </div>

      {/* Top features */}
      <section className="analytics-section" aria-labelledby="analytics-features-heading">
        <h3 id="analytics-features-heading" className="analytics-section__title">
          Most-Used Features
        </h3>
        {features.length === 0 ? (
          <p className="analytics-empty">No feature usage recorded yet.</p>
        ) : (
          <table className="analytics-table" aria-label="Feature usage">
            <thead>
              <tr>
                <th className="analytics-table__th">Feature</th>
                <th className="analytics-table__th analytics-table__th--num">Uses</th>
                <th className="analytics-table__th">Last used</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <FeatureRow key={f.id} counter={f} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Busiest hours chart */}
      <section className="analytics-section" aria-labelledby="analytics-hours-heading">
        <h3 id="analytics-hours-heading" className="analytics-section__title">
          Activity by Hour (UTC)
        </h3>
        {Object.keys(hourly).length === 0 ? (
          <p className="analytics-empty">No activity data yet.</p>
        ) : (
          <div className="analytics-hourly" role="img" aria-label="Hourly activity chart">
            {Array.from({ length: 24 }, (_, h) => (
              <HourBar key={h} hour={h} count={hourly[h] ?? 0} max={maxHourly} />
            ))}
          </div>
        )}
      </section>

      {/* Slow ops */}
      <section className="analytics-section" aria-labelledby="analytics-slow-heading">
        <h3 id="analytics-slow-heading" className="analytics-section__title">
          Recent Slow Operations (&gt;500 ms)
        </h3>
        {slowOps.length === 0 ? (
          <p className="analytics-empty">No slow operations recorded.</p>
        ) : (
          <table className="analytics-table" aria-label="Slow operations">
            <thead>
              <tr>
                <th className="analytics-table__th">Operation</th>
                <th className="analytics-table__th analytics-table__th--num">Duration</th>
                <th className="analytics-table__th">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {slowOps.map((op, i) => (
                <SlowOpRow key={i} op={op} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Client errors */}
      <section className="analytics-section" aria-labelledby="analytics-errors-heading">
        <h3 id="analytics-errors-heading" className="analytics-section__title">
          Client Error Aggregation
        </h3>
        {errors.length === 0 ? (
          <p className="analytics-empty">No client errors recorded.</p>
        ) : (
          <table className="analytics-table" aria-label="Client errors">
            <thead>
              <tr>
                <th className="analytics-table__th">Message</th>
                <th className="analytics-table__th analytics-table__th--num">Count</th>
                <th className="analytics-table__th">Last seen</th>
                <th className="analytics-table__th" />
              </tr>
            </thead>
            <tbody>
              {errors.map((e, i) => (
                <ErrorRow key={i} error={e} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Purge / retention controls */}
      <section className="analytics-section analytics-section--actions" aria-labelledby="analytics-retention-heading">
        <h3 id="analytics-retention-heading" className="analytics-section__title">
          Data Retention (F977)
        </h3>
        <p className="analytics-empty">
          Data is kept for up to 90 days and automatically pruned. You can clear it immediately below.
        </p>
        <Button
          variant="danger"
          onClick={() => {
            purgeAll();
            reload();
          }}
          aria-label="Clear all analytics data"
        >
          Clear all analytics data
        </Button>
      </section>
    </div>
  );
}
