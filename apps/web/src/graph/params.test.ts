import { describe, expect, it } from 'vitest';
import { buildGraphParams } from '../api/client.js';

describe('graph filter params (F246)', () => {
  it('maps a full filter to the API query params', () => {
    expect(
      buildGraphParams({
        notebookId: 'nb1',
        tag: 'world',
        kinds: ['wikilink', 'mention'],
        since: '2026-01-01T00:00:00Z',
      }),
    ).toEqual({
      notebookId: 'nb1',
      tag: 'world',
      kinds: 'wikilink,mention',
      since: '2026-01-01T00:00:00Z',
    });
  });

  it('omits empty values so the server applies its defaults', () => {
    expect(buildGraphParams({})).toEqual({
      notebookId: undefined,
      tag: undefined,
      kinds: undefined,
      since: undefined,
    });
    expect(buildGraphParams({ notebookId: '', tag: '', kinds: [] }).kinds).toBeUndefined();
  });

  it('threads extras like hops for the local graph endpoint', () => {
    expect(buildGraphParams({ tag: 'x' }, { hops: 2 })).toMatchObject({ tag: 'x', hops: 2 });
  });
});
