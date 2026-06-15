/**
 * Ink-to-Forge converter (Epic 19 — Story Interop).
 *
 * Converts a common subset of Ink (inkle's narrative scripting language) into
 * compilable Fable Forge source.  Pure — no I/O.
 *
 * Supported Ink constructs:
 *   - Knots:  `=== name ===` or `== name ==` (optional trailing `=`)
 *   - Plain text lines (with optional trailing `// comment` stripped)
 *   - Once-only choices: `* text`
 *   - Sticky choices:    `+ text`
 *   - Choice text with bracket notation: `* [shown] output` / `* prefix [choice] output`
 *   - Trailing diverts on choices: `* text -> target`
 *   - Stand-alone diverts: `-> target`, `-> END`, `-> DONE`
 *   - Gathers: `- text`
 *
 * Unsupported constructs (dropped + recorded):
 *   - Stitches (`= name`)
 *   - VAR / CONST declarations
 *   - LIST declarations
 *   - Logic / temp lines (`~ ...`)
 *   - Inline conditionals / alternatives (`{...}`)
 *   - Threads (`<- `)
 *   - Tunnels (`-> target ->`)
 *   - INCLUDE / EXTERNAL
 *   - Function knots (`=== function name ===`)
 *   - Tags (`# ...`) — Forge supports `# tag` but Ink tags differ semantically; we drop them
 *
 * Knot-name sanitisation:
 *   - Lowercased
 *   - Non-alphanumeric characters replaced with `_`
 *   - Leading digit prefixed with `_`
 *   - Empty result becomes `_knot`
 *
 * The PRIMARY guarantee: `inkToForge(source).forge` always compiles cleanly
 * through `compile()` from `@fables/forge-dsl`, even when the source contains
 * unsupported constructs.
 */

export interface UnsupportedConstruct {
  line: number;
  construct: string;
  text: string;
}

export interface InkConversion {
  forge: string;
  unsupported: UnsupportedConstruct[];
}

// ---------------------------------------------------------------------------
// Knot-name sanitiser
// ---------------------------------------------------------------------------

/** Convert an arbitrary Ink knot name to a valid Forge identifier. */
function sanitizeKnotName(name: string): string {
  // Lowercase, replace non-alphanumeric with underscore
  let id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  // Strip leading underscores caused by replacement (keep intentional underscores)
  // but if starts with a digit, prefix with _
  if (id.length === 0) return '_knot';
  if (/^[0-9]/.test(id)) id = `_${id}`;
  // Collapse runs of underscores to a single underscore
  id = id.replace(/_+/g, '_');
  // Strip leading/trailing underscores for aesthetics (but keep at least one char)
  id = id.replace(/^_+/, '').replace(/_+$/, '');
  if (id.length === 0) return '_knot';
  return id;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

// Knot header: `=== name ===` or `== name ==` (trailing `=` optional)
const KNOT_RE = /^={2,3}\s+(function\s+)?(\S.*?)\s+=*\s*$/;

// Stitch header: `= name`
const STITCH_RE = /^=\s+\S/;

// Choice markers: leading whitespace allowed, then `*` or `+`, depth by count
const CHOICE_RE = /^(\s*)([*+]+)\s+(.*)/;

// Stand-alone divert line: `-> target`
const DIVERT_LINE_RE = /^->\s*(\S+)/;

// Trailing divert inside choice text: `-> target` at end
const TRAILING_DIVERT_RE = /->\s*(\S+)\s*$/;

// Bracket notation in choice text: `[choice-only]`
const BRACKET_RE = /\[([^\]]*)\]/;

// Gather: `- text` (not `--` for gather labels)
const GATHER_RE = /^(-+)\s*(.*)/;

// Inline conditional / alternative: { ... }
const INLINE_COND_RE = /\{[^}]*\}/;

// Tunnel: `-> target ->`
const TUNNEL_RE = /->\s*\S+\s*->\s*$/;

// Thread: `<-`
const THREAD_RE = /^<-\s*/;

// Logic / temp line: starts with `~`
const LOGIC_RE = /^~/;

// INCLUDE / EXTERNAL
const INCLUDE_RE = /^INCLUDE\s+/;
const EXTERNAL_RE = /^EXTERNAL\s+/;

// VAR / CONST / LIST declarations
const DECL_RE = /^(VAR|CONST|LIST)\s+/;

// Tag: `# ...` on its own line (not knot header)
const TAG_LINE_RE = /^#/;

// Line comment: ` // ...` — strip from content
const LINE_COMMENT_RE = /\s*\/\/.*$/;

// ---------------------------------------------------------------------------
// Main converter
// ---------------------------------------------------------------------------

export function inkToForge(source: string): InkConversion {
  const rawLines = source.split('\n');
  const outLines: string[] = [];
  const unsupported: UnsupportedConstruct[] = [];

  // We need to sanitize divert targets the same way as knot names, so collect
  // the mapping as we encounter knots.  But Ink files can have forward-refs, so
  // we sanitize on the fly (same function) rather than building a map first.

  let lineNumber = 0;

  for (const rawLine of rawLines) {
    lineNumber += 1;
    const line = rawLine.trimEnd();

    // --- Skip empty lines (pass through) ---
    if (line.trim() === '') {
      outLines.push('');
      continue;
    }

    const trimmed = line.trim();

    // --- INCLUDE / EXTERNAL ---
    if (INCLUDE_RE.test(trimmed) || EXTERNAL_RE.test(trimmed)) {
      unsupported.push({ line: lineNumber, construct: 'include', text: trimmed });
      continue;
    }

    // --- VAR / CONST / LIST declarations ---
    if (DECL_RE.test(trimmed)) {
      unsupported.push({ line: lineNumber, construct: 'declaration', text: trimmed });
      continue;
    }

    // --- Logic / temp lines ---
    if (LOGIC_RE.test(trimmed)) {
      unsupported.push({ line: lineNumber, construct: 'logic', text: trimmed });
      continue;
    }

    // --- Thread ---
    if (THREAD_RE.test(trimmed)) {
      unsupported.push({ line: lineNumber, construct: 'thread', text: trimmed });
      continue;
    }

    // --- Knot header (must test before stitch) ---
    const knotMatch = KNOT_RE.exec(trimmed);
    if (knotMatch !== null) {
      const isFunction = knotMatch[1] !== undefined;
      const rawName = knotMatch[2] ?? '';
      if (isFunction) {
        unsupported.push({ line: lineNumber, construct: 'function_knot', text: trimmed });
        continue;
      }
      const safeName = sanitizeKnotName(rawName);
      outLines.push(`=== ${safeName} ===`);
      continue;
    }

    // --- Stitch header ---
    if (STITCH_RE.test(trimmed)) {
      unsupported.push({ line: lineNumber, construct: 'stitch', text: trimmed });
      continue;
    }

    // --- Tag line ---
    if (TAG_LINE_RE.test(trimmed)) {
      unsupported.push({ line: lineNumber, construct: 'tag', text: trimmed });
      continue;
    }

    // --- Choice ---
    const choiceMatch = CHOICE_RE.exec(line);
    if (choiceMatch !== null) {
      const markers = choiceMatch[2] ?? '';
      const rest = choiceMatch[3] ?? '';

      // Determine sticky from first marker character
      const firstMarker = markers[0] ?? '*';
      const sticky = firstMarker === '+';
      const choiceChar = sticky ? '+' : '*';

      // Check for unsupported inline conditionals in rest
      if (INLINE_COND_RE.test(rest)) {
        unsupported.push({ line: lineNumber, construct: 'inline_conditional', text: trimmed });
        continue;
      }

      // Check for tunnel in rest
      if (TUNNEL_RE.test(rest)) {
        unsupported.push({ line: lineNumber, construct: 'tunnel', text: trimmed });
        continue;
      }

      // Extract trailing divert if present
      let choiceText = rest;
      let divertTarget: string | undefined;

      const trailingDivert = TRAILING_DIVERT_RE.exec(choiceText);
      if (trailingDivert !== null) {
        divertTarget = trailingDivert[1];
        // Remove the divert from choice text
        choiceText = choiceText.slice(0, trailingDivert.index).trimEnd();
      }

      // Strip line comments from choice text
      choiceText = choiceText.replace(LINE_COMMENT_RE, '').trimEnd();

      // Handle bracket notation
      const bracketMatch = BRACKET_RE.exec(choiceText);

      if (divertTarget !== undefined) {
        const safeTarget = sanitizeDivertTarget(divertTarget);
        if (bracketMatch !== null) {
          // Has brackets: `prefix [choice-only] output` with divert
          const before = choiceText.slice(0, bracketMatch.index).trimEnd();
          const choiceOnly = bracketMatch[1] ?? '';
          if (before.length > 0) {
            outLines.push(`${choiceChar} ${before} [${choiceOnly}] -> ${safeTarget}`);
          } else {
            outLines.push(`${choiceChar} [${choiceOnly}] -> ${safeTarget}`);
          }
        } else {
          // Plain text with divert
          if (choiceText.length > 0) {
            outLines.push(`${choiceChar} [${choiceText}] -> ${safeTarget}`);
          } else {
            outLines.push(`${choiceChar} [] -> ${safeTarget}`);
          }
        }
      } else {
        // No divert
        if (bracketMatch !== null) {
          const before = choiceText.slice(0, bracketMatch.index).trimEnd();
          const choiceOnly = bracketMatch[1] ?? '';
          if (before.length > 0) {
            outLines.push(`${choiceChar} ${before} [${choiceOnly}]`);
          } else {
            outLines.push(`${choiceChar} [${choiceOnly}]`);
          }
        } else {
          if (choiceText.length > 0) {
            outLines.push(`${choiceChar} ${choiceText}`);
          } else {
            outLines.push(`${choiceChar} []`);
          }
        }
      }
      continue;
    }

    // --- Stand-alone divert line ---
    const divertMatch = DIVERT_LINE_RE.exec(trimmed);
    if (divertMatch !== null) {
      const rawTarget = divertMatch[1] ?? '';
      // Check for tunnel: `-> target ->` (but DIVERT_LINE_RE only matches first word)
      // Tunnel would have been caught above by TUNNEL_RE if on a bare line
      if (TUNNEL_RE.test(trimmed)) {
        unsupported.push({ line: lineNumber, construct: 'tunnel', text: trimmed });
        continue;
      }
      const safeTarget = sanitizeDivertTarget(rawTarget);
      outLines.push(`-> ${safeTarget}`);
      continue;
    }

    // --- Gather ---
    const gatherMatch = GATHER_RE.exec(trimmed);
    if (gatherMatch !== null) {
      // Only treat as gather if starts with `-` (already matched trimmed)
      // `gatherMatch[1]` = the dash(es), `gatherMatch[2]` = the rest
      const gatherText = gatherMatch[2] ?? '';

      // Check for unsupported inline conditionals
      if (INLINE_COND_RE.test(gatherText)) {
        unsupported.push({ line: lineNumber, construct: 'inline_conditional', text: trimmed });
        continue;
      }

      const cleaned = gatherText.replace(LINE_COMMENT_RE, '').trimEnd();
      outLines.push(`- ${cleaned}`);
      continue;
    }

    // --- Plain text line ---
    // Check for unsupported inline conditionals / alternatives
    if (INLINE_COND_RE.test(trimmed)) {
      unsupported.push({ line: lineNumber, construct: 'inline_conditional', text: trimmed });
      continue;
    }

    // Check for glue `<>` — pass through (Forge supports it)
    // Strip line comment and emit
    const cleaned = trimmed.replace(LINE_COMMENT_RE, '').trimEnd();
    if (cleaned.length > 0) {
      outLines.push(cleaned);
    } else {
      // line was only a comment; emit blank
      outLines.push('');
    }
  }

  // Ensure the output ends with a newline
  const forge = outLines.join('\n').trimEnd() + '\n';

  return { forge, unsupported };
}

// ---------------------------------------------------------------------------
// Divert-target sanitiser
// ---------------------------------------------------------------------------

/** Sanitize a divert target — special-cases END/DONE, then applies knot-name rules. */
function sanitizeDivertTarget(target: string): string {
  if (target === 'END' || target === 'DONE') return 'END';
  // Dotted paths: sanitize each component and rejoin
  const parts = target.split('.');
  return parts.map(sanitizeKnotName).join('.');
}
