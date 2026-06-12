/**
 * Template variable engine (F262/F263).
 *
 * Supported: {{date}}, {{time}}, {{title}}, {{cursor}}, {{prompt:Name}}.
 * `\{{date}}` escapes to the literal `{{date}}`. Unknown variables are left
 * intact so templates degrade gracefully. {{cursor}} is removed and its
 * offset (in the rendered text) reported so callers can place the caret.
 */

export interface TemplateContext {
  /** Clock for {{date}}/{{time}}; defaults to now. */
  now?: Date;
  /** Value for {{title}}. */
  title?: string;
  /** Answers for {{prompt:Name}} variables, keyed by name. */
  prompts?: Record<string, string>;
}

export interface RenderedTemplate {
  text: string;
  /** Offset of the first {{cursor}} in `text`, or null. */
  cursorOffset: number | null;
}

const VAR_RE = /\\?\{\{([^{}\n]+)\}\}/g;

const pad = (n: number): string => String(n).padStart(2, '0');

export const formatDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const formatTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Unique {{prompt:Name}} names in order of first appearance. */
export function extractPromptVars(template: string): string[] {
  const names: string[] = [];
  VAR_RE.lastIndex = 0;
  for (let m = VAR_RE.exec(template); m !== null; m = VAR_RE.exec(template)) {
    if (m[0].startsWith('\\')) continue;
    const inner = m[1]!.trim();
    if (!inner.toLowerCase().startsWith('prompt:')) continue;
    const name = inner.slice('prompt:'.length).trim();
    if (name !== '' && !names.includes(name)) names.push(name);
  }
  return names;
}

export function renderTemplate(template: string, ctx: TemplateContext = {}): RenderedTemplate {
  const now = ctx.now ?? new Date();
  let out = '';
  let last = 0;
  let cursorOffset: number | null = null;

  VAR_RE.lastIndex = 0;
  for (let m = VAR_RE.exec(template); m !== null; m = VAR_RE.exec(template)) {
    out += template.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0].startsWith('\\')) {
      // Escaped: drop the backslash, keep the braces literally.
      out += m[0].slice(1);
      continue;
    }
    const inner = m[1]!.trim();
    const lower = inner.toLowerCase();
    if (lower === 'date') {
      out += formatDate(now);
    } else if (lower === 'time') {
      out += formatTime(now);
    } else if (lower === 'title') {
      out += ctx.title ?? '';
    } else if (lower === 'cursor') {
      if (cursorOffset === null) cursorOffset = out.length;
      // removed from output
    } else if (lower.startsWith('prompt:')) {
      const name = inner.slice(inner.indexOf(':') + 1).trim();
      const value = ctx.prompts?.[name];
      out += value !== undefined ? value : m[0];
    } else {
      out += m[0]; // unknown variable: left intact
    }
  }
  out += template.slice(last);
  return { text: out, cursorOffset };
}
