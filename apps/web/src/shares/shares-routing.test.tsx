// @vitest-environment jsdom
/**
 * Route wiring tests for the share-management UIs (F1144, F1147).
 *
 * Verifies that:
 *   - /shares renders the ShareManagementPanel (heading "Shares")
 *   - /shared-with-me renders the SharedWithMeView (heading "Shared with me")
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as hooksModule from '../api/hooks.js';
import { App } from '../App.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal fetch stub that satisfies all the VaultGate / shell queries. */
function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // Vault unlock check
      if (url.includes('/vault/status'))
        return { ok: true, status: 200, json: async () => ({ data: { locked: false } }) };
      // Notebooks tree (sidebar)
      if (url.includes('/notebooks/tree'))
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      // Notes list
      if (url.includes('/notes'))
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [], page: { nextCursor: null, limit: 100 } }),
        };
      if (url.includes('/tags')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      if (url.includes('/attachments'))
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [], page: { nextCursor: null, limit: 100 } }),
        };
      // Shares
      if (url.includes('/shares'))
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      if (url.includes('/shared-with-me'))
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'NOT_FOUND', message: `no mock for ${url}` } }),
      };
    }),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('share routes wiring (F1144, F1147)', () => {
  it('/shares route renders the SharesPage with Share Management heading', async () => {
    stubFetch();

    // Mock the hooks so we don't depend on real fetch routing in tanstack-query
    vi.spyOn(hooksModule, 'useShares').mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useShares>);

    render(
      <MemoryRouter initialEntries={['/shares']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'Share Management' })).toBeDefined();
      },
      { timeout: 8000 },
    );
  });

  it('/shares route renders the inner Shares heading from ShareManagementPanel', async () => {
    stubFetch();

    vi.spyOn(hooksModule, 'useShares').mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useShares>);

    render(
      <MemoryRouter initialEntries={['/shares']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'Shares' })).toBeDefined();
      },
      { timeout: 8000 },
    );
  });

  it('/shared-with-me route renders the SharedWithMePage', async () => {
    stubFetch();

    vi.spyOn(hooksModule, 'useSharedWithMe').mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useSharedWithMe>);

    render(
      <MemoryRouter initialEntries={['/shared-with-me']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'Shared with Me' })).toBeDefined();
      },
      { timeout: 8000 },
    );
  });

  it('/shared-with-me route renders the inner "Shared with me" heading from SharedWithMeView', async () => {
    stubFetch();

    vi.spyOn(hooksModule, 'useSharedWithMe').mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useSharedWithMe>);

    render(
      <MemoryRouter initialEntries={['/shared-with-me']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'Shared with me' })).toBeDefined();
      },
      { timeout: 8000 },
    );
  });

  it('sidebar contains a "Shares" nav link', async () => {
    stubFetch();

    vi.spyOn(hooksModule, 'useShares').mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useShares>);

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    // The sidebar renders immediately (not lazy-loaded)
    await waitFor(
      () => {
        const sharesLink = screen.getByRole('link', { name: /shares/i });
        expect(sharesLink).toBeDefined();
      },
      { timeout: 8000 },
    );
  });
});
