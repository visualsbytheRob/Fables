import { describe, expect, it } from 'vitest';
import {
  addAnnotation,
  annotationBody,
  annotationLink,
  annotationTitle,
  loadAnnotations,
  removeAnnotation,
  type StorageLike,
} from './annotationsLogic.js';

function memoryStore(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('annotations registry', () => {
  it('round-trips add/load/remove per story', () => {
    const store = memoryStore();
    expect(loadAnnotations('s1', store)).toEqual([]);

    const a = addAnnotation(
      {
        noteId: 'n1',
        storyId: 's1',
        playthroughId: 'pt1',
        turn: 3,
        scene: 'forest',
        quote: 'The fox',
      },
      store,
    );
    expect(a.id).toMatch(/^an_/);
    const loaded = loadAnnotations('s1', store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.noteId).toBe('n1');
    expect(loaded[0]?.turn).toBe(3);

    removeAnnotation('s1', a.id, store);
    expect(loadAnnotations('s1', store)).toEqual([]);
  });

  it('keeps newest annotation first and isolates stories', () => {
    const store = memoryStore();
    addAnnotation(
      { noteId: 'n1', storyId: 's1', playthroughId: 'p', turn: 1, scene: '', quote: 'a' },
      store,
    );
    addAnnotation(
      { noteId: 'n2', storyId: 's1', playthroughId: 'p', turn: 2, scene: '', quote: 'b' },
      store,
    );
    addAnnotation(
      { noteId: 'n3', storyId: 's2', playthroughId: 'p', turn: 1, scene: '', quote: 'c' },
      store,
    );

    const s1 = loadAnnotations('s1', store);
    expect(s1.map((x) => x.noteId)).toEqual(['n2', 'n1']);
    expect(loadAnnotations('s2', store).map((x) => x.noteId)).toEqual(['n3']);
  });

  it('survives corrupt storage', () => {
    const store = memoryStore();
    store.setItem('fables.annotations.s1', '{not json');
    expect(loadAnnotations('s1', store)).toEqual([]);
  });
});

describe('annotation note rendering', () => {
  it('builds a clipped, single-line title', () => {
    expect(annotationTitle('  The fox\ntrotted on  ')).toBe('Note: “The fox trotted on”');
    expect(annotationTitle('x'.repeat(80))).toMatch(/…”$/);
    expect(annotationTitle('   ')).toBe('Annotation');
  });

  it('quotes the passage and back-links to the exact turn', () => {
    const body = annotationBody({
      storyId: 's1',
      storyTitle: 'The Fox',
      turn: 5,
      scene: 'forest',
      quote: 'Line one\nLine two',
    });
    expect(body).toContain('> Line one');
    expect(body).toContain('> Line two');
    expect(body).toContain('/stories/s1/play?turn=5');
    expect(body).toContain('scene *forest*');
  });

  it('omits the scene clause when there is no scene', () => {
    const body = annotationBody({ storyId: 's1', storyTitle: 'T', turn: 1, scene: '', quote: 'q' });
    expect(body).not.toContain('scene');
  });

  it('deep-links an annotation back into the player at its turn', () => {
    const link = annotationLink({
      id: 'a',
      noteId: 'n',
      storyId: 's9',
      playthroughId: 'p',
      turn: 7,
      scene: '',
      quote: 'q',
      createdAt: '',
    });
    expect(link).toBe('/stories/s9/play?turn=7');
  });
});
