/**
 * Pure helpers that merge a Claude suggestion into note content. Every AI action
 * is *advisory*: applying it is an ordinary edit to the note's title/body, which
 * keeps it fully undoable and clearly attributed to the user (server F1339). These
 * functions are pure so the merge behaviour is exhaustively testable without React.
 */

import type { AiLinkSuggestion, MeetingAction } from '../api/client.js';

/** Prepend a titled markdown block to a body, with tidy spacing. */
export function prependBlock(body: string, heading: string, content: string): string {
  const block = `## ${heading}\n\n${content.trim()}`;
  const trimmed = body.trim();
  return trimmed.length === 0 ? `${block}\n` : `${block}\n\n${trimmed}\n`;
}

/** Insert an AI summary as a block at the top of the note. */
export function applySummary(body: string, summary: string): string {
  return prependBlock(body, 'Summary', summary);
}

/** Insert a generated outline as a block at the top of the note. */
export function applyOutline(body: string, outline: string): string {
  return prependBlock(body, 'Outline', outline);
}

/** Normalise a free-text tag into a `#tag` token: trim `#`, lowercase, hyphenate. */
export function toTagToken(raw: string): string {
  const slug = raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}

/** Tag tokens already present in the body (lowercased, without `#`). */
export function existingTags(body: string): Set<string> {
  const found = new Set<string>();
  for (const m of body.matchAll(/#([\p{L}\p{N}_-]+)/gu)) {
    found.add(m[1]!.toLowerCase());
  }
  return found;
}

/**
 * Append suggested tags to the body as `#tag` tokens (tags are derived from
 * hashtags in note bodies), skipping any already present and any that normalise
 * to empty. Returns the body unchanged when nothing new would be added.
 */
export function applyTags(body: string, tags: string[]): string {
  const have = existingTags(body);
  const seen = new Set<string>();
  const toAdd: string[] = [];
  for (const t of tags) {
    const token = toTagToken(t);
    if (token.length === 0 || have.has(token) || seen.has(token)) continue;
    seen.add(token);
    toAdd.push(`#${token}`);
  }
  if (toAdd.length === 0) return body;
  const trimmed = body.replace(/\s+$/, '');
  const line = toAdd.join(' ');
  return trimmed.length === 0 ? `${line}\n` : `${trimmed}\n\n${line}\n`;
}

/** Render structured meeting output (summary, decisions, actions) as markdown. */
export function structureToMarkdown(s: {
  summary: string;
  decisions: string[];
  actions: MeetingAction[];
}): string {
  const parts: string[] = [`## Summary\n\n${s.summary.trim()}`];
  if (s.decisions.length > 0) {
    parts.push(`## Decisions\n\n${s.decisions.map((d) => `- ${d}`).join('\n')}`);
  }
  if (s.actions.length > 0) {
    const items = s.actions
      .map((a) => `- [ ] ${a.task}${a.owner.trim() ? ` — ${a.owner.trim()}` : ''}`)
      .join('\n');
    parts.push(`## Action items\n\n${items}`);
  }
  return parts.join('\n\n');
}

/** Prepend a structured-meeting block to the note. */
export function applyStructure(
  body: string,
  s: { summary: string; decisions: string[]; actions: MeetingAction[] },
): string {
  const block = structureToMarkdown(s);
  const trimmed = body.trim();
  return trimmed.length === 0 ? `${block}\n` : `${block}\n\n${trimmed}\n`;
}

/** A `**Related:** [[a]] · [[b]]` footer from link suggestions (deduped by target). */
export function linksFooter(links: AiLinkSuggestion[]): string {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const l of links) {
    const key = l.target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(`[[${l.target}]]`);
  }
  return targets.length === 0 ? '' : `**Related:** ${targets.join(' · ')}`;
}

/** Append a related-links footer to the body (no-op when there are no links). */
export function applyLinks(body: string, links: AiLinkSuggestion[]): string {
  const footer = linksFooter(links);
  if (footer.length === 0) return body;
  const trimmed = body.replace(/\s+$/, '');
  return trimmed.length === 0 ? `${footer}\n` : `${trimmed}\n\n${footer}\n`;
}
