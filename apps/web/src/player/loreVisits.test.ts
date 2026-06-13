import { describe, expect, it } from 'vitest';
import { loadLoreVisits, markLoreVisited, type StorageLike } from './loreVisits.js';

function memoryStore(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('lore visit tracking', () => {
  it('records and reloads visited titles per story', () => {
    const store = memoryStore();
    expect(loadLoreVisits('s1', store).size).toBe(0);
    markLoreVisited('s1', 'The Crow', store);
    markLoreVisited('s1', 'The Crow', store); // idempotent
    markLoreVisited('s1', 'The Cheese', store);
    const visits = loadLoreVisits('s1', store);
    expect([...visits].sort()).toEqual(['The Cheese', 'The Crow']);
  });

  it('isolates stories and tolerates corrupt storage', () => {
    const store = memoryStore();
    markLoreVisited('s1', 'A', store);
    expect(loadLoreVisits('s2', store).size).toBe(0);
    store.setItem('fables.lorevisits.s3', 'broken');
    expect(loadLoreVisits('s3', store).size).toBe(0);
  });
});
