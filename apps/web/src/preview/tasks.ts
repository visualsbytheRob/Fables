/** Task-list source editing (F134): flip `- [ ]` / `- [x]` on a 1-based source line. */

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;

export function isTaskLine(text: string): boolean {
  return TASK_RE.test(text);
}

/** Toggle the checkbox on `line` (1-based, as reported by the renderer). */
export function toggleTaskAtLine(source: string, line: number): string {
  const lines = source.split('\n');
  const text = lines[line - 1];
  if (text === undefined) return source;
  const match = TASK_RE.exec(text);
  if (!match) return source;
  const next = match[2] === ' ' ? '[x]' : '[ ]';
  lines[line - 1] = text.replace(TASK_RE, `$1${next}`);
  return lines.join('\n');
}
