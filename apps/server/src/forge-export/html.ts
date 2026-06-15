/**
 * Self-contained HTML story export (F583).
 *
 * Generates a single-file HTML document that:
 *   - Embeds compiled bytecode as base64 in a <script type="application/fable-bytecode"> tag
 *   - Inlines the caller-supplied playerRuntimeJs bundle
 *   - Provides a minimal shell (<div id="app">) for the player to attach to
 *   - HTML-escapes all metadata that appears in markup
 *
 * Exported API:
 *   exportStoryHtml(source, meta, opts)  → string (full HTML document)
 *   extractEmbeddedProgram(html)         → Uint8Array (deserializable bytecode)
 *
 * F589 integrity guarantee: extractEmbeddedProgram → deserializeProgram → programFingerprint
 * equals the fingerprint of the directly-compiled source.
 *
 * Feature coverage: F583, F589 (integrity seed)
 */

import { compileStory } from '@fables/forge-vm';

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

/** Escape text content for safe embedding inside HTML markup (not attributes). */
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ---------------------------------------------------------------------------
// Base64 encode/decode (pure, no Buffer dependency)
// ---------------------------------------------------------------------------

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  const len = bytes.length;

  while (i < len) {
    const b0 = bytes[i++] ?? 0;
    const b1 = bytes[i++] ?? 0;
    const b2 = bytes[i++] ?? 0;
    const have = Math.min(len - (i - 3), 3);

    out.push(BASE64_CHARS[b0 >> 2] ?? '');
    out.push(BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)] ?? '');
    out.push(have >= 2 ? (BASE64_CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] ?? '') : '=');
    out.push(have >= 3 ? (BASE64_CHARS[b2 & 0x3f] ?? '') : '=');
  }

  // Break into 76-char lines (MIME convention, aids readability)
  const full = out.join('');
  const lines: string[] = [];
  for (let pos = 0; pos < full.length; pos += 76) {
    lines.push(full.slice(pos, pos + 76));
  }
  return lines.join('\n');
}

function base64Decode(str: string): Uint8Array {
  // Remove all whitespace (newlines, spaces)
  const clean = str.replace(/\s/g, '');
  const len = clean.length;
  const outputLen =
    Math.floor((len * 3) / 4) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
  const out = new Uint8Array(outputLen);

  // Build reverse table
  const revTable = new Uint8Array(128).fill(0xff);
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    revTable[BASE64_CHARS.codePointAt(i) ?? 0] = i;
  }

  let outIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = revTable[clean.codePointAt(i) ?? 0] ?? 0;
    const c1 = revTable[clean.codePointAt(i + 1) ?? 0] ?? 0;
    const c2 = revTable[clean.codePointAt(i + 2) ?? 0] ?? 0;
    const c3 = revTable[clean.codePointAt(i + 3) ?? 0] ?? 0;

    if (outIdx < outputLen) out[outIdx++] = (c0 << 2) | (c1 >> 4);
    if (outIdx < outputLen) out[outIdx++] = ((c1 & 0xf) << 4) | (c2 >> 2);
    if (outIdx < outputLen) out[outIdx++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExportStoryHtmlMeta {
  title: string;
  author?: string | undefined;
}

export interface ExportStoryHtmlOptions {
  /** The pre-built player JavaScript bundle to inline. */
  playerRuntimeJs: string;
}

// ---------------------------------------------------------------------------
// Compile error
// ---------------------------------------------------------------------------

export class StoryExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoryExportError';
  }
}

// ---------------------------------------------------------------------------
// F583 — HTML export
// ---------------------------------------------------------------------------

/**
 * Compile `source` and produce a self-contained HTML document.
 *
 * The document embeds:
 *   - The compiled bytecode as base64 in `<script type="application/fable-bytecode" id="story">`
 *   - The provided `playerRuntimeJs` inline in a `<script>` tag
 *   - A `<div id="app">` shell for the player to mount into
 *
 * Throws `StoryExportError` if `source` fails to compile.
 */
export function exportStoryHtml(
  source: string,
  meta: ExportStoryHtmlMeta,
  opts: ExportStoryHtmlOptions,
): string {
  let bytecode: Uint8Array;
  try {
    bytecode = compileStory(source);
  } catch (e) {
    throw new StoryExportError(
      `Source did not compile: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const b64 = base64Encode(bytecode);
  const title = escHtml(meta.title);
  const authorLine =
    meta.author !== undefined ? `<meta name="author" content="${escHtml(meta.author)}">` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${authorLine}
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; line-height: 1.6; padding: 1rem; background: #fff; color: #111; }
#app { max-width: 640px; margin: 2rem auto; }
</style>
</head>
<body>
<div id="app"></div>
<script type="application/fable-bytecode" id="story">
${b64}
</script>
<script>
${opts.playerRuntimeJs}
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// F589 — extract embedded bytecode
// ---------------------------------------------------------------------------

/**
 * Extract the base64-encoded bytecode from an exported HTML document.
 * Returns the raw `Uint8Array` bytecode suitable for `deserializeProgram`.
 *
 * Used for integrity verification: the returned bytes must deserialize to the
 * same program fingerprint as the original source.
 */
export function extractEmbeddedProgram(html: string): Uint8Array {
  // Match content of <script type="application/fable-bytecode" id="story">...</script>
  const match = html.match(
    /<script[^>]*type="application\/fable-bytecode"[^>]*id="story"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) {
    throw new StoryExportError('No embedded fable-bytecode script tag found in HTML');
  }
  const b64 = (match[1] ?? '').trim();
  return base64Decode(b64);
}
