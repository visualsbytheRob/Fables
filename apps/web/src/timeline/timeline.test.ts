/**
 * Unit tests for the pure timeline helpers (F653, F654, F658). DOM-free: these
 * exercise bucketing, heading formatting, click-through resolution, and filtering.
 */
import { describe, it, expect } from 'vitest';
import type { TimelineGroup, TimelineRow, TimelineType } from './api.js';
import {
  bucketKey,
  filterByTypes,
  formatClock,
  formatDayHeading,
  isoWeek,
  rebucket,
  rowHref,
  type Zoom,
} from './grouping.js';

function row(over: Partial<TimelineRow> & Pick<TimelineRow, 'id' | 'type' | 'at'>): TimelineRow {
  return {
    event: 'created',
    title: 'Untitled',
    refId: over.id,
    meta: {},
    ...over,
  };
}

const group = (dayKey: string, events: TimelineRow[]): TimelineGroup => ({ dayKey, events });

describe('bucketKey', () => {
  const d = new Date(2026, 5, 13, 14, 30); // Sat 13 Jun 2026, local

  it('formats day buckets as YYYY-MM-DD', () => {
    expect(bucketKey(d, 'day')).toBe('2026-06-13');
  });
  it('formats month buckets as YYYY-MM', () => {
    expect(bucketKey(d, 'month')).toBe('2026-06');
  });
  it('formats year buckets as YYYY', () => {
    expect(bucketKey(d, 'year')).toBe('2026');
  });
  it('formats week buckets as YYYY-Www', () => {
    expect(bucketKey(d, 'week')).toMatch(/^\d{4}-W\d{2}$/);
  });
});

describe('isoWeek', () => {
  it('puts 2026-06-13 in ISO week 24', () => {
    expect(isoWeek(new Date(Date.UTC(2026, 5, 13)))).toEqual({ year: 2026, week: 24 });
  });
  it('rolls 2027-01-01 into ISO week 53 of 2026', () => {
    expect(isoWeek(new Date(Date.UTC(2027, 0, 1)))).toEqual({ year: 2026, week: 53 });
  });
});

describe('formatDayHeading', () => {
  it('renders a day key as weekday d mon yyyy', () => {
    expect(formatDayHeading('2026-06-13')).toBe('Sat 13 Jun 2026');
  });
  it('renders a month key as long month + year', () => {
    expect(formatDayHeading('2026-06')).toBe('June 2026');
  });
  it('renders a year key verbatim', () => {
    expect(formatDayHeading('2026')).toBe('2026');
  });
  it('renders a week key as Week n · year', () => {
    expect(formatDayHeading('2026-W24')).toBe('Week 24 · 2026');
  });
});

describe('rowHref', () => {
  it('links notes to /notes/:refId', () => {
    expect(rowHref(row({ id: 'a', type: 'notes', at: '2026-06-13T10:00:00Z', refId: 'n1' }))).toBe(
      '/notes/n1',
    );
  });
  it('links stories to /stories/:refId', () => {
    expect(rowHref(row({ id: 'b', type: 'stories', at: '2026-06-13T10:00:00Z', refId: 's1' }))).toBe(
      '/stories/s1',
    );
  });
  it('links playthroughs to /stories/:storyId/play using meta.storyId', () => {
    expect(
      rowHref(
        row({
          id: 'c',
          type: 'playthroughs',
          at: '2026-06-13T10:00:00Z',
          refId: 'pt1',
          meta: { storyId: 's9' },
        }),
      ),
    ).toBe('/stories/s9/play');
  });
  it('falls back to refId for playthroughs without meta.storyId', () => {
    expect(
      rowHref(row({ id: 'd', type: 'playthroughs', at: '2026-06-13T10:00:00Z', refId: 's2' })),
    ).toBe('/stories/s2/play');
  });
});

describe('rebucket', () => {
  const groups: TimelineGroup[] = [
    group('2026-06-13', [
      row({ id: '1', type: 'notes', at: '2026-06-13T09:00:00Z' }),
      row({ id: '2', type: 'stories', at: '2026-06-13T18:00:00Z' }),
    ]),
    group('2026-06-12', [row({ id: '3', type: 'notes', at: '2026-06-12T12:00:00Z' })]),
    group('2026-05-30', [row({ id: '4', type: 'notes', at: '2026-05-30T12:00:00Z' })]),
  ];

  it('keeps per-day buckets at day zoom, newest-first', () => {
    const out = rebucket(groups, 'day');
    expect(out.map((g) => g.dayKey)).toEqual(['2026-06-13', '2026-06-12', '2026-05-30']);
    // within-day rows sorted newest-first
    expect(out[0]?.events.map((e) => e.id)).toEqual(['2', '1']);
  });

  it('collapses everything into one month bucket at month zoom', () => {
    const out = rebucket(groups, 'month');
    const june = out.find((g) => g.dayKey === '2026-06');
    expect(june?.events).toHaveLength(3);
    expect(out.map((g) => g.dayKey)).toEqual(['2026-06', '2026-05']);
  });

  it('collapses everything into a single year bucket at year zoom', () => {
    const out = rebucket(groups, 'year');
    expect(out).toHaveLength(1);
    expect(out[0]?.dayKey).toBe('2026');
    expect(out[0]?.events).toHaveLength(4);
  });
});

describe('filterByTypes', () => {
  const groups: TimelineGroup[] = [
    group('2026-06-13', [
      row({ id: '1', type: 'notes', at: '2026-06-13T09:00:00Z' }),
      row({ id: '2', type: 'stories', at: '2026-06-13T18:00:00Z' }),
      row({ id: '3', type: 'playthroughs', at: '2026-06-13T20:00:00Z' }),
    ]),
  ];

  it('keeps only the active types', () => {
    const active: TimelineType[] = ['notes'];
    const out = filterByTypes(groups, active);
    expect(out[0]?.events.map((e) => e.id)).toEqual(['1']);
  });

  it('drops groups that become empty', () => {
    const out = filterByTypes(groups, []);
    expect(out).toHaveLength(0);
  });
});

describe('formatClock', () => {
  it('returns a HH:MM clock label', () => {
    expect(formatClock(new Date(2026, 5, 13, 7, 5).toISOString())).toMatch(/^\d{2}:\d{2}$/);
  });
  it('returns empty string for an unparseable timestamp', () => {
    expect(formatClock('not-a-date')).toBe('');
  });
});

// Type-level sanity: Zoom union is exhaustively used above.
const _zooms: Zoom[] = ['day', 'week', 'month', 'year'];
void _zooms;
