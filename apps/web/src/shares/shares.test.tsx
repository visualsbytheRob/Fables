// @vitest-environment jsdom
/**
 * F1144 — Share Management UI tests
 * F1147 — Shared-with-me view tests
 */
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, ToastProvider } from '@fables/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as hooksModule from '../api/hooks.js';
import { ShareManagementPanel } from './ShareManagementPanel.js';
import { SharedWithMeView } from './SharedWithMeView.js';
import type { Share, SharedWithMeItem, ShareAuditEntry } from '../api/client.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Wrapper ─────────────────────────────────────────────────────────────────

function makeWrapper() {
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

// ─── Mock data ───────────────────────────────────────────────────────────────

const MOCK_SHARES: Share[] = [
  {
    id: 'share-1',
    docId: 'note-abc',
    docTitle: 'My Secret Plan',
    accessLevel: 'view',
    expiresAt: null,
    createdAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'share-2',
    docId: 'note-xyz',
    docTitle: 'Campaign Notes',
    accessLevel: 'edit',
    expiresAt: '2030-12-31T00:00:00Z',
    createdAt: '2025-02-01T00:00:00Z',
  },
];

const MOCK_AUDIT: ShareAuditEntry[] = [
  { id: 'audit-1', shareId: 'share-1', accessedAt: '2025-06-01T12:00:00Z' },
];

const MOCK_SHARED_WITH_ME: SharedWithMeItem[] = [
  {
    shareId: 'sw-1',
    docId: 'note-remote',
    docTitle: 'Collaborator Note',
    accessLevel: 'comment',
    sharedAt: '2025-03-01T00:00:00Z',
    expiresAt: null,
  },
  {
    shareId: 'sw-2',
    docId: 'note-expired',
    docTitle: 'Old Share',
    accessLevel: 'view',
    sharedAt: '2024-01-01T00:00:00Z',
    expiresAt: '2024-06-01T00:00:00Z', // in the past → expired
  },
];

// ─── ShareManagementPanel tests (F1144) ─────────────────────────────────────

describe('ShareManagementPanel (F1144)', () => {
  beforeEach(() => {
    vi.spyOn(hooksModule, 'useShares').mockReturnValue({
      data: MOCK_SHARES,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useShares>);

    vi.spyOn(hooksModule, 'useShareAudit').mockReturnValue({
      data: MOCK_AUDIT,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof hooksModule.useShareAudit>);

    vi.spyOn(hooksModule, 'useRevokeShare').mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof hooksModule.useRevokeShare>);
  });

  it('renders the panel heading', () => {
    render(<ShareManagementPanel />, { wrapper: makeWrapper() });
    expect(screen.getByRole('heading', { name: 'Shares' })).toBeDefined();
  });

  it('shows all shares with title and access level', () => {
    render(<ShareManagementPanel />, { wrapper: makeWrapper() });
    expect(screen.getByText('My Secret Plan')).toBeDefined();
    expect(screen.getByText('Campaign Notes')).toBeDefined();
    expect(screen.getByText(/view only/i)).toBeDefined();
    expect(screen.getByText(/can edit/i)).toBeDefined();
  });

  it('shows "Never" for shares without expiry', () => {
    render(<ShareManagementPanel />, { wrapper: makeWrapper() });
    expect(screen.getByText(/Expires: Never/i)).toBeDefined();
  });

  it('shows expiry date for timed shares', () => {
    render(<ShareManagementPanel />, { wrapper: makeWrapper() });
    // expiry for share-2 is 2030-12-31
    const expiryText = screen.getAllByText(/Expires:/i);
    expect(expiryText.length).toBeGreaterThan(0);
  });

  it('has Revoke buttons for each share', () => {
    render(<ShareManagementPanel />, { wrapper: makeWrapper() });
    const revokeButtons = screen.getAllByRole('button', { name: /revoke/i });
    expect(revokeButtons).toHaveLength(MOCK_SHARES.length);
  });

  it('calls revoke mutation when Revoke is clicked', () => {
    const mutate = vi.fn();
    vi.spyOn(hooksModule, 'useRevokeShare').mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof hooksModule.useRevokeShare>);

    render(<ShareManagementPanel />, { wrapper: makeWrapper() });
    // The aria-label uses curly quotes from the component; match with regex
    const revokeBtn = screen.getAllByRole('button', { name: /revoke share for/i })[0]!;
    fireEvent.click(revokeBtn);
    expect(mutate).toHaveBeenCalledWith('share-1');
  });

  it('shows access log when "Access log" is clicked', async () => {
    render(<ShareManagementPanel />, { wrapper: makeWrapper() });
    const logBtn = screen.getAllByRole('button', { name: 'Access log' })[0]!;
    fireEvent.click(logBtn);
    await waitFor(() => expect(screen.getByRole('list', { name: 'Access log' })).toBeDefined(), {
      timeout: 8000,
    });
  });

  it('shows empty state when no shares exist', () => {
    vi.spyOn(hooksModule, 'useShares').mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useShares>);

    render(<ShareManagementPanel />, { wrapper: makeWrapper() });
    expect(screen.getByText('You have not shared any documents.')).toBeDefined();
  });

  it('shows loading state', () => {
    vi.spyOn(hooksModule, 'useShares').mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useShares>);

    render(<ShareManagementPanel />, { wrapper: makeWrapper() });
    expect(screen.getByText('Loading shares…')).toBeDefined();
  });

  it('shows error state with retry button', () => {
    const refetch = vi.fn();
    vi.spyOn(hooksModule, 'useShares').mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof hooksModule.useShares>);

    render(<ShareManagementPanel />, { wrapper: makeWrapper() });
    expect(screen.getByRole('alert')).toBeDefined();
    const retryBtn = screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalled();
  });
});

// ─── SharedWithMeView tests (F1147) ─────────────────────────────────────────

describe('SharedWithMeView (F1147)', () => {
  beforeEach(() => {
    vi.spyOn(hooksModule, 'useSharedWithMe').mockReturnValue({
      data: MOCK_SHARED_WITH_ME,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useSharedWithMe>);
  });

  it('renders the section heading', () => {
    render(<SharedWithMeView />, { wrapper: makeWrapper() });
    expect(screen.getByRole('heading', { name: 'Shared with me' })).toBeDefined();
  });

  it('shows items shared with this device', () => {
    render(<SharedWithMeView />, { wrapper: makeWrapper() });
    expect(screen.getByText('Collaborator Note')).toBeDefined();
    expect(screen.getByText('Old Share')).toBeDefined();
  });

  it('shows access level for each item', () => {
    render(<SharedWithMeView />, { wrapper: makeWrapper() });
    expect(screen.getByText(/can comment/i)).toBeDefined();
    expect(screen.getByText(/view only/i)).toBeDefined();
  });

  it('marks expired shares', () => {
    render(<SharedWithMeView />, { wrapper: makeWrapper() });
    // Old Share has a past expiry; there should be an "Expired" badge
    const expiredBadges = screen.getAllByLabelText('Expired');
    expect(expiredBadges.length).toBeGreaterThan(0);
  });

  it('renders document links', () => {
    render(<SharedWithMeView />, { wrapper: makeWrapper() });
    const link = screen.getByRole('link', { name: /Open "Collaborator Note"/i });
    expect(link).toBeDefined();
    expect((link as HTMLAnchorElement).href).toContain('/notes/note-remote');
  });

  it('shows empty state when nothing is shared', () => {
    vi.spyOn(hooksModule, 'useSharedWithMe').mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useSharedWithMe>);

    render(<SharedWithMeView />, { wrapper: makeWrapper() });
    expect(screen.getByText('Nothing has been shared with you yet.')).toBeDefined();
  });

  it('gracefully handles null/undefined data as empty state', () => {
    vi.spyOn(hooksModule, 'useSharedWithMe').mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useSharedWithMe>);

    render(<SharedWithMeView />, { wrapper: makeWrapper() });
    // Should render empty state, not crash
    expect(screen.getByText('Nothing has been shared with you yet.')).toBeDefined();
  });

  it('shows loading state', () => {
    vi.spyOn(hooksModule, 'useSharedWithMe').mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof hooksModule.useSharedWithMe>);

    render(<SharedWithMeView />, { wrapper: makeWrapper() });
    expect(screen.getByText('Loading shared items…')).toBeDefined();
  });

  it('shows error state with retry button', () => {
    const refetch = vi.fn();
    vi.spyOn(hooksModule, 'useSharedWithMe').mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof hooksModule.useSharedWithMe>);

    render(<SharedWithMeView />, { wrapper: makeWrapper() });
    expect(screen.getByRole('alert')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });
});
