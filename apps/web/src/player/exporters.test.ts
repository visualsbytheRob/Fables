// @vitest-environment jsdom
/** Export & sharing tests (F581/F585/F586/F590). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryFile, StoryProject } from '../stories/api.js';
import {
  fnv1a,
  shareText,
  storyBundle,
  storyManifest,
  transcriptMarkdown,
  transcriptNoteTitle,
} from './exporters.js';

afterEach(() => vi.restoreAllMocks());

const story: StoryProject = {
  id: 's1',
  title: 'The Fox',
  description: 'A fable.',
  entryFile: 'main.fable',
  status: 'valid',
  settings: { cover: { color: null, emoji: null }, theme: null, seedMode: 'random', seed: 1 },
  createdAt: '2026-06-13T00:00:00Z',
  updatedAt: '2026-06-13T00:00:00Z',
};
const files: StoryFile[] = [
  { id: 'f2', storyId: 's1', path: 'b.fable', source: 'B', createdAt: '', updatedAt: '' },
  { id: 'f1', storyId: 's1', path: 'a.fable', source: 'A', createdAt: '', updatedAt: '' },
];

describe('transcriptMarkdown (F585)', () => {
  it('renders title, meta line and choices as quotes', () => {
    const md = transcriptMarkdown(
      [
        { kind: 'text', text: 'The gate creaks.' },
        { kind: 'choice', text: 'Slip through.' },
        { kind: 'text', text: 'Moss.' },
      ],
      { title: 'The Fox', playedAt: new Date('2026-06-13'), ending: 'moss' },
    );
    expect(md).toContain('# Transcript: The Fox');
    expect(md).toContain('1 choice');
    expect(md).toContain('ending: moss');
    expect(md).toContain('> **Slip through.**');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('titles transcript notes consistently (F566)', () => {
    expect(transcriptNoteTitle('The Fox', new Date('2026-06-13T10:00:00Z'))).toBe(
      'Transcript: The Fox — 2026-06-13',
    );
  });
});

describe('storyBundle (F581)', () => {
  it('captures every file verbatim with metadata', () => {
    const bundle = storyBundle(story, files);
    expect(bundle.format).toBe('fables.story-bundle');
    expect(bundle.story.entryFile).toBe('main.fable');
    expect(bundle.files).toEqual({ 'a.fable': 'A', 'b.fable': 'B' });
  });
});

describe('storyManifest (F586)', () => {
  it('checksums files in stable path order', () => {
    const manifest = storyManifest(story, files);
    expect(manifest.files.map((f) => f.path)).toEqual(['a.fable', 'b.fable']);
    expect(manifest.files[0]?.checksum).toBe(fnv1a('A'));
    // Deterministic regardless of input order.
    expect(storyManifest(story, [...files].reverse()).checksum).toBe(manifest.checksum);
  });

  it('fnv1a is stable', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).not.toBe(fnv1a('hellp'));
  });
});

describe('shareText (F590)', () => {
  it('prefers the Web Share API', async () => {
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { share });
    await expect(shareText({ title: 't', url: 'u' })).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 't', url: 'u' });
  });

  it('falls back to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(shareText({ title: 't', url: 'u' })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('u');
  });

  it('reports unavailable when neither exists', async () => {
    vi.stubGlobal('navigator', {});
    await expect(shareText({ title: 't' })).resolves.toBe('unavailable');
  });
});
