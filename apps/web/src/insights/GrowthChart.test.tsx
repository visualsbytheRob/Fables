// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createWrapper } from '../test-utils/wrappers.js';
import { GrowthChart } from './GrowthChart.js';
import type { GrowthDay } from '../api/client.js';

const data: GrowthDay[] = [
  { date: '2026-06-01', notes: 2, links: 5, words: 400 },
  { date: '2026-06-02', notes: 3, links: 7, words: 600 },
  { date: '2026-06-03', notes: 1, links: 4, words: 200 },
];

describe('GrowthChart (F793)', () => {
  it('renders an SVG', () => {
    render(<GrowthChart data={data} field="notes" />, { wrapper: createWrapper() });
    const svg = document.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders a "not enough data" message with fewer than 2 data points', () => {
    render(<GrowthChart data={[data[0]!]} field="notes" />, { wrapper: createWrapper() });
    expect(screen.getByText('Not enough data')).toBeDefined();
  });

  it('renders a path element for the line', () => {
    render(<GrowthChart data={data} field="notes" />, { wrapper: createWrapper() });
    const paths = document.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('includes an aria-label', () => {
    render(<GrowthChart data={data} field="words" />, { wrapper: createWrapper() });
    const svg = document.querySelector('svg[aria-label]');
    expect(svg?.getAttribute('aria-label')).toContain('words');
  });
});
