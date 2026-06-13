// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createWrapper } from '../test-utils/wrappers.js';
import { ActivityHeatmap } from './ActivityHeatmap.js';
import type { HeatmapDay } from '../api/client.js';

const today = new Date();
const makeDay = (daysAgo: number, count: number): HeatmapDay => {
  const d = new Date(today);
  d.setDate(today.getDate() - daysAgo);
  return { date: d.toISOString().slice(0, 10), count };
};

describe('ActivityHeatmap (F794)', () => {
  it('renders an SVG', () => {
    const data = [makeDay(0, 3), makeDay(1, 0), makeDay(2, 5)];
    render(<ActivityHeatmap data={data} weeks={4} />, { wrapper: createWrapper() });
    const svg = document.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders the correct number of cells (weeks * 7)', () => {
    const data: HeatmapDay[] = [];
    render(<ActivityHeatmap data={data} weeks={4} />, { wrapper: createWrapper() });
    const rects = document.querySelectorAll('rect');
    expect(rects.length).toBe(4 * 7);
  });

  it('has aria-label on SVG', () => {
    render(<ActivityHeatmap data={[]} weeks={2} />, { wrapper: createWrapper() });
    const svg = document.querySelector('svg[aria-label]');
    expect(svg?.getAttribute('aria-label')).toBe('Activity heatmap');
  });

  it('renders day-of-week labels', () => {
    render(<ActivityHeatmap data={[]} weeks={2} />, { wrapper: createWrapper() });
    const texts = document.querySelectorAll('text');
    const labels = Array.from(texts).map((t) => t.textContent);
    expect(labels).toContain('Mon');
    expect(labels).toContain('Wed');
    expect(labels).toContain('Fri');
  });
});
