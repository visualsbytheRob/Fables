// @vitest-environment jsdom
/**
 * F972/F975/F976/F979 — Analytics dashboard component tests.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWrapper } from '../test-utils/wrappers.js';
import {
  recordClientError,
  recordFeatureUse,
  recordSlowOp,
  setOptOut,
} from './analyticsStore.js';
import { AnalyticsDashboard } from './AnalyticsDashboard.js';

beforeEach(() => {
  localStorage.clear();
  setOptOut(false);
});
afterEach(() => {
  localStorage.clear();
});

describe('AnalyticsDashboard (F972/F976/F979)', () => {
  it('renders the privacy notice', () => {
    render(<AnalyticsDashboard />, { wrapper: createWrapper() });
    expect(screen.getByText(/Everything stays on your machine/)).toBeDefined();
  });

  it('shows "no usage recorded" empty state when no data', () => {
    render(<AnalyticsDashboard />, { wrapper: createWrapper() });
    expect(screen.getByText('No feature usage recorded yet.')).toBeDefined();
    expect(screen.getByText('No client errors recorded.')).toBeDefined();
    expect(screen.getByText('No slow operations recorded.')).toBeDefined();
  });

  it('shows top features when data is present', () => {
    for (let i = 0; i < 3; i++) recordFeatureUse('notes.create');
    for (let i = 0; i < 7; i++) recordFeatureUse('search');
    render(<AnalyticsDashboard />, { wrapper: createWrapper() });
    expect(screen.getByText('search')).toBeDefined();
    expect(screen.getByText('notes.create')).toBeDefined();
  });

  it('shows client errors with counts', () => {
    recordClientError('TypeError: null');
    recordClientError('TypeError: null');
    recordClientError('RangeError: too big');
    render(<AnalyticsDashboard />, { wrapper: createWrapper() });
    expect(screen.getByText('TypeError: null')).toBeDefined();
    expect(screen.getByText('RangeError: too big')).toBeDefined();
    // Count "2" for TypeError: null
    const cells = screen.getAllByRole('cell');
    const countCells = cells.filter((c) => c.textContent === '2');
    expect(countCells.length).toBeGreaterThan(0);
  });

  it('shows slow ops', () => {
    recordSlowOp('forge.compile', 1200);
    render(<AnalyticsDashboard />, { wrapper: createWrapper() });
    expect(screen.getByText('forge.compile')).toBeDefined();
    expect(screen.getByText('1200 ms')).toBeDefined();
  });

  it('Clear all button wipes data and re-renders empty state', () => {
    recordFeatureUse('x');
    recordClientError('boom');
    render(<AnalyticsDashboard />, { wrapper: createWrapper() });

    const clearBtn = screen.getByLabelText('Clear all analytics data');
    fireEvent.click(clearBtn);

    expect(screen.getByText('No feature usage recorded yet.')).toBeDefined();
    expect(screen.getByText('No client errors recorded.')).toBeDefined();
  });

  it('stack trace expand/collapse toggle works', () => {
    recordClientError('Error: crash', 'at Component.tsx:42');
    render(<AnalyticsDashboard />, { wrapper: createWrapper() });

    const expandBtn = screen.getByLabelText('Expand stack trace');
    expect(screen.queryByText('at Component.tsx:42')).toBeNull();

    fireEvent.click(expandBtn);
    expect(screen.getByText('at Component.tsx:42')).toBeDefined();

    const collapseBtn = screen.getByLabelText('Collapse stack trace');
    fireEvent.click(collapseBtn);
    expect(screen.queryByText('at Component.tsx:42')).toBeNull();
  });
});
