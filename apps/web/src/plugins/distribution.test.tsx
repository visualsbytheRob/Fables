// @vitest-environment jsdom
/**
 * F1091 — Install from file
 * F1092 — Install from URL (+ untrusted-host confirmation)
 * F1093 — Update detection badge
 * F1094 — Compat report + confirm update flow
 * F1096 — Catalog browser with one-click install
 * F1097 — Export plugin
 * F1098 — Uninstall with data-cleanup choice
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@fables/ui';
import { mockFetchRoutes } from '../test-utils/wrappers.js';
import { PluginInstallPage } from './PluginInstallPage.js';
import { PluginsPage } from './PluginsPage.js';
import type { PluginRecord } from './types.js';

// ─── jsdom dialog shim ───────────────────────────────────────────────────────

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const basePlugin: PluginRecord = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  description: 'A test plugin',
  enabled: true,
  status: 'active',
  permissions: [],
  contributes: {},
};

const catalogEntry = {
  id: 'cat-plugin',
  name: 'Catalog Plugin',
  version: '2.0.0',
  description: 'From the catalog',
  source: 'https://registry.fables.app/cat-plugin.fplugin',
};

// ─── Wrapper factory ──────────────────────────────────────────────────────────

function makeWrapper(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialPath]}>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </ToastProvider>
      </MemoryRouter>
    );
  };
}

function renderInstallPage(extraRoutes: Parameters<typeof mockFetchRoutes>[0] = []) {
  const mocked = mockFetchRoutes(extraRoutes);
  const utils = render(
    <Routes>
      <Route path="/plugins/install" element={<PluginInstallPage />} />
      <Route path="/plugins" element={<div data-testid="plugins-page">Plugins</div>} />
    </Routes>,
    { wrapper: makeWrapper('/plugins/install') },
  );
  return { ...utils, calls: mocked };
}

function renderPluginsPage(
  plugins: PluginRecord[],
  extraRoutes: Parameters<typeof mockFetchRoutes>[0] = [],
) {
  // Extra routes go FIRST so specific paths (e.g. /my-plugin/update-check) are
  // matched before the generic /api/v1/plugins list route.
  const mocked = mockFetchRoutes([
    ...extraRoutes,
    { url: /\/api\/v1\/plugins$/, body: { data: plugins } },
  ]);
  const utils = render(
    <Routes>
      <Route path="/plugins" element={<PluginsPage />} />
      <Route path="/plugins/install" element={<div data-testid="install-page">Install</div>} />
      <Route path="/plugins/:pluginId" element={<div data-testid="detail-page">Detail</div>} />
    </Routes>,
    { wrapper: makeWrapper('/plugins') },
  );
  return { ...utils, calls: mocked };
}

// ─── F1091: Install from file ────────────────────────────────────────────────

describe('F1091 — install from file', () => {
  it('shows file tab by default with file input', () => {
    renderInstallPage();
    expect(screen.getByRole('tab', { name: 'From file' })).toBeDefined();
    expect(screen.getByTestId('file-input')).toBeDefined();
  });

  it('install button disabled with no file selected', () => {
    renderInstallPage();
    const btn = screen.getByLabelText('Install selected plugin file') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables install button after selecting a file', async () => {
    renderInstallPage();
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'my-plugin.fplugin', { type: 'application/octet-stream' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      const btn = screen.getByLabelText('Install selected plugin file') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it('sends multipart POST to install-archive', async () => {
    const { calls } = renderInstallPage([
      {
        method: 'POST',
        url: '/api/v1/plugins/install-archive',
        body: { data: { id: 'new-plugin', installed: true } },
      },
    ]);

    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'my-plugin.fplugin', { type: 'application/octet-stream' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => {
      const btn = screen.getByLabelText('Install selected plugin file') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    fireEvent.click(screen.getByLabelText('Install selected plugin file'));

    await waitFor(() => {
      expect(
        calls.calls.some((c) => c.url.includes('install-archive') && c.method === 'POST'),
      ).toBe(true);
    });
  });
});

// ─── F1092: Install from URL ──────────────────────────────────────────────────

describe('F1092 — install from URL', () => {
  it('switches to URL tab showing url + checksum inputs', () => {
    renderInstallPage();
    fireEvent.click(screen.getByRole('tab', { name: 'From URL' }));
    expect(screen.getByLabelText('Plugin URL')).toBeDefined();
    expect(screen.getByLabelText('Checksum (optional)')).toBeDefined();
  });

  it('install from URL POSTs to install-url', async () => {
    const { calls } = renderInstallPage([
      {
        method: 'POST',
        url: '/api/v1/plugins/install-url',
        body: { data: { id: 'url-plugin', installed: true } },
      },
    ]);

    fireEvent.click(screen.getByRole('tab', { name: 'From URL' }));
    fireEvent.change(screen.getByLabelText('Plugin URL'), {
      target: { value: 'https://example.com/plugin.fplugin' },
    });
    fireEvent.click(screen.getByLabelText('Install plugin from URL'));

    await waitFor(() => {
      expect(calls.calls.some((c) => c.url.includes('install-url') && c.method === 'POST')).toBe(
        true,
      );
    });
  });

  it('shows untrusted-host dialog when server flags it', async () => {
    renderInstallPage([
      {
        method: 'POST',
        url: '/api/v1/plugins/install-url',
        body: { data: { id: 'unsafe-plugin', installed: true, untrustedHost: true } },
      },
    ]);

    fireEvent.click(screen.getByRole('tab', { name: 'From URL' }));
    fireEvent.change(screen.getByLabelText('Plugin URL'), {
      target: { value: 'https://sketchy.example.com/plugin.fplugin' },
    });
    fireEvent.click(screen.getByLabelText('Install plugin from URL'));

    await waitFor(() => {
      expect(screen.getByText('Untrusted source')).toBeDefined();
    });
  });

  it('includes checksum in request body when provided', async () => {
    const { calls } = renderInstallPage([
      {
        method: 'POST',
        url: '/api/v1/plugins/install-url',
        body: { data: { id: 'ok-plugin', installed: true } },
      },
    ]);

    fireEvent.click(screen.getByRole('tab', { name: 'From URL' }));
    fireEvent.change(screen.getByLabelText('Plugin URL'), {
      target: { value: 'https://trusted.example.com/plugin.fplugin' },
    });
    fireEvent.change(screen.getByLabelText('Checksum (optional)'), {
      target: { value: 'abc123' },
    });
    fireEvent.click(screen.getByLabelText('Install plugin from URL'));

    await waitFor(() => {
      const installCall = calls.calls.find((c) => c.url.includes('install-url'));
      expect(installCall).toBeDefined();
      expect((installCall?.body as Record<string, unknown>)?.checksum).toBe('abc123');
    });
  });
});

// ─── F1096: Catalog browser ───────────────────────────────────────────────────

describe('F1096 — catalog browser', () => {
  it('loads and renders catalog entries', async () => {
    renderInstallPage([
      { url: '/api/v1/plugins/catalog', body: { data: [catalogEntry] } },
    ]);

    fireEvent.click(screen.getByRole('tab', { name: 'Catalog' }));

    await waitFor(() => {
      expect(screen.getByText('Catalog Plugin')).toBeDefined();
      expect(screen.getByText('From the catalog')).toBeDefined();
    });
  });

  it('one-click install calls install-url with the catalog source URL', async () => {
    const { calls } = renderInstallPage([
      { url: '/api/v1/plugins/catalog', body: { data: [catalogEntry] } },
      {
        method: 'POST',
        url: '/api/v1/plugins/install-url',
        body: { data: { id: 'cat-plugin', installed: true } },
      },
    ]);

    fireEvent.click(screen.getByRole('tab', { name: 'Catalog' }));
    await waitFor(() => screen.getByText('Catalog Plugin'));

    fireEvent.click(screen.getByLabelText('Install Catalog Plugin from catalog'));

    await waitFor(() => {
      const installCall = calls.calls.find((c) => c.url.includes('install-url'));
      expect(installCall).toBeDefined();
      expect((installCall?.body as Record<string, unknown>)?.url).toBe(catalogEntry.source);
    });
  });

  it('shows empty state when catalog is empty', async () => {
    renderInstallPage([
      { url: '/api/v1/plugins/catalog', body: { data: [] } },
    ]);

    fireEvent.click(screen.getByRole('tab', { name: 'Catalog' }));

    await waitFor(() => {
      expect(screen.getByText('No plugins in the catalog yet.')).toBeDefined();
    });
  });

  it('shows error when catalog fails to load', async () => {
    renderInstallPage([
      { url: '/api/v1/plugins/catalog', body: { error: { code: 'SERVER_ERROR', message: 'oops', details: null } }, status: 500 },
    ]);

    fireEvent.click(screen.getByRole('tab', { name: 'Catalog' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });
});

// ─── F1093/F1094: Update detection + compat + confirm ─────────────────────────

describe('F1093/F1094 — update detection and compat report', () => {
  it('shows update badge when update is available', async () => {
    renderPluginsPage([basePlugin], [
      {
        url: `/api/v1/plugins/${basePlugin.id}/update-check`,
        body: { data: { current: '1.0.0', available: '2.0.0', hasUpdate: true } },
      },
    ]);

    await waitFor(() => {
      const badge = screen.queryByLabelText('Update available: v2.0.0');
      expect(badge).not.toBeNull();
    });
  });

  it('clicking update badge fetches compat report and opens dialog', async () => {
    renderPluginsPage([basePlugin], [
      {
        url: `/api/v1/plugins/${basePlugin.id}/update-check`,
        body: { data: { current: '1.0.0', available: '2.0.0', hasUpdate: true } },
      },
      {
        url: `/api/v1/plugins/${basePlugin.id}/compat`,
        body: { data: { addedPermissions: ['network'], breaking: [] } },
      },
    ]);

    await waitFor(() => {
      expect(screen.queryByLabelText('Update available: v2.0.0')).not.toBeNull();
    });
    fireEvent.click(screen.getByLabelText('Update available: v2.0.0'));

    await waitFor(() => {
      expect(screen.getByText(/Update My Plugin to v2\.0\.0/)).toBeDefined();
    });
  });

  it('compat report dialog shows added permissions and breaking changes', async () => {
    renderPluginsPage([basePlugin], [
      {
        url: `/api/v1/plugins/${basePlugin.id}/update-check`,
        body: { data: { current: '1.0.0', available: '2.0.0', hasUpdate: true } },
      },
      {
        url: `/api/v1/plugins/${basePlugin.id}/compat`,
        body: { data: { addedPermissions: ['network', 'clipboard'], breaking: ['removed api'] } },
      },
    ]);

    await waitFor(() => {
      expect(screen.queryByLabelText('Update available: v2.0.0')).not.toBeNull();
    });
    fireEvent.click(screen.getByLabelText('Update available: v2.0.0'));

    await waitFor(() => {
      expect(screen.getByText('New permissions requested')).toBeDefined();
      expect(screen.getByText('network')).toBeDefined();
      expect(screen.getByText('Breaking changes')).toBeDefined();
      expect(screen.getByText('removed api')).toBeDefined();
    });
  });

  it('confirming update POSTs to /update endpoint', async () => {
    const { calls } = renderPluginsPage([basePlugin], [
      {
        url: `/api/v1/plugins/${basePlugin.id}/update-check`,
        body: { data: { current: '1.0.0', available: '2.0.0', hasUpdate: true } },
      },
      {
        url: `/api/v1/plugins/${basePlugin.id}/compat`,
        body: { data: { addedPermissions: [], breaking: [] } },
      },
      {
        method: 'POST',
        url: `/api/v1/plugins/${basePlugin.id}/update`,
        body: { data: { id: basePlugin.id, version: '2.0.0' } },
      },
    ]);

    await waitFor(() => {
      expect(screen.queryByLabelText('Update available: v2.0.0')).not.toBeNull();
    });
    fireEvent.click(screen.getByLabelText('Update available: v2.0.0'));

    await waitFor(() => {
      expect(screen.queryByLabelText('Confirm plugin update')).not.toBeNull();
    });
    fireEvent.click(screen.getByLabelText('Confirm plugin update'));

    await waitFor(() => {
      expect(
        calls.calls.some(
          (c) => c.url.includes(`${basePlugin.id}/update`) && c.method === 'POST',
        ),
      ).toBe(true);
    });
  });
});

// ─── F1097: Export plugin ─────────────────────────────────────────────────────

describe('F1097 — export plugin', () => {
  it('export button is present for each plugin', async () => {
    renderPluginsPage([basePlugin]);
    await waitFor(() => screen.getByText('My Plugin'));
    expect(screen.getByLabelText(`Export ${basePlugin.name}`)).toBeDefined();
  });

  it('export button triggers a blob download', async () => {
    const revokeUrl = vi.fn();
    const clickFn = vi.fn();

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: revokeUrl,
    });

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const a = origCreate('a');
        a.click = clickFn;
        return a;
      }
      return origCreate(tag);
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/export')) {
          return {
            ok: true,
            status: 200,
            blob: () => Promise.resolve(new Blob(['plugin data'])),
            json: () => Promise.resolve({}),
            text: () => Promise.resolve(''),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [basePlugin] }),
          text: () => Promise.resolve(''),
        } as Response;
      }),
    );

    const { wrapper } = { wrapper: makeWrapper('/plugins') };
    render(
      <Routes>
        <Route path="/plugins" element={<PluginsPage />} />
      </Routes>,
      { wrapper },
    );

    await waitFor(() => screen.getByText('My Plugin'));
    fireEvent.click(screen.getByLabelText(`Export ${basePlugin.name}`));

    await waitFor(() => {
      expect(clickFn).toHaveBeenCalled();
    });

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});

// ─── F1098: Uninstall with data-cleanup ───────────────────────────────────────

describe('F1098 — uninstall with data-cleanup', () => {
  it('clicking Uninstall opens a confirmation dialog', async () => {
    renderPluginsPage([basePlugin]);
    await waitFor(() => screen.getByText('My Plugin'));
    fireEvent.click(screen.getByLabelText(`Uninstall ${basePlugin.name}`));

    await waitFor(() => {
      expect(screen.getByText(/Uninstall .My Plugin./)).toBeDefined();
    });
  });

  it('purge checkbox is unchecked by default', async () => {
    renderPluginsPage([basePlugin]);
    await waitFor(() => screen.getByText('My Plugin'));
    fireEvent.click(screen.getByLabelText(`Uninstall ${basePlugin.name}`));
    await waitFor(() => screen.getByLabelText('Also delete plugin data'));

    const checkbox = screen.getByLabelText('Also delete plugin data') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('uninstall without purge sends DELETE without purgeData=true', async () => {
    const { calls } = renderPluginsPage([basePlugin], [
      {
        method: 'DELETE',
        url: `/api/v1/plugins/${basePlugin.id}`,
        body: { data: { success: true } },
      },
    ]);

    await waitFor(() => screen.getByText('My Plugin'));
    fireEvent.click(screen.getByLabelText(`Uninstall ${basePlugin.name}`));
    await waitFor(() => screen.getByLabelText('Uninstall plugin'));

    fireEvent.click(screen.getByLabelText('Uninstall plugin'));

    await waitFor(() => {
      const del = calls.calls.find(
        (c) => c.method === 'DELETE' && c.url.includes(basePlugin.id),
      );
      expect(del).toBeDefined();
      expect(del!.url).not.toContain('purgeData=true');
    });
  });

  it('uninstall WITH purge sends DELETE with purgeData=true', async () => {
    const { calls } = renderPluginsPage([basePlugin], [
      {
        method: 'DELETE',
        url: `/api/v1/plugins/${basePlugin.id}`,
        body: { data: { success: true } },
      },
    ]);

    await waitFor(() => screen.getByText('My Plugin'));
    fireEvent.click(screen.getByLabelText(`Uninstall ${basePlugin.name}`));
    await waitFor(() => screen.getByLabelText('Also delete plugin data'));

    fireEvent.click(screen.getByLabelText('Also delete plugin data'));
    await waitFor(() => screen.getByText(/permanently erase/));

    fireEvent.click(screen.getByLabelText('Uninstall and delete data'));

    await waitFor(() => {
      const del = calls.calls.find(
        (c) => c.method === 'DELETE' && c.url.includes(basePlugin.id),
      );
      expect(del).toBeDefined();
      expect(del!.url).toContain('purgeData=true');
    });
  });

  it('cancelling uninstall dialog hides it', async () => {
    renderPluginsPage([basePlugin]);

    await waitFor(() => screen.getByText('My Plugin'));
    fireEvent.click(screen.getByLabelText(`Uninstall ${basePlugin.name}`));
    await waitFor(() => screen.getByText(/Uninstall .My Plugin./));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      // Dialog should be closed — the title should no longer be visible
      const dialog = screen.queryByRole('dialog');
      expect(dialog === null || !dialog.getAttribute('open')).toBe(true);
    });
  });
});
