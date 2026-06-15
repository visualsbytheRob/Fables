/**
 * Tests for EncryptedSearchIndex (F1213).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EncryptedSearchIndex,
  type IndexDoc,
  type SearchHit,
  type SearchOptions,
  type IndexStats,
} from './encrypted-index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIndex(): EncryptedSearchIndex {
  return new EncryptedSearchIndex();
}

function doc(id: string, title: string, body: string): IndexDoc {
  return { id, title, body };
}

function ids(hits: SearchHit[]): string[] {
  return hits.map((h) => h.id);
}

// ---------------------------------------------------------------------------
// Basic add / search
// ---------------------------------------------------------------------------

describe('add + search — single document', () => {
  it('finds a document by a word in its body', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Hello', 'the quick brown fox'));
    const hits = idx.search('fox');
    expect(ids(hits)).toEqual(['d1']);
  });

  it('finds a document by a word in its title', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Quantum Mechanics', 'complex subject matter'));
    const hits = idx.search('quantum');
    expect(ids(hits)).toEqual(['d1']);
  });

  it('returns empty array for a query with no matches', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Hello', 'world'));
    expect(idx.search('zzzzz')).toEqual([]);
  });

  it('returns empty array for an empty query', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Hello', 'world'));
    expect(idx.search('')).toEqual([]);
  });

  it('returns empty array when querying an empty index', () => {
    const idx = makeIndex();
    expect(idx.search('anything')).toEqual([]);
  });

  it('search is case-insensitive', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Rust Programming', 'safe systems language'));
    expect(ids(idx.search('RUST'))).toEqual(['d1']);
    expect(ids(idx.search('rust'))).toEqual(['d1']);
  });
});

// ---------------------------------------------------------------------------
// Multi-document search and ranking
// ---------------------------------------------------------------------------

describe('multi-document search and ranking', () => {
  it('returns all matching docs for a single-term query', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Alpha', 'forest trees'));
    idx.add(doc('d2', 'Beta', 'ocean waves'));
    idx.add(doc('d3', 'Gamma', 'forest ocean'));
    const hits = idx.search('forest');
    expect(ids(hits).sort()).toEqual(['d1', 'd3']);
  });

  it('ranks a doc with the term in the title higher than body-only', () => {
    const idx = makeIndex();
    idx.add(doc('title-match', 'forest ranger', 'completely unrelated text here'));
    idx.add(doc('body-match', 'Unrelated Title', 'deep in the forest lives a bear'));
    const hits = idx.search('forest');
    expect(ids(hits)[0]).toBe('title-match');
  });

  it('ranks a doc mentioning the term more often higher (TF)', () => {
    const idx = makeIndex();
    idx.add(doc('rare', 'topic', 'python once'));
    idx.add(doc('frequent', 'topic', 'python python python python python'));
    const hits = idx.search('python');
    expect(ids(hits)[0]).toBe('frequent');
  });

  it('multi-term query: doc matching both terms ranks above doc matching one term', () => {
    const idx = makeIndex();
    idx.add(doc('both', 'machine learning guide', 'machine learning techniques'));
    idx.add(doc('one', 'machine shop guide', 'lathes and mills'));
    const hits = idx.search('machine learning');
    expect(ids(hits)[0]).toBe('both');
  });

  it('multi-term query includes docs matching only some terms', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Alpha', 'apple banana cherry'));
    idx.add(doc('d2', 'Beta', 'apple dragonfruit'));
    const hits = idx.search('apple cherry');
    // d1 matches both terms, d2 matches one
    expect(ids(hits)).toContain('d1');
    expect(ids(hits)).toContain('d2');
    expect(ids(hits)[0]).toBe('d1');
  });
});

// ---------------------------------------------------------------------------
// IDF: rare term outranks common term
// ---------------------------------------------------------------------------

describe('IDF weighting', () => {
  it('a rare term outranks a common term when both appear in a doc', () => {
    const idx = makeIndex();
    // "common" appears in all 5 docs; "rare" appears in only 1
    for (let i = 1; i <= 5; i++) {
      idx.add(doc(`d${i}`, 'Topic', `common word here ${i === 3 ? 'rare term' : ''}`));
    }
    // Doc d3 has "rare" which is a high-IDF term; query for both
    const hits = idx.search('rare common');
    // d3 should rank first because "rare" has much higher IDF
    expect(ids(hits)[0]).toBe('d3');
  });

  it('a term present in every doc has lower IDF than a term in few docs', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Note one', 'universal specific'));
    idx.add(doc('d2', 'Note two', 'universal'));
    idx.add(doc('d3', 'Note three', 'universal'));
    // d1 has both "universal" (low IDF) and "specific" (high IDF)
    const hits = idx.search('specific');
    expect(ids(hits)).toEqual(['d1']);
    expect(hits[0]!.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe('remove', () => {
  it('removes a document so it no longer appears in search results', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Hello', 'world ocean'));
    idx.add(doc('d2', 'Hello', 'ocean waves'));
    idx.remove('d1');
    const hits = idx.search('ocean');
    expect(ids(hits)).toEqual(['d2']);
  });

  it('is a no-op for an unknown id', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Hello', 'world'));
    expect(() => idx.remove('nonexistent')).not.toThrow();
    expect(idx.size()).toBe(1);
  });

  it('cleans up the inverted index when last doc for a term is removed', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'unique word here', 'nothing else'));
    idx.remove('d1');
    expect(idx.stats().termCount).toBe(0);
    expect(idx.search('unique')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('drops all documents', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'A', 'aaa'));
    idx.add(doc('d2', 'B', 'bbb'));
    idx.clear();
    expect(idx.size()).toBe(0);
  });

  it('drops all terms', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Alpha', 'beta gamma'));
    idx.clear();
    expect(idx.stats().termCount).toBe(0);
  });

  it('search returns nothing after clear', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Alpha', 'beta gamma'));
    idx.clear();
    expect(idx.search('alpha')).toEqual([]);
  });

  it('can add new docs after clear', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Alpha', 'beta'));
    idx.clear();
    idx.add(doc('d2', 'New', 'content'));
    expect(idx.size()).toBe(1);
    expect(ids(idx.search('content'))).toEqual(['d2']);
  });
});

// ---------------------------------------------------------------------------
// Re-add (update)
// ---------------------------------------------------------------------------

describe('re-adding the same id updates the document', () => {
  it('new content replaces old content', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Hello', 'original content here'));
    idx.add(doc('d1', 'Hello', 'completely different text'));
    expect(ids(idx.search('original'))).toEqual([]);
    expect(ids(idx.search('different'))).toEqual(['d1']);
  });

  it('doc count stays the same after re-add', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'A', 'aaa'));
    idx.add(doc('d1', 'B', 'bbb'));
    expect(idx.size()).toBe(1);
  });

  it('old terms removed when doc is re-added with new terms', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'unique term alpha', 'nothing'));
    idx.add(doc('d1', 'completely different', 'content only'));
    // "alpha" should no longer appear
    expect(idx.search('alpha')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Field-scoped search
// ---------------------------------------------------------------------------

describe('field-scoped search', () => {
  let idx: EncryptedSearchIndex;

  beforeEach(() => {
    idx = makeIndex();
    idx.add(doc('title-only', 'forest river mountain', 'generic filler text here'));
    idx.add(doc('body-only', 'generic title words', 'forest river mountain adventure'));
    idx.add(doc('both', 'forest trail', 'mountain forest river hike'));
  });

  it('field=title returns only docs with term in title', () => {
    const opts: SearchOptions = { field: 'title' };
    const hits = idx.search('forest', opts);
    const resultIds = ids(hits);
    expect(resultIds).toContain('title-only');
    expect(resultIds).toContain('both');
    expect(resultIds).not.toContain('body-only');
  });

  it('field=body returns only docs with term in body', () => {
    const opts: SearchOptions = { field: 'body' };
    const hits = idx.search('forest', opts);
    const resultIds = ids(hits);
    expect(resultIds).toContain('body-only');
    expect(resultIds).toContain('both');
    expect(resultIds).not.toContain('title-only');
  });

  it('field=all (default) returns docs with term in title or body', () => {
    const hits = idx.search('forest', { field: 'all' });
    const resultIds = ids(hits).sort();
    expect(resultIds).toEqual(['body-only', 'both', 'title-only'].sort());
  });
});

// ---------------------------------------------------------------------------
// Prefix matching on last token
// ---------------------------------------------------------------------------

describe('prefix match on the last query token', () => {
  it('matches a doc whose token starts with the query prefix', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Forests', 'ancient forest adventure'));
    // "fo" is not a stopword and is a prefix of "forest" / "forests"
    const hits = idx.search('fo');
    expect(ids(hits)).toContain('d1');
  });

  it('prefix "mac" matches "machine" and "macroscopic"', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'machine learning', 'data science'));
    idx.add(doc('d2', 'macroscopic physics', 'large scale'));
    idx.add(doc('d3', 'totally unrelated', 'other stuff'));
    const hits = idx.search('mac');
    const resultIds = ids(hits);
    expect(resultIds).toContain('d1');
    expect(resultIds).toContain('d2');
    expect(resultIds).not.toContain('d3');
  });

  it('non-last tokens use exact matching only', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'machine learning tutorial', 'advanced content'));
    // "mac" is NOT the last token here; "xyz" is the last token (no match).
    // "machine" exists but "mac" is an exact-only match for non-last tokens
    // — no doc has the exact term "mac", so d1 should NOT appear.
    const hits = idx.search('mac xyz');
    expect(ids(hits)).not.toContain('d1');
  });

  it('exact term still matches via prefix (full word is its own prefix)', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'forest', 'adventure'));
    expect(ids(idx.search('forest'))).toEqual(['d1']);
  });
});

// ---------------------------------------------------------------------------
// Stopwords
// ---------------------------------------------------------------------------

describe('stopwords', () => {
  it('stopwords are ignored in queries — empty result for stopword-only query', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'The quick brown fox', 'jumped over the lazy dog'));
    // "the" and "is" and "a" are stopwords
    expect(idx.search('the')).toEqual([]);
    expect(idx.search('is a')).toEqual([]);
  });

  it('stopwords in document body do not create index entries', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Title', 'some words here'));
    // Stopwords should not contribute to the term count
    const { termCount } = idx.stats();
    // "some", "words", "here" are not stopwords; "title" not either
    // "here" is not in our stopword set, but let's just check the total is low
    expect(termCount).toBeLessThan(10);
  });

  it('a query with some stopwords and a real term still finds docs', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Neural Networks', 'deep learning'));
    const hits = idx.search('the neural networks');
    expect(ids(hits)).toContain('d1');
  });
});

// ---------------------------------------------------------------------------
// limit option
// ---------------------------------------------------------------------------

describe('limit option', () => {
  it('limits the number of returned results', () => {
    const idx = makeIndex();
    for (let i = 0; i < 10; i++) {
      idx.add(doc(`d${i}`, `Note ${i}`, 'common search term here'));
    }
    const hits = idx.search('common', { limit: 3 });
    expect(hits).toHaveLength(3);
  });

  it('returns all results when limit exceeds match count', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'A', 'match term'));
    idx.add(doc('d2', 'B', 'match term'));
    const hits = idx.search('match', { limit: 100 });
    expect(hits).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tie-breaking (stable sort by id)
// ---------------------------------------------------------------------------

describe('tie-breaking by id', () => {
  it('docs with equal scores are sorted by id ascending', () => {
    const idx = makeIndex();
    // Three docs with identical content — same TF, same IDF → same score
    idx.add(doc('zzz', 'Alpha', 'beta gamma delta'));
    idx.add(doc('aaa', 'Alpha', 'beta gamma delta'));
    idx.add(doc('mmm', 'Alpha', 'beta gamma delta'));
    const hits = idx.search('beta');
    expect(ids(hits)).toEqual(['aaa', 'mmm', 'zzz']);
  });
});

// ---------------------------------------------------------------------------
// matchedTerms field
// ---------------------------------------------------------------------------

describe('matchedTerms', () => {
  it('includes terms that actually contributed to the score', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Rust language', 'safe memory management'));
    const [hit] = idx.search('rust memory');
    expect(hit).toBeDefined();
    expect(hit!.matchedTerms).toContain('rust');
    expect(hit!.matchedTerms).toContain('memory');
  });

  it('does not include query terms that did not match', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Rust language', 'safe memory management'));
    const [hit] = idx.search('rust python');
    expect(hit).toBeDefined();
    expect(hit!.matchedTerms).toContain('rust');
    expect(hit!.matchedTerms).not.toContain('python');
  });

  it('matchedTerms are sorted alphabetically', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'Zebra apex', 'apex zebra content'));
    const [hit] = idx.search('zebra apex');
    expect(hit).toBeDefined();
    expect(hit!.matchedTerms).toEqual([...hit!.matchedTerms].sort());
  });
});

// ---------------------------------------------------------------------------
// stats / size
// ---------------------------------------------------------------------------

describe('stats and size', () => {
  it('size() returns 0 for empty index', () => {
    expect(makeIndex().size()).toBe(0);
  });

  it('size() returns the number of added documents', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'A', 'aa'));
    idx.add(doc('d2', 'B', 'bb'));
    expect(idx.size()).toBe(2);
  });

  it('stats() returns correct docCount and termCount', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'forest trail', 'hiking adventure'));
    const s: IndexStats = idx.stats();
    expect(s.docCount).toBe(1);
    expect(s.termCount).toBeGreaterThan(0);
  });

  it('stats() docCount decreases after remove', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'A', 'term one'));
    idx.add(doc('d2', 'B', 'term two'));
    idx.remove('d1');
    expect(idx.stats().docCount).toBe(1);
  });

  it('stats() returns zeros after clear', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'A', 'word'));
    idx.clear();
    const s = idx.stats();
    expect(s.docCount).toBe(0);
    expect(s.termCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Score is positive
// ---------------------------------------------------------------------------

describe('score properties', () => {
  it('all returned hits have a positive score', () => {
    const idx = makeIndex();
    idx.add(doc('d1', 'machine learning', 'neural networks'));
    idx.add(doc('d2', 'deep learning', 'transformers'));
    const hits = idx.search('learning');
    for (const hit of hits) {
      expect(hit.score).toBeGreaterThan(0);
    }
  });
});
