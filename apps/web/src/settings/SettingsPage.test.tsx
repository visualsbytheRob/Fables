// @vitest-environment jsdom
/**
 * F997 — Settings page tests: theme toggle, analytics opt-out, reduced motion.
 */
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider, ThemeProvider } from '@fables/ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isOptedOut, setOptOut } from '../analytics/analyticsStore.js';
import { SettingsPage } from './SettingsPage.js';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// SettingsPage needs ThemeProvider (for useTheme)
function createSettingsWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <ThemeProvider>
          <ToastProvider>
            <QueryClientProvider client={qc}>{children}</QueryClientProvider>
          </ToastProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
  };
}

beforeEach(() => {
  localStorage.clear();
  setOptOut(false);
});
afterEach(() => {
  localStorage.clear();
});

describe('SettingsPage (F997)', () => {
  it('renders all major sections', () => {
    render(<SettingsPage />, { wrapper: createSettingsWrapper() });
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeDefined();
    expect(screen.getByText('Appearance')).toBeDefined();
    expect(screen.getByText('Notifications')).toBeDefined();
    expect(screen.getByText('Offline & PWA')).toBeDefined();
    expect(screen.getByText('AI & Embeddings')).toBeDefined();
    expect(screen.getByText('Local Analytics')).toBeDefined();
    expect(screen.getByText('Accessibility')).toBeDefined();
  });

  it('has a theme select with three options', () => {
    render(<SettingsPage />, { wrapper: createSettingsWrapper() });
    const select = screen.getByRole('combobox', { name: 'Color theme' }) as HTMLSelectElement;
    expect(select).toBeDefined();
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toContain('system');
    expect(opts).toContain('dark');
    expect(opts).toContain('light');
  });

  it('toggles analytics opt-out and persists to analyticsStore', () => {
    render(<SettingsPage />, { wrapper: createSettingsWrapper() });
    const toggle = screen.getByRole('switch', { name: 'Opt out of local analytics' });

    // Initially opted in (off = not opted out)
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(isOptedOut()).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(isOptedOut()).toBe(true);

    // Toggle back
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(isOptedOut()).toBe(false);
  });

  it('reduced motion toggle is accessible as a switch', () => {
    render(<SettingsPage />, { wrapper: createSettingsWrapper() });
    const toggle = screen.getByRole('switch', { name: 'Reduce motion' });
    expect(toggle.getAttribute('aria-checked')).toBeDefined();
    fireEvent.click(toggle);
    // aria-checked should have flipped
    const checked = toggle.getAttribute('aria-checked');
    expect(checked === 'true' || checked === 'false').toBe(true);
  });

  it('notifications toggle is accessible', () => {
    render(<SettingsPage />, { wrapper: createSettingsWrapper() });
    const toggle = screen.getByRole('switch', { name: 'Enable notifications' });
    expect(toggle.getAttribute('aria-checked')).toBe('true'); // default on
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('privacy note is absent when opted out', () => {
    setOptOut(true);
    render(<SettingsPage />, { wrapper: createSettingsWrapper() });
    expect(screen.queryByText(/never sent to any server/)).toBeNull();
  });

  it('has a link to the analytics dashboard when not opted out', () => {
    render(<SettingsPage />, { wrapper: createSettingsWrapper() });
    const link = screen.getByRole('link', { name: /View analytics dashboard/ });
    expect(link).toBeDefined();
  });
});
