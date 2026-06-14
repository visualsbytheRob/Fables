// @vitest-environment jsdom
/**
 * F1285 — Read-receipts preference tests.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readReceiptsEnabled, setReadReceiptsEnabled } from './readReceipts.js';

const KEY = 'fables.readReceipts.enabled';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe('readReceiptsEnabled (F1285)', () => {
  it('defaults to true when nothing is stored', () => {
    expect(readReceiptsEnabled()).toBe(true);
  });

  it('returns true after setReadReceiptsEnabled(true)', () => {
    setReadReceiptsEnabled(true);
    expect(readReceiptsEnabled()).toBe(true);
  });

  it('returns false after setReadReceiptsEnabled(false)', () => {
    setReadReceiptsEnabled(false);
    expect(readReceiptsEnabled()).toBe(false);
  });

  it('persists the value in localStorage', () => {
    setReadReceiptsEnabled(false);
    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('re-reads correctly after a page reload simulation (fresh call)', () => {
    localStorage.setItem(KEY, 'false');
    expect(readReceiptsEnabled()).toBe(false);

    localStorage.setItem(KEY, 'true');
    expect(readReceiptsEnabled()).toBe(true);
  });

  it('defaults to true for unexpected stored values', () => {
    localStorage.setItem(KEY, 'yes'); // not "false"
    expect(readReceiptsEnabled()).toBe(true);
  });
});
