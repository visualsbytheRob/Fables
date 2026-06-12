// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, recoverableDraft, saveDraft } from './drafts.js';

beforeEach(() => localStorage.clear());

const draft = {
  noteId: 'n1',
  title: 'Edited',
  body: 'edited body',
  baseRev: 3,
  savedAt: 1234,
};

describe('draft recovery (F186)', () => {
  it('round-trips drafts per note', () => {
    saveDraft(draft);
    expect(loadDraft('n1')).toEqual(draft);
    expect(loadDraft('other')).toBeNull();
    clearDraft('n1');
    expect(loadDraft('n1')).toBeNull();
  });

  it('offers a draft only when it differs from the loaded note', () => {
    saveDraft(draft);
    expect(recoverableDraft('n1', { title: 'Server', body: 'server body' })).toEqual(draft);
    // identical content ⇒ stale mirror, silently dropped
    saveDraft(draft);
    expect(recoverableDraft('n1', { title: 'Edited', body: 'edited body' })).toBeNull();
    expect(loadDraft('n1')).toBeNull();
  });

  it('ignores corrupt payloads', () => {
    localStorage.setItem('fables.notes.draft.n1', '{not json');
    expect(loadDraft('n1')).toBeNull();
  });
});
