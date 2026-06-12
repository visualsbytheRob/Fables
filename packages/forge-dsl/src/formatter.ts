import type { KnotNode, StoryNode } from './ast.js';
import type { Diagnostic } from './diagnostics.js';
import { parse } from './parser.js';
import type { PrintOptions } from './printer.js';
import { printStory } from './printer.js';

/**
 * The Forge formatter (F371–F380): canonical formatting straight from the AST
 * printer. Sources with syntax errors are returned untouched — a formatter
 * must never destroy code it cannot fully understand.
 */

export type FormatConfig = PrintOptions;

export interface FormatResult {
  readonly formatted: string;
  readonly changed: boolean;
  /** Parse diagnostics. When any are errors, `formatted === source`. */
  readonly diagnostics: readonly Diagnostic[];
}

export function format(source: string, config: FormatConfig = {}): FormatResult {
  const { story, diagnostics } = parse(source);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { formatted: source, changed: false, diagnostics };
  }
  const formatted = printStory(story, config);
  return { formatted, changed: formatted !== source, diagnostics };
}

/** `--check` mode for CI (F377): true when the source is already canonical. */
export function checkFormatted(source: string, config: FormatConfig = {}): boolean {
  return !format(source, config).changed;
}

export interface FormatRange {
  /** 1-based, inclusive. */
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Range formatting (F376): the range is snapped outward to whole top-level
 * sections (the header region and each knot), which are reformatted in place.
 * Everything outside stays byte-identical.
 */
export function formatRange(source: string, range: FormatRange, config: FormatConfig = {}): FormatResult {
  const { story, diagnostics } = parse(source);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { formatted: source, changed: false, diagnostics };
  }
  const lines = source.split('\n');
  const sections = splitSections(story, lines.length);
  const out: string[] = [];
  for (const section of sections) {
    const overlaps = section.startLine <= range.endLine && section.endLine >= range.startLine;
    if (!overlaps) {
      out.push(...lines.slice(section.startLine - 1, section.endLine));
      continue;
    }
    const printed = printSection(story, section.knot, config);
    if (section.knot !== undefined && out.length > 0 && out[out.length - 1] !== '') out.push('');
    out.push(...printed);
  }
  let formatted = out.join('\n');
  if (!formatted.endsWith('\n') && formatted.length > 0) formatted += '\n';
  return { formatted, changed: formatted !== source, diagnostics };
}

interface Section {
  readonly startLine: number;
  readonly endLine: number;
  /** undefined = the header/preamble section. */
  readonly knot: KnotNode | undefined;
}

function splitSections(story: StoryNode, totalLines: number): Section[] {
  const sections: Section[] = [];
  const firstKnot = story.knots[0];
  const headerEnd = firstKnot !== undefined ? startLineOf(firstKnot) - 1 : totalLines;
  if (headerEnd >= 1) sections.push({ startLine: 1, endLine: headerEnd, knot: undefined });
  for (let i = 0; i < story.knots.length; i++) {
    const knot = story.knots[i] as KnotNode;
    const next = story.knots[i + 1];
    const endLine = next !== undefined ? startLineOf(next) - 1 : totalLines;
    sections.push({ startLine: startLineOf(knot), endLine, knot });
  }
  return sections;
}

function startLineOf(knot: KnotNode): number {
  const lead = knot.leadingComments?.[0];
  return lead !== undefined ? lead.span.start.line : knot.span.start.line;
}

function printSection(story: StoryNode, knot: KnotNode | undefined, config: FormatConfig): string[] {
  if (knot === undefined) {
    const headerOnly: StoryNode = { ...story, knots: [] };
    delete headerOnly.leadingComments;
    const text = printStory(headerOnly, config);
    return trimTrailingBlank(text.split('\n'));
  }
  const knotOnly: StoryNode = {
    ...story,
    headerTags: [],
    includes: [],
    declarations: [],
    preamble: { kind: 'Block', span: story.preamble.span, items: [] },
    knots: [knot],
  };
  delete knotOnly.leadingComments;
  const text = printStory(knotOnly, config);
  return trimTrailingBlank(text.split('\n'));
}

function trimTrailingBlank(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}
