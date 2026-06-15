/**
 * Typographic cover fallback (Epic 19, F1863).
 *
 * When no image backend is available, a fable still deserves a cover. This emits
 * a clean, deterministic SVG cover from the title + blurb + a theme-derived
 * palette — no network, no dependency. The web layer can render it directly or
 * rasterize it.
 */

export interface CoverPalette {
  bg: string;
  fg: string;
  accent: string;
}

/** Deterministic palette from a theme string (stable per theme). */
export function themePalette(theme: string): CoverPalette {
  let h = 0;
  for (let i = 0; i < theme.length; i++) h = (h * 31 + theme.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    bg: `hsl(${hue}, 35%, 18%)`,
    fg: `hsl(${hue}, 20%, 92%)`,
    accent: `hsl(${(hue + 40) % 360}, 60%, 60%)`,
  };
}

const escapeXml = (s: string): string => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Wrap text into lines of at most `maxChars`, up to `maxLines` lines. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

/** A self-contained SVG typographic cover (F1863 fallback). */
export function typographicCover(
  title: string,
  blurb: string,
  theme = 'fable',
  width = 600,
  height = 900,
): string {
  const p = themePalette(theme);
  const titleLines = wrap(title || 'Untitled', 18, 4);
  const blurbLines = wrap(blurb, 40, 3);
  const titleStartY = height * 0.42 - (titleLines.length - 1) * 30;

  const titleSpans = titleLines
    .map(
      (l, i) =>
        `<text x="${width / 2}" y="${titleStartY + i * 60}" text-anchor="middle" font-size="48" font-family="Georgia, serif" font-weight="700" fill="${p.fg}">${escapeXml(l)}</text>`,
    )
    .join('');
  const blurbSpans = blurbLines
    .map(
      (l, i) =>
        `<text x="${width / 2}" y="${height * 0.72 + i * 28}" text-anchor="middle" font-size="20" font-family="Georgia, serif" fill="${p.fg}" opacity="0.8">${escapeXml(l)}</text>`,
    )
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${p.bg}"/>`,
    `<rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="none" stroke="${p.accent}" stroke-width="2"/>`,
    `<line x1="${width * 0.3}" y1="${height * 0.5}" x2="${width * 0.7}" y2="${height * 0.5}" stroke="${p.accent}" stroke-width="3"/>`,
    titleSpans,
    blurbSpans,
    `</svg>`,
  ].join('');
}
