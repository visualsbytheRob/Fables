/**
 * Insights page (F791–F800): /insights route.
 * Overview stat cards, growth chart, streak heatmap, stale notes, suggested
 * links, reading funnel, dead-ends, vault health score + checklist,
 * and a "Generate digest" button.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  BarChart2,
  Brain,
  Button,
  CircleCheck,
  ExternalLink,
  Heart,
  Lightbulb,
  Loader2,
  TrendingUp,
  useToast,
  Zap,
} from '@fables/ui';
import {
  useInsightsDeadEnds,
  useInsightsDigest,
  useInsightsGrowth,
  useInsightsHealth,
  useInsightsOverview,
  useInsightsReading,
  useInsightsStale,
  useInsightsStreaks,
  useInsightsSuggestedLinks,
} from '../api/hooks.js';
import { ActivityHeatmap } from './ActivityHeatmap.js';
import { GrowthChart } from './GrowthChart.js';
import './insights.css';

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ size?: number }>;
}) {
  return (
    <div className="insights-stat">
      <Icon size={20} />
      <div className="insights-stat__body">
        <div className="insights-stat__value">{value}</div>
        <div className="insights-stat__label">{label}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="insights-section">
      <h2 className="insights-section__title">{title}</h2>
      {children}
    </section>
  );
}

/** Get ISO date strings for the last N days. */
function dateRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - days);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function InsightsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [growthField, setGrowthField] = useState<'notes' | 'words' | 'links'>('notes');

  const { from, to } = dateRange(90);

  const overview = useInsightsOverview();
  const growth = useInsightsGrowth(from, to);
  const streaks = useInsightsStreaks();
  const stale = useInsightsStale(10);
  const suggested = useInsightsSuggestedLinks(10);
  const reading = useInsightsReading();
  const deadEnds = useInsightsDeadEnds();
  const health = useInsightsHealth();
  const digest = useInsightsDigest();

  const handleDigest = () => {
    digest.mutate(undefined, {
      onSuccess: (note) => {
        toast('Digest note created');
        navigate(`/notes/${note.id}`);
      },
      onError: (err) => toast(`Digest failed: ${err.message}`, 'error'),
    });
  };

  const formatWords = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div className="insights-page">
      <div className="insights-header">
        <h1 className="insights-header__title">
          <Brain size={24} /> Insights
        </h1>
        <Button
          variant="primary"
          onClick={handleDigest}
          disabled={digest.isPending}
        >
          {digest.isPending ? <Loader2 size={14} /> : <Zap size={14} />}
          Generate digest
        </Button>
      </div>

      {/* Overview stats */}
      <Section title="Overview">
        {overview.isPending ? (
          <div className="insights-loading">Loading…</div>
        ) : overview.data ? (
          <div className="insights-stats-grid">
            <StatCard label="Notes" value={overview.data.notes} icon={Activity} />
            <StatCard label="Notebooks" value={overview.data.notebooks} icon={BarChart2} />
            <StatCard label="Entities" value={overview.data.entities} icon={Brain} />
            <StatCard label="Stories" value={overview.data.stories} icon={TrendingUp} />
            <StatCard label="Links" value={overview.data.links} icon={ExternalLink} />
            <StatCard label="Orphans" value={overview.data.orphans} icon={AlertCircle} />
            <StatCard label="Total words" value={formatWords(overview.data.wordsTotal)} icon={Activity} />
          </div>
        ) : (
          <div className="insights-error">Could not load overview</div>
        )}
      </Section>

      {/* Growth chart */}
      <Section title="Growth">
        <div className="insights-chart-toolbar">
          {(['notes', 'words', 'links'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`insights-chart-tab${growthField === f ? ' insights-chart-tab--active' : ''}`}
              onClick={() => setGrowthField(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="insights-chart">
          {growth.data && growth.data.length > 0 ? (
            <GrowthChart data={growth.data} field={growthField} width={560} height={140} />
          ) : growth.isPending ? (
            <div className="insights-loading">Loading…</div>
          ) : (
            <div className="insights-empty">No growth data yet</div>
          )}
        </div>
      </Section>

      {/* Activity heatmap + streaks */}
      <Section title="Writing streak">
        {streaks.data ? (
          <div className="insights-streaks">
            <div className="insights-streak-stats">
              <div className="insights-streak-stat">
                <span className="insights-streak-stat__value">{streaks.data.currentStreak}</span>
                <span className="insights-streak-stat__label">Current streak (days)</span>
              </div>
              <div className="insights-streak-stat">
                <span className="insights-streak-stat__value">{streaks.data.longestStreak}</span>
                <span className="insights-streak-stat__label">Longest streak (days)</span>
              </div>
            </div>
            <div className="insights-heatmap">
              <ActivityHeatmap data={streaks.data.heatmap} weeks={26} />
            </div>
          </div>
        ) : streaks.isPending ? (
          <div className="insights-loading">Loading…</div>
        ) : (
          <div className="insights-empty">No streak data yet</div>
        )}
      </Section>

      {/* Stale notes */}
      <Section title="Stale notes">
        {stale.data && stale.data.length > 0 ? (
          <ul className="insights-list">
            {stale.data.map((n) => (
              <li key={n.id} className="insights-list-item">
                <button
                  type="button"
                  className="insights-list-item__link"
                  onClick={() => navigate(`/notes/${n.id}`)}
                >
                  {n.title || 'Untitled'}
                </button>
                <span className="insights-list-item__meta">
                  {n.daysSinceUpdate}d ago
                </span>
              </li>
            ))}
          </ul>
        ) : stale.isPending ? (
          <div className="insights-loading">Loading…</div>
        ) : (
          <div className="insights-empty">No stale notes — great!</div>
        )}
      </Section>

      {/* Suggested links */}
      <Section title="Suggested links">
        {suggested.data && suggested.data.length > 0 ? (
          <ul className="insights-list">
            {suggested.data.map((s) => (
              <li key={s.id} className="insights-list-item">
                <span className="insights-list-item__link">
                  <button type="button" onClick={() => navigate(`/notes/${s.sourceId}`)}>
                    {s.sourceTitle}
                  </button>
                  {' → '}
                  <button type="button" onClick={() => navigate(`/notes/${s.targetId}`)}>
                    {s.targetTitle}
                  </button>
                </span>
                <span className="insights-list-item__meta">
                  score {s.score.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : suggested.isPending ? (
          <div className="insights-loading">Loading…</div>
        ) : (
          <div className="insights-empty">No suggestions right now</div>
        )}
      </Section>

      {/* Reading funnel */}
      <Section title="Reading queue">
        {reading.data && reading.data.length > 0 ? (
          <ul className="insights-list">
            {reading.data.map((n) => (
              <li key={n.id} className="insights-list-item">
                <button
                  type="button"
                  className="insights-list-item__link"
                  onClick={() => navigate(`/notes/${n.id}`)}
                >
                  {n.title || 'Untitled'}
                </button>
                <span className="insights-list-item__meta">
                  {n.wordCount} words · {n.readingMinutes} min
                </span>
              </li>
            ))}
          </ul>
        ) : reading.isPending ? (
          <div className="insights-loading">Loading…</div>
        ) : (
          <div className="insights-empty">Nothing in the reading queue</div>
        )}
      </Section>

      {/* Dead ends */}
      <Section title="Dead-end notes">
        {deadEnds.data && deadEnds.data.length > 0 ? (
          <ul className="insights-list">
            {deadEnds.data.map((n) => (
              <li key={n.id} className="insights-list-item">
                <button
                  type="button"
                  className="insights-list-item__link"
                  onClick={() => navigate(`/notes/${n.id}`)}
                >
                  {n.title || 'Untitled'}
                </button>
              </li>
            ))}
          </ul>
        ) : deadEnds.isPending ? (
          <div className="insights-loading">Loading…</div>
        ) : (
          <div className="insights-empty">No dead-end notes</div>
        )}
      </Section>

      {/* Vault health */}
      <Section title="Vault health">
        {health.data ? (
          <div className="insights-health">
            <div className="insights-health__score" aria-label={`Health score ${health.data.score}`}>
              <Heart size={32} />
              <span className="insights-health__score-value">{health.data.score}</span>
              <span className="insights-health__score-label">/ 100</span>
            </div>
            <ul className="insights-checklist">
              {health.data.checklist.map((item) => (
                <li key={item.id} className={`insights-checklist-item${item.ok ? ' insights-checklist-item--ok' : ''}`}>
                  {item.ok ? (
                    <CircleCheck size={14} className="insights-checklist-item__icon" />
                  ) : (
                    <AlertCircle size={14} className="insights-checklist-item__icon insights-checklist-item__icon--warn" />
                  )}
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : health.isPending ? (
          <div className="insights-loading">Loading…</div>
        ) : (
          <div className="insights-empty">Could not load health score</div>
        )}
      </Section>

      {/* Suggested next action */}
      <Section title="What to do next">
        <div className="insights-next">
          <Lightbulb size={16} />
          <span>
            {overview.data && overview.data.orphans > 0
              ? `You have ${overview.data.orphans} orphan notes — try linking them.`
              : suggested.data && suggested.data.length > 0
                ? 'Accept a suggested link to strengthen your knowledge graph.'
                : 'Your vault looks healthy! Keep writing.'}
          </span>
        </div>
      </Section>
    </div>
  );
}
