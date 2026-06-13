/**
 * GitHub-style activity heatmap (F794) — pure SVG, no external deps.
 * Renders the last N weeks of activity from heatmap data.
 */
import type { HeatmapDay } from '../api/client.js';

interface ActivityHeatmapProps {
  data: HeatmapDay[];
  weeks?: number;
}

const CELL = 12;
const GAP = 2;
const STEP = CELL + GAP;
const DAYS = 7;
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function levelFor(count: number, max: number): number {
  if (count === 0) return 0;
  const pct = count / Math.max(max, 1);
  if (pct < 0.25) return 1;
  if (pct < 0.5) return 2;
  if (pct < 0.75) return 3;
  return 4;
}

const LEVEL_COLORS = [
  'var(--bg-hover)',
  'color-mix(in srgb, var(--accent) 20%, transparent)',
  'color-mix(in srgb, var(--accent) 45%, transparent)',
  'color-mix(in srgb, var(--accent) 70%, transparent)',
  'var(--accent)',
];

export function ActivityHeatmap({ data, weeks = 26 }: ActivityHeatmapProps) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  // Build a date→count map
  const countMap = new Map<string, number>(data.map((d) => [d.date, d.count]));

  // Generate last `weeks` * 7 days ending today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalDays = weeks * DAYS;
  const days: Array<{ date: string; count: number; dow: number }> = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push({ date: iso, count: countMap.get(iso) ?? 0, dow: d.getDay() });
  }

  const svgWidth = weeks * STEP + 28; // left label space
  const svgHeight = DAYS * STEP + 24; // bottom month labels
  const leftPad = 28;
  const topPad = 4;

  // Month labels
  const monthLabels: Array<{ x: number; label: string }> = [];
  let lastMonth = '';
  days.forEach((d, i) => {
    const col = Math.floor(i / DAYS);
    const month = d.date.slice(0, 7);
    if (month !== lastMonth) {
      monthLabels.push({ x: leftPad + col * STEP, label: d.date.slice(5, 7) });
      lastMonth = month;
    }
  });

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      aria-label="Activity heatmap"
      style={{ overflow: 'visible' }}
    >
      {/* Day-of-week labels */}
      {DAY_LABELS.map((label, dow) =>
        label ? (
          <text
            key={dow}
            x={leftPad - 4}
            y={topPad + dow * STEP + CELL - 1}
            textAnchor="end"
            fill="var(--text-dim)"
            fontSize="10"
          >
            {label}
          </text>
        ) : null,
      )}

      {/* Cells */}
      {days.map((d, i) => {
        const col = Math.floor(i / DAYS);
        const row = i % DAYS;
        const x = leftPad + col * STEP;
        const y = topPad + row * STEP;
        const level = levelFor(d.count, maxCount);
        return (
          <rect
            key={d.date}
            x={x}
            y={y}
            width={CELL}
            height={CELL}
            rx={2}
            fill={LEVEL_COLORS[level]}
            aria-label={`${d.date}: ${d.count} activities`}
          >
            <title>
              {d.date}: {d.count}
            </title>
          </rect>
        );
      })}

      {/* Month labels */}
      {monthLabels.map(({ x, label }) => (
        <text
          key={`${x}-${label}`}
          x={x}
          y={svgHeight - 4}
          fill="var(--text-dim)"
          fontSize="10"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}
