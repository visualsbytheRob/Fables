// @vitest-environment jsdom
/**
 * F1264 — useSecretVisibilityWarning tests.
 *
 * We fake visibilityState and dispatch visibilitychange events to drive the
 * hook, which is exercised via renderHook.
 */
import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSecretVisibilityWarning } from './useSecretVisibilityWarning.js';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    writable: true,
    configurable: true,
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

afterEach(() => {
  // Reset to visible after each test
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    writable: true,
    configurable: true,
  });
  vi.restoreAllMocks();
});

describe('useSecretVisibilityWarning (F1264)', () => {
  it('does NOT fire onReappear when page merely becomes visible from initial state', () => {
    const onReappear = vi.fn();
    renderHook(() => useSecretVisibilityWarning({ onReappear }));

    // Becoming visible without first being hidden should not fire
    setVisibility('visible');
    expect(onReappear).not.toHaveBeenCalled();
  });

  it('fires onReappear after page goes hidden then visible', () => {
    const onReappear = vi.fn();
    renderHook(() => useSecretVisibilityWarning({ onReappear }));

    setVisibility('hidden');
    expect(onReappear).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(onReappear).toHaveBeenCalledTimes(1);
  });

  it('fires each time the page re-appears (multiple cycles)', () => {
    const onReappear = vi.fn();
    renderHook(() => useSecretVisibilityWarning({ onReappear }));

    setVisibility('hidden');
    setVisibility('visible');
    setVisibility('hidden');
    setVisibility('visible');
    expect(onReappear).toHaveBeenCalledTimes(2);
  });

  it('does NOT fire when enabled=false', () => {
    const onReappear = vi.fn();
    renderHook(() => useSecretVisibilityWarning({ onReappear, enabled: false }));

    setVisibility('hidden');
    setVisibility('visible');
    expect(onReappear).not.toHaveBeenCalled();
  });

  it('removes the listener on unmount', () => {
    const onReappear = vi.fn();
    const { unmount } = renderHook(() => useSecretVisibilityWarning({ onReappear }));

    unmount();

    // After unmount, visibility changes should not trigger callback
    setVisibility('hidden');
    setVisibility('visible');
    expect(onReappear).not.toHaveBeenCalled();
  });
});
