/**
 * Changelog generation from commit history (F995).
 *
 * Parses Conventional-Commit subject lines into grouped, human-readable
 * changelog sections. Pure: the git plumbing lives in the script wrapper
 * (`scripts/gen-changelog.mjs`); this turns raw subject lines into markdown so
 * the grouping is unit-testable.
 */

export interface ParsedCommit {
  type: string;
  scope: string | null;
  subject: string;
  breaking: boolean;
}

const SUBJECT_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

/** Parse one Conventional-Commit subject; null when it doesn't match. */
export function parseCommit(line: string): ParsedCommit | null {
  const m = SUBJECT_RE.exec(line.trim());
  if (!m) return null;
  return {
    type: m[1]!.toLowerCase(),
    scope: m[2] ?? null,
    subject: m[4]!.trim(),
    breaking: m[3] === '!',
  };
}

const SECTION_TITLES: Record<string, string> = {
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  refactor: 'Refactoring',
  docs: 'Documentation',
  test: 'Tests',
  build: 'Build & Tooling',
  ci: 'CI',
  chore: 'Chores',
};

const SECTION_ORDER = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore'];

export interface ChangelogSection {
  type: string;
  title: string;
  entries: ParsedCommit[];
}

export interface GroupedChangelog {
  breaking: ParsedCommit[];
  sections: ChangelogSection[];
  skipped: number;
}

/** Group parsed commit subjects into ordered changelog sections. */
export function groupCommits(lines: string[]): GroupedChangelog {
  const byType = new Map<string, ParsedCommit[]>();
  const breaking: ParsedCommit[] = [];
  let skipped = 0;

  for (const line of lines) {
    const parsed = parseCommit(line);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    if (parsed.breaking) breaking.push(parsed);
    const bucket = byType.get(parsed.type);
    if (bucket) bucket.push(parsed);
    else byType.set(parsed.type, [parsed]);
  }

  const sections: ChangelogSection[] = [];
  const seen = new Set<string>();
  for (const type of SECTION_ORDER) {
    const entries = byType.get(type);
    if (entries && entries.length > 0) {
      sections.push({ type, title: SECTION_TITLES[type] ?? type, entries });
      seen.add(type);
    }
  }
  // Any unknown types last, alphabetically.
  for (const type of [...byType.keys()].filter((t) => !seen.has(t)).sort()) {
    sections.push({ type, title: SECTION_TITLES[type] ?? type, entries: byType.get(type)! });
  }

  return { breaking, sections, skipped };
}

/** Render a grouped changelog as markdown under a version heading. */
export function renderChangelog(version: string, lines: string[]): string {
  const grouped = groupCommits(lines);
  const out: string[] = [`## ${version}`, ''];

  if (grouped.breaking.length > 0) {
    out.push('### ⚠ BREAKING CHANGES', '');
    for (const c of grouped.breaking) out.push(`- ${entryLine(c)}`);
    out.push('');
  }

  for (const section of grouped.sections) {
    out.push(`### ${section.title}`, '');
    for (const c of section.entries) out.push(`- ${entryLine(c)}`);
    out.push('');
  }

  return out.join('\n').trimEnd() + '\n';
}

function entryLine(c: ParsedCommit): string {
  return c.scope ? `**${c.scope}:** ${c.subject}` : c.subject;
}
