/** Shared test harness: providers + a tiny URL-pattern fetch mock. */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@fables/ui';
import { MemoryRouter } from 'react-router-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// vitest runs without injected globals, so testing-library's auto-cleanup
// doesn't register itself; do it here for every suite importing this module.
afterEach(() => cleanup());

// jsdom has no <dialog> methods yet; the ui Dialog needs these.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

export function createWrapper(initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </ToastProvider>
      </MemoryRouter>
    );
  };
}

export interface FetchRoute {
  method?: string;
  /** Substring or regexp matched against the request URL. */
  url: string | RegExp;
  /** Envelope body to return ({ data } / { data, page } / { error }). */
  body: unknown;
  status?: number;
}

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

/** Installs a fetch stub resolving the first matching route; records calls. */
export function mockFetchRoutes(routes: FetchRoute[]): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      let parsedBody: unknown = null;
      if (typeof init?.body === 'string') {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      } else if (init?.body) {
        parsedBody = init.body;
      }
      calls.push({ url, method, body: parsedBody });
      const route = routes.find(
        (r) =>
          (r.method ?? 'GET') === method &&
          (typeof r.url === 'string' ? url.includes(r.url) : r.url.test(url)),
      );
      if (!route) {
        return {
          ok: false,
          status: 404,
          json: () =>
            Promise.resolve({
              error: { code: 'NOT_FOUND', message: `no mock for ${method} ${url}`, details: null },
            }),
        } as Response;
      }
      const status = route.status ?? 200;
      return {
        ok: status < 400,
        status,
        json: () => Promise.resolve(route.body),
        // Raw-text endpoints (e.g. /query/export): string bodies pass through.
        text: () =>
          Promise.resolve(typeof route.body === 'string' ? route.body : JSON.stringify(route.body)),
      } as Response;
    }),
  );
  return { calls };
}

export const emptyPage = { nextCursor: null, limit: 100 };
