/**
 * Document outline (F387): the knots → stitches (→ labels) tree extracted
 * from the AST. Pure; the OutlinePanel component renders it.
 */
import { findAll, type BlockNode, type CompileResult, type StoryNode } from '@fables/forge-dsl';

export interface OutlineEntry {
  readonly kind: 'knot' | 'stitch' | 'label';
  readonly name: string;
  /** Offset of the name token — where navigation should place the cursor. */
  readonly offset: number;
  readonly line: number;
  readonly children: OutlineEntry[];
}

function labelEntries(block: BlockNode): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  for (const node of [...findAll(block, 'Choice'), ...findAll(block, 'Gather')]) {
    if (node.label === undefined) continue;
    out.push({
      kind: 'label',
      name: node.label.name,
      offset: node.label.span.start.offset,
      line: node.label.span.start.line,
      children: [],
    });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

export function extractOutline(story: StoryNode): OutlineEntry[] {
  return story.knots.map((knot) => ({
    kind: 'knot' as const,
    name: knot.name.name,
    offset: knot.name.span.start.offset,
    line: knot.name.span.start.line,
    children: [
      ...labelEntries(knot.body),
      ...knot.stitches.map((stitch) => ({
        kind: 'stitch' as const,
        name: stitch.name.name,
        offset: stitch.name.span.start.offset,
        line: stitch.name.span.start.line,
        children: labelEntries(stitch.body),
      })),
    ].sort((a, b) => a.offset - b.offset),
  }));
}

export function outlineFromResult(result: CompileResult): OutlineEntry[] {
  return extractOutline(result.ast);
}
