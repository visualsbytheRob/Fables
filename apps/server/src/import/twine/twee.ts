/**
 * Twee 3 to Forge converter (Epic 19 - Story Interop).
 *
 * Converts a Twine Twee 3 source file into compilable Fable Forge source.
 * Pure - no I/O.
 *
 * Twee 3 format:
 *   Passages begin with `:: PassageName [optional tags] {optional metadata}`
 *   Special passages: StoryTitle, StoryData (JSON with `start` field),
 *   StoryStylesheet, StoryScript - these are not emitted as knots.
 *
 * Link forms supported:
 *   [[Target]]                -> target only
 *   [[Display->Target]]       -> arrow right
 *   [[Display|Target]]        -> pipe separator
 *   [[Target<-Display]]       -> arrow left
 *
 * Macros <<...>> and Harlowe hooks (macro:) are dropped and reported.
 *
 * Primary guarantee: the returned `forge` string ALWAYS compiles cleanly.
 * Dangling link targets are resolved by emitting stub knots: `=== name ===\n-> END`.
 *
 * Knot name sanitisation:
 *   - Lowercase
 *   - Non-alphanumeric characters replaced with `_`
 *   - Leading digit prefixed with `_`
 *   - Collisions resolved with `_2`, `_3`, etc.
 *   - Empty result becomes `_passage`
 */

export interface TweeConversion {
  forge: string;
  start: string | null;
  passages: string[];
  unsupported: { passage: string; macro: string }[];
}

// ---------------------------------------------------------------------------
// Special passage names to skip (never emit as knots)
// ---------------------------------------------------------------------------

const SKIP_PASSAGES = new Set([
  'StoryTitle',
  'StoryData',
  'StoryStylesheet',
  'StoryScript',
  'StoryMenu',
  'StorySettings',
  'StoryShare',
  'StoryCaption',
  'StoryBanner',
  'StorySubtitle',
  'StoryAuthor',
  'PassageHeader',
  'PassageFooter',
  'PassageDone',
  'PassageReady',
]);

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

// Passage header: `:: PassageName [tags] {metadata}`
const PASSAGE_RE = /^::\s+(.*?)(?:\s+\[.*?\])?(?:\s+\{.*?\})?\s*$/;

// Any [[...]] link
const LINK_RE = /\[\[([^\]]+)\]\]/g;

// SugarCube/Harlowe macros: <<...>>
const MACRO_RE = /<<[^>]*>>|<<[^>]*>>[^<]*<</g;

// Harlowe-style hooks: (macroname: ...) forms - conservative match
const HARLOWE_RE = /\([a-z-]+:\s*[^)]*\)/g;

// ---------------------------------------------------------------------------
// Sanitise a passage name into a valid Forge knot identifier
// ---------------------------------------------------------------------------

function sanitizePassageName(name: string): string {
  let id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (id.length === 0) return '_passage';
  if (/^[0-9]/.test(id)) id = `_${id}`;
  // Collapse multiple underscores
  id = id.replace(/_+/g, '_');
  // Strip trailing underscores
  id = id.replace(/_+$/, '');
  if (id.length === 0) return '_passage';
  return id;
}

// ---------------------------------------------------------------------------
// Parse Twee link syntax, return { display, target }
// ---------------------------------------------------------------------------

interface ParsedLink {
  display: string;
  target: string;
}

function parseTweeLink(inner: string): ParsedLink {
  // [[Display->Target]]
  const arrowRight = inner.indexOf('->');
  if (arrowRight !== -1) {
    const display = inner.slice(0, arrowRight).trim();
    const target = inner.slice(arrowRight + 2).trim();
    return { display: display.length > 0 ? display : target, target };
  }
  // [[Target<-Display]]
  const arrowLeft = inner.indexOf('<-');
  if (arrowLeft !== -1) {
    const target = inner.slice(0, arrowLeft).trim();
    const display = inner.slice(arrowLeft + 2).trim();
    return { display: display.length > 0 ? display : target, target };
  }
  // [[Display|Target]]
  const pipe = inner.indexOf('|');
  if (pipe !== -1) {
    const display = inner.slice(0, pipe).trim();
    const target = inner.slice(pipe + 1).trim();
    return { display: display.length > 0 ? display : target, target };
  }
  // [[Target]] - no separator
  return { display: inner.trim(), target: inner.trim() };
}

// ---------------------------------------------------------------------------
// Raw passage data after first parse
// ---------------------------------------------------------------------------

interface RawPassage {
  name: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Parsed passage (after link extraction)
// ---------------------------------------------------------------------------

interface ParsedPassage {
  originalName: string;
  sanitizedName: string;
  textLines: string[];
  links: ParsedLink[];
  macros: string[];
}

// ---------------------------------------------------------------------------
// Main converter
// ---------------------------------------------------------------------------

export function tweeToForge(source: string): TweeConversion {
  // ---- Step 1: Split into raw passages ----
  const rawPassages = splitPassages(source);

  // ---- Step 2: Extract StoryData for start passage ----
  let storyDataStart: string | null = null;
  for (const rp of rawPassages) {
    if (rp.name === 'StoryData') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json = JSON.parse(rp.body.trim()) as Record<string, any>;
        if (typeof json['start'] === 'string' && json['start'].length > 0) {
          storyDataStart = json['start'] as string;
        }
      } catch {
        // Invalid JSON - ignore
      }
      break;
    }
  }

  // ---- Step 3: Filter to content passages (skip special) ----
  const contentPassages = rawPassages.filter((rp) => !SKIP_PASSAGES.has(rp.name));

  // ---- Step 4: Build name -> sanitized mapping with de-duplication ----
  const nameMap = new Map<string, string>();
  const usedIds = new Set<string>();

  for (const rp of contentPassages) {
    const base = sanitizePassageName(rp.name);
    let id = base;
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(`${base}_${n}`)) {
        n++;
      }
      id = `${base}_${n}`;
    }
    usedIds.add(id);
    nameMap.set(rp.name, id);
  }

  // ---- Step 5: Determine start knot name ----
  let startKnotName: string | null = null;
  if (storyDataStart !== null) {
    // Try exact match first, then sanitized match
    const direct = nameMap.get(storyDataStart);
    if (direct !== undefined) {
      startKnotName = direct;
    } else {
      // Try to find by sanitized name match
      const sanitized = sanitizePassageName(storyDataStart);
      for (const [, id] of nameMap) {
        if (id === sanitized) {
          startKnotName = id;
          break;
        }
      }
    }
  }
  if (startKnotName === null && contentPassages.length > 0) {
    // Use first passage or one named "Start"
    const startPassage = contentPassages.find((p) => p.name === 'Start') ?? contentPassages[0];
    if (startPassage !== undefined) {
      startKnotName = nameMap.get(startPassage.name) ?? null;
    }
  }

  // ---- Step 6: Parse each passage body ----
  const parsed: ParsedPassage[] = [];
  const allUnsupported: { passage: string; macro: string }[] = [];

  for (const rp of contentPassages) {
    const sanitizedName = nameMap.get(rp.name) ?? sanitizePassageName(rp.name);
    const { textLines, links, macros } = parsePassageBody(rp.body);

    for (const macro of macros) {
      allUnsupported.push({ passage: rp.name, macro });
    }

    parsed.push({
      originalName: rp.name,
      sanitizedName,
      textLines,
      links,
      macros,
    });
  }

  // ---- Step 7: Collect all link targets, find dangling ones ----
  const allLinkTargets = new Set<string>();
  for (const p of parsed) {
    for (const link of p.links) {
      const sanitizedTarget = resolveTarget(link.target, nameMap);
      allLinkTargets.add(sanitizedTarget);
    }
  }

  const definedKnots = new Set(nameMap.values());
  const danglingTargets = new Set<string>();
  for (const target of allLinkTargets) {
    if (target !== 'END' && !definedKnots.has(target)) {
      danglingTargets.add(target);
    }
  }

  // ---- Step 8: Reorder so start passage comes first ----
  let orderedPassages = [...parsed];
  if (startKnotName !== null) {
    const startIdx = orderedPassages.findIndex((p) => p.sanitizedName === startKnotName);
    if (startIdx > 0) {
      const [startPassage] = orderedPassages.splice(startIdx, 1);
      if (startPassage !== undefined) {
        orderedPassages = [startPassage, ...orderedPassages];
      }
    }
  }

  // ---- Step 9: Emit Forge source ----
  const outLines: string[] = [];

  for (const p of orderedPassages) {
    outLines.push(`=== ${p.sanitizedName} ===`);

    // Emit text lines
    for (const line of p.textLines) {
      if (line.length > 0) {
        outLines.push(line);
      }
    }

    if (p.links.length > 0) {
      // Emit choices for each link
      for (const link of p.links) {
        const target = resolveTarget(link.target, nameMap);
        const display = link.display.length > 0 ? link.display : link.target;
        // Sanitize display text for Forge (strip characters that break parsing)
        const safeDisplay = sanitizeDisplayText(display);
        outLines.push(`+ [${safeDisplay}] -> ${target}`);
      }
    } else {
      // No links: end with -> END
      outLines.push('-> END');
    }
  }

  // ---- Step 10: Emit stub knots for dangling targets ----
  for (const target of danglingTargets) {
    outLines.push(`=== ${target} ===`);
    outLines.push('-> END');
  }

  // Handle empty input
  if (outLines.length === 0) {
    outLines.push('=== start ===');
    outLines.push('-> END');
  }

  const forge = outLines.join('\n') + '\n';

  return {
    forge,
    start: startKnotName,
    passages: orderedPassages.map((p) => p.sanitizedName),
    unsupported: allUnsupported,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split Twee 3 source into raw passages. */
function splitPassages(source: string): RawPassage[] {
  const lines = source.split('\n');
  const passages: RawPassage[] = [];
  let currentName: string | null = null;
  const bodyLines: string[] = [];

  for (const line of lines) {
    const passageMatch = PASSAGE_RE.exec(line);
    if (passageMatch !== null) {
      // Save previous passage
      if (currentName !== null) {
        passages.push({ name: currentName, body: bodyLines.join('\n') });
      }
      currentName = (passageMatch[1] ?? '').trim();
      bodyLines.length = 0;
    } else if (currentName !== null) {
      bodyLines.push(line);
    }
  }

  // Save last passage
  if (currentName !== null) {
    passages.push({ name: currentName, body: bodyLines.join('\n') });
  }

  return passages;
}

/** Parse a passage body: extract text lines, links, and macros. */
function parsePassageBody(body: string): {
  textLines: string[];
  links: ParsedLink[];
  macros: string[];
} {
  const textLines: string[] = [];
  const links: ParsedLink[] = [];
  const macros: string[] = [];

  const lines = body.split('\n');

  for (const rawLine of lines) {
    let line = rawLine.trimEnd();

    // Extract all macros <<...>> first
    const macroMatches = line.match(MACRO_RE);
    if (macroMatches !== null) {
      for (const m of macroMatches) {
        macros.push(m);
      }
      // Remove macros from the line
      line = line.replace(MACRO_RE, '').trim();
    }

    // Extract Harlowe-style hooks (macro:) patterns
    const harloweMatches = line.match(HARLOWE_RE);
    if (harloweMatches !== null) {
      for (const m of harloweMatches) {
        macros.push(m);
      }
      line = line.replace(HARLOWE_RE, '').trim();
    }

    // Extract all [[links]] from the line
    const linkMatches: ParsedLink[] = [];
    let match: RegExpExecArray | null;
    LINK_RE.lastIndex = 0;
    while ((match = LINK_RE.exec(line)) !== null) {
      const inner = match[1] ?? '';
      linkMatches.push(parseTweeLink(inner));
    }

    if (linkMatches.length > 0) {
      for (const lk of linkMatches) {
        links.push(lk);
      }
      // Remove link tokens from line text
      const cleanedLine = line.replace(LINK_RE, '').trim();
      if (cleanedLine.length > 0) {
        textLines.push(cleanedLine);
      }
    } else {
      // Plain text line (after macro stripping)
      if (line.trim().length > 0) {
        textLines.push(line.trim());
      }
    }
  }

  return { textLines, links, macros };
}

/** Resolve a link target to a sanitized knot name or END. */
function resolveTarget(target: string, nameMap: Map<string, string>): string {
  if (target === 'END' || target === 'DONE') return 'END';
  // Try exact match (original name)
  const direct = nameMap.get(target);
  if (direct !== undefined) return direct;
  // Try sanitized form
  return sanitizePassageName(target);
}

/** Sanitize display text so it doesn't break Forge choice syntax. */
function sanitizeDisplayText(text: string): string {
  // Remove characters that break Forge: brackets, braces, angle brackets used in markup
  // Keep alphanumeric, spaces, punctuation that is safe
  return text
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '')
    .replace(/\}/g, '')
    .replace(/~/g, '')
    .trim();
}
