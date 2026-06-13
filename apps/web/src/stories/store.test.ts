/** Workspace store tests (F512/F519) + project build (F513/F514). */
import { describe, expect, it } from 'vitest';
import { buildProject, firstProblem, pickEntryPath } from './build.js';
import { WorkspaceStore } from './store.js';

const seed = () => {
  const store = new WorkspaceStore();
  store.init(
    [
      { id: 'f1', path: 'main.fable', source: '-> den\n\n=== den ===\nHi.\n-> END\n' },
      { id: 'f2', path: 'side.fable', source: '=== extra ===\nMore.\n-> END\n' },
    ],
    'main.fable',
  );
  return store;
};

describe('WorkspaceStore', () => {
  it('opens the entry tab on init and tracks tabs', () => {
    const store = seed();
    expect(store.getState().active).toBe('main.fable');
    store.openTab('side.fable');
    expect(store.getState().tabs).toEqual(['main.fable', 'side.fable']);
    store.closeTab('side.fable');
    expect(store.getState().active).toBe('main.fable');
  });

  it('tracks dirty buffers until the server acknowledges the save (F519)', () => {
    const store = seed();
    expect(store.isDirty('main.fable')).toBe(false);
    store.updateSource('main.fable', '-> den\n\n=== den ===\nHello.\n-> END\n');
    expect(store.isDirty('main.fable')).toBe(true);
    expect(store.dirtyPaths()).toEqual(['main.fable']);

    const source = store.file('main.fable')?.source ?? '';
    store.markSaved('main.fable', source);
    expect(store.isDirty('main.fable')).toBe(false);
    expect(store.getState().saveStates.get('main.fable')).toBe('saved');
  });

  it('bumps version on edits but not on tab moves', () => {
    const store = seed();
    const v = store.getState().version;
    store.openTab('side.fable');
    expect(store.getState().version).toBe(v);
    store.updateSource('side.fable', 'changed\n');
    expect(store.getState().version).toBe(v + 1);
  });

  it('applies point edits and bulk replacements', () => {
    const store = seed();
    store.applyEdit('main.fable', 0, 0, '// header\n');
    expect(store.file('main.fable')?.source.startsWith('// header\n')).toBe(true);
    store.applySources(new Map([['side.fable', 'rewritten\n']]));
    expect(store.file('side.fable')?.source).toBe('rewritten\n');
    expect(store.dirtyPaths().sort()).toEqual(['main.fable', 'side.fable']);
  });

  it('split pane follows closed tabs (F518)', () => {
    const store = seed();
    store.openTab('side.fable');
    store.setSplit('side.fable');
    expect(store.getState().split).toBe('side.fable');
    store.closeTab('side.fable');
    expect(store.getState().split).toBeNull();
  });

  it('marks locally created files for their first save', () => {
    const store = seed();
    store.addFile('new.fable', '=== n ===\n-> END\n');
    expect(store.getState().saveStates.get('new.fable')).toBe('dirty');
    expect(store.getState().active).toBe('new.fable');
  });
});

describe('buildProject (F513/F514)', () => {
  it('compiles all buffers and counts problems across files', () => {
    const files = new Map([
      ['main.fable', '-> den\n\n=== den ===\nHi.\n-> nowhere\n'],
      ['side.fable', '=== extra ===\nMore.\n-> also_missing\n'],
    ]);
    const build = buildProject(files, 'main.fable');
    expect(build.ok).toBe(false);
    expect(build.errors).toBeGreaterThanOrEqual(2);
    const filesWithProblems = new Set(build.problems.map((p) => p.file));
    expect(filesWithProblems.has('main.fable')).toBe(true);
    expect(filesWithProblems.has('side.fable')).toBe(true);
    expect(firstProblem(build)?.diagnostic.severity).toBe('error');
  });

  it('resolves INCLUDE against project buffers and attributes diagnostics', () => {
    const files = new Map([
      ['main.fable', 'INCLUDE side.fable\n-> den\n\n=== den ===\n-> extra\n'],
      ['side.fable', '=== extra ===\nShared.\n-> bad_target\n'],
    ]);
    const build = buildProject(files, 'main.fable');
    const sideProblem = build.problems.find((p) => p.diagnostic.code === 'FORGE202');
    expect(sideProblem?.file).toBe('side.fable');
  });

  it('reports a clean build for a healthy project', () => {
    const build = buildProject(new Map([['main.fable', '-> a\n\n=== a ===\nHi.\n-> END\n']]));
    expect(build.ok).toBe(true);
    expect(build.errors).toBe(0);
    expect(firstProblem(build)).toBeNull();
  });

  it('picks main.fable, then the preferred entry, then the first file', () => {
    expect(pickEntryPath(new Map([['z.fable', ''], ['main.fable', '']]))).toBe('main.fable');
    expect(pickEntryPath(new Map([['z.fable', ''], ['a.fable', '']]))).toBe('a.fable');
    expect(pickEntryPath(new Map([['z.fable', '']]), 'z.fable')).toBe('z.fable');
  });
});
