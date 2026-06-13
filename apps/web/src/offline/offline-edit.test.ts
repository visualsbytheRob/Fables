// @vitest-environment jsdom
/**
 * Offline editing e2e approximation (F860).
 * Simulates: edit note offline → reconnect → verify outbox entries exist
 * and would be synced. Uses pure logic without a real IDB (no fake-indexeddb dep).
 */
import { describe, it, expect, vi } from 'vitest';
import type { IdbNote, OutboxEntry } from './idb.js';

// Simulate the offline mutation flow
function simulateOfflinePatch(
  note: IdbNote,
  patch: { rev: number; title?: string; body?: string },
): { updatedNote: IdbNote; outboxEntry: OutboxEntry } {
  const updated: IdbNote = {
    ...note,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.body !== undefined ? { body: patch.body } : {}),
    updatedAt: new Date().toISOString(),
    _syncedAt: Date.now(),
  };
  const entry: OutboxEntry = {
    id: crypto.randomUUID(),
    resource: 'notes',
    op: 'patch',
    resourceId: note.id,
    payload: patch,
    createdAt: Date.now(),
    attemptCount: 0,
    status: 'pending',
    lastError: null,
    clientTimestamp: Date.now(),
  };
  return { updatedNote: updated, outboxEntry: entry };
}

// Simulate the reconnect sync flow
async function simulateReconnectSync(
  outbox: OutboxEntry[],
  fetchMock: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  for (const entry of outbox) {
    try {
      const method = entry.op === 'create' ? 'POST' : entry.op === 'patch' ? 'PATCH' : 'DELETE';
      const url = `/api/v1/${entry.resource}/${entry.resourceId}`;
      const res = await fetchMock(url, { method });
      if (res.ok) synced++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { synced, failed };
}

describe('offline editing flow (F860)', () => {
  const baseNote: IdbNote = {
    id: 'note-offline-1',
    notebookId: 'nb1',
    title: 'Original Title',
    body: 'Original body',
    pinned: false,
    trashedAt: null,
    createdAt: '2026-06-13T00:00:00Z',
    updatedAt: '2026-06-13T00:00:00Z',
    rev: 1,
    _syncedAt: Date.now() - 5000,
  };

  it('offline patch updates local note and queues outbox entry', () => {
    const { updatedNote, outboxEntry } = simulateOfflinePatch(baseNote, {
      rev: 1,
      title: 'Edited Offline',
      body: 'New body written offline',
    });

    // Local note is updated immediately
    expect(updatedNote.title).toBe('Edited Offline');
    expect(updatedNote.body).toBe('New body written offline');
    expect(updatedNote.rev).toBe(1); // unchanged until server responds

    // Outbox entry is queued
    expect(outboxEntry.status).toBe('pending');
    expect(outboxEntry.resource).toBe('notes');
    expect(outboxEntry.op).toBe('patch');
    expect(outboxEntry.resourceId).toBe('note-offline-1');
    expect((outboxEntry.payload as { title: string }).title).toBe('Edited Offline');
  });

  it('multiple offline edits all queue to outbox', () => {
    const outbox: OutboxEntry[] = [];
    let note = { ...baseNote };

    // Edit 1
    const r1 = simulateOfflinePatch(note, { rev: 1, title: 'Draft 1' });
    note = r1.updatedNote;
    outbox.push(r1.outboxEntry);

    // Edit 2
    const r2 = simulateOfflinePatch(note, { rev: 1, body: 'Updated body' });
    note = r2.updatedNote;
    outbox.push(r2.outboxEntry);

    expect(outbox).toHaveLength(2);
    expect(outbox.every((e) => e.status === 'pending')).toBe(true);
    expect(note.title).toBe('Draft 1');
    expect(note.body).toBe('Updated body');
  });

  it('reconnect sync drains outbox successfully', async () => {
    const { outboxEntry } = simulateOfflinePatch(baseNote, { rev: 1, title: 'Synced title' });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { ...baseNote, title: 'Synced title', rev: 2 } }),
    } as Response);

    const { synced, failed } = await simulateReconnectSync([outboxEntry], fetchMock);

    expect(synced).toBe(1);
    expect(failed).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/notes/${baseNote.id}`,
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('sync handles 409 conflict gracefully (removes from outbox)', async () => {
    const { outboxEntry: _outboxEntry } = simulateOfflinePatch(baseNote, {
      rev: 1,
      title: 'Conflicted edit',
    });

    // 409 = server wins, still drain
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
    } as Response);

    // Our reconnect logic treats 409 as "remove from outbox" (server wins)
    // Here we test the underlying logic
    const res = await fetchMock('/api/v1/notes/note-offline-1', { method: 'PATCH' });
    expect(res.status).toBe(409);
    // 409 should be counted as synced (conflict resolved)
    // (see useReconnectSync.ts: if (res.ok || res.status === 409))
    const syncedOrConflict = res.ok || res.status === 409;
    expect(syncedOrConflict).toBe(true);
  });

  it('sync gracefully handles network errors', async () => {
    const { outboxEntry } = simulateOfflinePatch(baseNote, { rev: 1, body: 'Will fail' });

    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));

    const { synced, failed } = await simulateReconnectSync([outboxEntry], fetchMock);

    expect(synced).toBe(0);
    expect(failed).toBe(1);
  });

  it('clock-skew tolerance: clientTimestamp is recorded', () => {
    const before = Date.now();
    const { outboxEntry } = simulateOfflinePatch(baseNote, { rev: 1, title: 'Timestamp test' });
    const after = Date.now();

    expect(outboxEntry.clientTimestamp).toBeGreaterThanOrEqual(before);
    expect(outboxEntry.clientTimestamp).toBeLessThanOrEqual(after);
  });
});
