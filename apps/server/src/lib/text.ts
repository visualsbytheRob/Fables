/** Whitespace-delimited word count — the same definition the editor status bar uses. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** UTF-16 code-unit count, matching `String.prototype.length` everywhere else. */
export function charCount(text: string): number {
  return text.length;
}
