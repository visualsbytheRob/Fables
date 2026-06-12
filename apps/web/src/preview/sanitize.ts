/**
 * Sanitization schema for the markdown → HTML pipeline (F131).
 *
 * We never enable rehype-raw, so raw HTML in notes is already rendered inert
 * as text; rehype-sanitize is defense-in-depth and the place where we state
 * exactly what the GFM + math pipeline is allowed to emit.
 */
import { defaultSchema } from 'rehype-sanitize';
import type { Options as Schema } from 'rehype-sanitize';

export const previewSchema: Schema = {
  ...defaultSchema,
  // remark-rehype already prefixes generated ids (footnotes) with
  // `user-content-`; the default clobber would double-prefix them and break
  // footnote links. With no raw HTML there are no user-controlled ids to clobber.
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    // `language-*` is needed by rehype-highlight, the math classes by rehype-katex.
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
};
