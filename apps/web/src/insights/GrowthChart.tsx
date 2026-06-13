/**
 * Pure SVG line chart for the growth data (F793).
 * No external chart library — just SVG paths.
 */
import type { GrowthDay } from '../api/client.js';

interface GrowthChartProps {
  data: GrowthDay[];
  field: 'notes' | 'words' | 'links';
  width?: number;
  height?: number;
}

export function GrowthChart({ data, field, width = 400, height = 120 }: GrowthChartProps) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} aria-label="Growth chart (no data)">
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="var(--text-dim)" fontSize="13">
          Not enough data
        </text>
      </svg>
    );
  }

  const pad = { t: 10, r: 10, b: 24, l: 36 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const values = data.map((d) => d[field]);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const rangeV = maxV - minV || 1;

  const xScale = (i: number) => pad.l + (i / (data.length - 1)) * innerW;
  const yScale = (v: number) => pad.t + innerH - ((v - minV) / rangeV) * innerH;

  const points = data.map((d, i) => ({ x: xScale(i), y: yScale(d[field]) }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  // Fill path below the line
  const fillD = `${pathD} L${points[points.length - 1]!.x.toFixed(1)},${(pad.t + innerH).toFixed(1)} L${pad.l.toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`;

  // X-axis labels: first, mid, last
  const xLabels = [0, Math.floor(data.length / 2), data.length - 1].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={`Growth chart: ${field}`}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`fill-${field}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Fill */}
      <path d={fillD} fill={`url(#fill-${field})`} />

      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* X labels */}
      {xLabels.map((i) => (
        <text
          key={i}
          x={xScale(i)}
          y={height - 4}
          textAnchor="middle"
          fill="var(--text-dim)"
          fontSize="11"
        >
          {data[i]?.date.slice(5) ?? ''}
        </text>
      ))}

      {/* Y labels */}
      {[minV, maxV].map((v, i) => (
        <text
          key={i}
          x={pad.l - 4}
          y={yScale(v) + 4}
          textAnchor="end"
          fill="var(--text-dim)"
          fontSize="11"
        >
          {v}
        </text>
      ))}
    </svg>
  );
}
