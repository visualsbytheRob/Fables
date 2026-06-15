/**
 * Encrypted FTS: in-memory index built post-unlock (F1213).
 *
 * Pure, no I/O. When a vault is encrypted, SQLite FTS cannot index ciphertext.
 * After the user unlocks the vault the server decrypts notes in memory and feeds
 * them here. This index lives only while unlocked; `clear()` is called on lock.
 *
 * Design: inverted index (term → Set<docId>) + per-doc term-frequency maps.
 * Ranking: TF-IDF-ish with a title-match boost. Multi-term queries use AND-ish
 * scoring (more matching terms = higher rank). The last query token also matches
 * as a prefix (so "fo" matches "forest"). Ties broken by id (stable sort).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface IndexDoc {
  id: string;
  title: string;
  body: string;
}

export interface SearchHit {
  id: string;
  score: number;
  matchedTerms: string[];
}

export interface SearchOptions {
  limit?: number | undefined;
  field?: 'title' | 'body' | 'all' | undefined;
}

export interface IndexStats {
  docCount: number;
  termCount: number;
}

// ---------------------------------------------------------------------------
// Stopword list — small, deterministic English set
// ---------------------------------------------------------------------------

const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'is',
  'it',
  'be',
  'as',
  'at',
  'this',
  'that',
  'was',
  'are',
  'from',
  'not',
  'if',
  'so',
  'do',
  'we',
  'he',
  'she',
  'they',
  'you',
  'i',
  'my',
  'me',
  'no',
  'up',
  'go',
]);

const MIN_TOKEN_LENGTH = 2;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize a string: lowercase, split on non-alphanumeric, drop stopwords and
 * tokens shorter than MIN_TOKEN_LENGTH. Returns an ordered list of tokens
 * (duplicates preserved for TF calculation).
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t));
}

/**
 * Build a term-frequency map from a token list.
 * TF is raw count (we normalise at score time).
 */
function buildTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const tok of tokens) {
    tf.set(tok, (tf.get(tok) ?? 0) + 1);
  }
  return tf;
}

// ---------------------------------------------------------------------------
// Per-document storage
// ---------------------------------------------------------------------------

interface StoredDoc {
  id: string;
  titleTF: Map<string, number>;
  bodyTF: Map<string, number>;
  /** Total tokens across title + body (for normalisation). */
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// EncryptedSearchIndex
// ---------------------------------------------------------------------------

export class EncryptedSearchIndex {
  /** term → set of doc ids that contain this term (title or body). */
  private readonly invertedIndex: Map<string, Set<string>> = new Map();

  /** doc id → stored doc metadata. */
  private readonly docs: Map<string, StoredDoc> = new Map();

  // -------------------------------------------------------------------------
  // Mutation API
  // -------------------------------------------------------------------------

  /** Add or replace a document. Re-adding the same id updates it in place. */
  add(doc: IndexDoc): void {
    // Remove previous version of this doc if it exists
    if (this.docs.has(doc.id)) {
      this.remove(doc.id);
    }

    const titleTokens = tokenize(doc.title);
    const bodyTokens = tokenize(doc.body);
    const allTokens = [...titleTokens, ...bodyTokens];

    const titleTF = buildTF(titleTokens);
    const bodyTF = buildTF(bodyTokens);

    // Store doc metadata
    this.docs.set(doc.id, {
      id: doc.id,
      titleTF,
      bodyTF,
      totalTokens: allTokens.length,
    });

    // Update inverted index with all unique terms
    const uniqueTerms = new Set([...titleTF.keys(), ...bodyTF.keys()]);
    for (const term of uniqueTerms) {
      let postingList = this.invertedIndex.get(term);
      if (postingList === undefined) {
        postingList = new Set();
        this.invertedIndex.set(term, postingList);
      }
      postingList.add(doc.id);
    }
  }

  /** Fully remove a document from the index. No-op if id is unknown. */
  remove(id: string): void {
    const stored = this.docs.get(id);
    if (stored === undefined) return;

    // Remove from all posting lists
    const allTerms = new Set([...stored.titleTF.keys(), ...stored.bodyTF.keys()]);
    for (const term of allTerms) {
      const postingList = this.invertedIndex.get(term);
      if (postingList !== undefined) {
        postingList.delete(id);
        if (postingList.size === 0) {
          this.invertedIndex.delete(term);
        }
      }
    }

    this.docs.delete(id);
  }

  /** Drop everything. Called on vault lock. */
  clear(): void {
    this.invertedIndex.clear();
    this.docs.clear();
  }

  // -------------------------------------------------------------------------
  // Query API
  // -------------------------------------------------------------------------

  /**
   * Search for `query` across the index.
   *
   * - All query terms are ANDed in spirit: docs matching more terms score
   *   higher. Docs matching at least one term are returned.
   * - The last query token is also matched as a prefix so partial words work.
   * - Title matches get a 3× boost.
   * - IDF weights rare terms higher than common ones.
   * - Results are sorted by score desc, then by id asc for ties.
   */
  search(query: string, opts?: SearchOptions): SearchHit[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const field = opts?.field ?? 'all';
    const limit = opts?.limit;

    const N = this.docs.size;
    if (N === 0) return [];

    // Expand the last token with prefix matching. Build a map:
    // expandedTerm → original query token (for matchedTerms reporting).
    const termToOriginal = new Map<string, string>();

    for (let qi = 0; qi < queryTokens.length; qi++) {
      const qt = queryTokens[qi]!;
      const isLast = qi === queryTokens.length - 1;

      if (isLast) {
        // Add all index terms that have qt as a prefix
        for (const indexTerm of this.invertedIndex.keys()) {
          if (indexTerm.startsWith(qt)) {
            termToOriginal.set(indexTerm, qt);
          }
        }
      } else {
        // Exact term match only
        if (this.invertedIndex.has(qt)) {
          termToOriginal.set(qt, qt);
        }
      }
    }

    if (termToOriginal.size === 0) return [];

    // Collect candidate doc ids: union across all expanded terms
    const candidateIds = new Set<string>();
    for (const term of termToOriginal.keys()) {
      const postingList = this.invertedIndex.get(term);
      if (postingList !== undefined) {
        for (const id of postingList) {
          candidateIds.add(id);
        }
      }
    }

    // Score each candidate
    const hits: SearchHit[] = [];

    for (const id of candidateIds) {
      const stored = this.docs.get(id);
      if (stored === undefined) continue;

      let totalScore = 0;
      const matchedOriginals = new Set<string>();

      for (const [term, originalToken] of termToOriginal) {
        // IDF: log((N + 1) / (df + 1)) + 1  — smoothed
        const df = this.invertedIndex.get(term)?.size ?? 0;
        const idf = Math.log((N + 1) / (df + 1)) + 1;

        // TF from title and body (raw counts)
        const titleTF = stored.titleTF.get(term) ?? 0;
        const bodyTF = stored.bodyTF.get(term) ?? 0;

        let termScore = 0;

        if (field !== 'body' && titleTF > 0) {
          // Title boost: weight title TF by 3
          const normTF = titleTF / Math.max(1, stored.titleTF.size);
          termScore += normTF * idf * 3;
        }
        if (field !== 'title' && bodyTF > 0) {
          const normTF = bodyTF / Math.max(1, stored.bodyTF.size);
          termScore += normTF * idf;
        }

        if (termScore > 0) {
          totalScore += termScore;
          matchedOriginals.add(originalToken);
        }
      }

      if (matchedOriginals.size === 0) continue;

      hits.push({
        id,
        score: totalScore,
        matchedTerms: [...matchedOriginals].sort(),
      });
    }

    // Sort: score desc, then id asc for ties (stable)
    hits.sort((a, b) => {
      const diff = b.score - a.score;
      if (diff !== 0) return diff;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    return limit !== undefined ? hits.slice(0, limit) : hits;
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /** Number of documents currently indexed. */
  size(): number {
    return this.docs.size;
  }

  /** Document count + unique term count. */
  stats(): IndexStats {
    return {
      docCount: this.docs.size,
      termCount: this.invertedIndex.size,
    };
  }
}
