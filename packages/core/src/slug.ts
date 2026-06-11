/** Unicode-safe slug: diacritics stripped, lowercased, non-alphanumerics collapsed to `-`. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

/** Returns `base`, or `base-2`, `base-3`, … — first variant not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const root = slugify(base);
  if (!taken.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Title derived from the first non-empty line of a body, trimmed of markdown heading markers. */
export function titleFromBody(body: string, fallback = 'Untitled'): string {
  for (const line of body.split('\n')) {
    const cleaned = line.replace(/^#{1,6}\s+/, '').trim();
    if (cleaned.length > 0) return cleaned.slice(0, 200);
  }
  return fallback;
}
