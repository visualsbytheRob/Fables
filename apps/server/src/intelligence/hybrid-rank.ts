/**
 * Hybrid ranking (F741–F750): Reciprocal Rank Fusion (RRF) of FTS + vector results.
 *
 * RRF formula: score(d) = Σ 1/(k + rank(d)) for each list containing d.
 * k=60 is the standard constant that balances precision/recall.
 *
 * Additional boosts applied AFTER fusion:
 *   - Recency boost (F743): notes updated in the last 7 days get +0.1 boost.
 *   - Link-degree boost (F744): normalized by max degree; up to +0.1 boost.
 *   - Per-type weighting (F745): entities get a +0.1 boost for short queries (<20 chars).
 *
 * Explainability (F746): when explain=true, each result carries a scoreComponents field.
 *
 * Fallback chain (F749): when embeddings unavailable, hybrid/semantic → keyword.
 */

export interface RRFInput {
  id: string;
  title: string;
  score: number;
  snippet?: string | undefined;
  highlights?: { start: number; end: number }[] | undefined;
  sourceType?: string | undefined;
  updatedAt?: string | undefined;
  linkDegree?: number | undefined;
}

export interface RankedResult {
  id: string;
  title: string;
  score: number;
  snippet: string;
  highlights: { start: number; end: number }[];
  sourceType: string;
  /** Present only when explain=true */
  scoreComponents?: {
    rrf: number;
    recencyBoost: number;
    linkBoost: number;
    typeBoost: number;
    final: number;
  };
}

const RRF_K = 60;

/**
 * Reciprocal Rank Fusion of two result lists.
 * Items may appear in one or both lists.
 */
export function reciprocalRankFusion(
  ftsResults: RRFInput[],
  vectorResults: RRFInput[],
): Map<string, { rrfScore: number; item: RRFInput }> {
  const scores = new Map<string, { rrfScore: number; item: RRFInput }>();

  function addList(list: RRFInput[]) {
    for (let i = 0; i < list.length; i++) {
      const item = list[i]!;
      const rrf = 1 / (RRF_K + i + 1);
      const existing = scores.get(item.id);
      if (existing) {
        existing.rrfScore += rrf;
      } else {
        scores.set(item.id, { rrfScore: rrf, item });
      }
    }
  }

  addList(ftsResults);
  addList(vectorResults);

  return scores;
}

/**
 * Apply post-fusion boosts and sort descending.
 * Returns RankedResult[].
 */
export function applyBoosts(
  fused: Map<string, { rrfScore: number; item: RRFInput }>,
  query: string,
  maxLinkDegree: number,
  explain: boolean,
): RankedResult[] {
  const now = Date.now();
  const isShortQuery = query.trim().length < 20;

  const results: RankedResult[] = [];

  for (const { rrfScore, item } of fused.values()) {
    // Recency boost (F743): 0.1 if updated in the last 7 days
    let recencyBoost = 0;
    if (item.updatedAt) {
      const age = now - new Date(item.updatedAt).getTime();
      if (age < 7 * 24 * 60 * 60 * 1000) recencyBoost = 0.1;
    }

    // Link-degree boost (F744): up to 0.1, proportional to degree
    let linkBoost = 0;
    if (maxLinkDegree > 0 && item.linkDegree !== undefined) {
      linkBoost = (item.linkDegree / maxLinkDegree) * 0.1;
    }

    // Per-type weighting (F745): boost entities for short queries
    let typeBoost = 0;
    if (isShortQuery && item.sourceType === 'entity') {
      typeBoost = 0.1;
    }

    const final = rrfScore + recencyBoost + linkBoost + typeBoost;

    results.push({
      id: item.id,
      title: item.title,
      score: final,
      snippet: item.snippet ?? '',
      highlights: item.highlights ?? [],
      sourceType: item.sourceType ?? 'note',
      ...(explain
        ? {
            scoreComponents: {
              rrf: rrfScore,
              recencyBoost,
              linkBoost,
              typeBoost,
              final,
            },
          }
        : {}),
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Full hybrid fusion: takes FTS results + vector results, applies RRF + boosts.
 * Returns normalised ranked list.
 */
export function hybridFuse(
  ftsResults: RRFInput[],
  vectorResults: RRFInput[],
  query: string,
  maxLinkDegree: number,
  explain: boolean,
): RankedResult[] {
  const fused = reciprocalRankFusion(ftsResults, vectorResults);
  return applyBoosts(fused, query, maxLinkDegree, explain);
}
