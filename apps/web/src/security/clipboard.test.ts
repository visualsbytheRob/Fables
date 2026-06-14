// @vitest-environment jsdom
/**
 * F1263 — Clipboard hygiene tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyWithAutoClear, isClearPending } from './clipboard.js';

// ─── Mock clipboard API ───────────────────────────────────────────────────────

function makeClipboard() {
  let contents = '';
  return {
    writeText: vi.fn(async (text: string) => {
      contents = text;
    }),
    get contents() {
      return contents;
    },
  };
}

describe('copyWithAutoClear (F1263)', () => {
  let clipboard: ReturnType<typeof makeClipboard>;

  beforeEach(() => {
    clipboard = makeClipboard();
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboard,
      writable: true,
      configurable: true,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes the text to clipboard immediately', async () => {
    const result = await copyWithAutoClear('my-secret-code', { clearAfterMs: 5_000 });
    expect(clipboard.writeText).toHaveBeenCalledWith('my-secret-code');
    result.cancel();
  });

  it('clears clipboard after the specified timeout', async () => {
    const onCleared = vi.fn();
    const result = await copyWithAutoClear('secret', { clearAfterMs: 5_000, onCleared });

    // Not cleared yet
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
    expect(clipboard.writeText).toHaveBeenLastCalledWith('');
    expect(onCleared).toHaveBeenCalledTimes(1);
    result.cancel(); // no-op after fire
  });

  it('does not clear if cancel() is called before timeout', async () => {
    const onCleared = vi.fn();
    const result = await copyWithAutoClear('secret', { clearAfterMs: 5_000, onCleared });

    result.cancel();
    await vi.advanceTimersByTimeAsync(10_000);

    // writeText called only once (the initial copy)
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('defaults to 30 s clear timeout', async () => {
    const onCleared = vi.fn();
    const result = await copyWithAutoClear('secret', { onCleared });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(onCleared).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onCleared).toHaveBeenCalledTimes(1);
    result.cancel();
  });

  it('degrades gracefully when clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    // Should not throw
    const result = await copyWithAutoClear('secret');
    expect(result.cancel).toBeTypeOf('function');
    result.cancel();
  });
});

describe('isClearPending (F1263)', () => {
  it('returns true when result is non-null', async () => {
    // Just test the helper directly without clipboard interaction
    const fakeResult = { cancel: vi.fn() };
    expect(isClearPending(fakeResult)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isClearPending(null)).toBe(false);
  });
});
