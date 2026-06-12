/**
 * Did-you-mean hints (F347): Damerau-Levenshtein distance with a sliding
 * acceptance threshold based on name length.
 */

export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) (d[i] as number[])[0] = i;
  for (let j = 0; j <= n; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = d[i] as number[];
      const prev = d[i - 1] as number[];
      row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j] as number, ((d[i - 2] as number[])[j - 2] as number) + 1);
      }
    }
  }
  return (d[m] as number[])[n] as number;
}

/** Best close match for `name` among `candidates`, or undefined when nothing is close. */
export function suggestName(name: string, candidates: Iterable<string>): string | undefined {
  const lower = name.toLowerCase();
  const maxDistance = name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
  let best: string | undefined;
  let bestDist = maxDistance + 1;
  for (const candidate of candidates) {
    if (candidate === name) continue;
    const dist = editDistance(lower, candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/** Format the standard did-you-mean suffix, or empty string. */
export function didYouMean(name: string, candidates: Iterable<string>): string {
  const suggestion = suggestName(name, candidates);
  return suggestion !== undefined ? ` — did you mean "${suggestion}"?` : '';
}
