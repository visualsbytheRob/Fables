// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { installCodeMirrorDomStubs } from './test-utils/cm-dom.js';
import { App } from './App.js';

installCodeMirrorDomStubs();

describe('app shell', () => {
  it('renders navigation and the home page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { status: 'ok', version: '0.1.0', uptimeSeconds: 1, db: 'ok' },
          }),
      }),
    );

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('Fables')).toBeDefined();
    expect(screen.getByText('Stories')).toBeDefined();
    await waitFor(() => expect(screen.getByText(/Connected to Fables v0\.1\.0/)).toBeDefined());
    // the lazily-loaded notes editor demo (Day 2) mounts on the home route
    await waitFor(() => {
      expect(document.querySelector('.cm-editor')).not.toBeNull();
      expect(screen.getAllByText(/The Fox and the Compiler/).length).toBeGreaterThan(0);
    });
    vi.unstubAllGlobals();
  });
});
