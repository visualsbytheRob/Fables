import { EditorState } from '@uiw/react-codemirror';
import { describe, expect, it } from 'vitest';
import { forgeCompileField } from './compileField.js';
import {
  forgeCompletionSource,
  knotAt,
  type ForgeCompletionContext,
  type ForgeCompletionResult,
} from './completion.js';

const STORY = `VAR hunger = 3
VAR name = "Reynard"

-> den

=== den ===
The fox curls up.
~ temp warmth = 2
* Sleep. -> morning
+ Watch the entrance.
  -> den

= tunnel_mouth
Cold air drifts in.
-> morning

=== morning ===
Sunlight. Hunger is {hunger}.
-> END
`;

function makeState(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [forgeCompileField] });
}

function complete(doc: string, pos: number, explicit = false): ForgeCompletionResult | null {
  const state = makeState(doc);
  const context: ForgeCompletionContext = {
    state,
    pos,
    explicit,
    matchBefore(expr: RegExp) {
      const line = state.doc.lineAt(pos);
      const before = state.doc.sliceString(line.from, pos);
      const m = expr.exec(before);
      if (m === null) return null;
      return { from: line.from + m.index, to: pos, text: m[0] };
    },
  };
  return forgeCompletionSource(context);
}

const labels = (r: ForgeCompletionResult | null): string[] => r?.options.map((o) => o.label) ?? [];

describe('forge completion source (F384)', () => {
  it('completes divert targets after "->", including END/DONE and dotted stitches', () => {
    const doc = `${STORY}-> `;
    const result = complete(doc, doc.length);
    expect(labels(result)).toEqual(
      expect.arrayContaining(['END', 'DONE', 'den', 'morning', 'den.tunnel_mouth']),
    );
    expect(result?.from).toBe(doc.length);
  });

  it('offers local short names for stitches inside their own knot', () => {
    const insertAt = STORY.indexOf('= tunnel_mouth');
    const doc = `${STORY.slice(0, insertAt)}-> t\n${STORY.slice(insertAt)}`;
    const pos = insertAt + '-> t'.length;
    const result = complete(doc, pos);
    expect(labels(result)).toEqual(expect.arrayContaining(['tunnel_mouth', 'den.tunnel_mouth']));
    // from points at the typed identifier so filtering works
    expect(result?.from).toBe(pos - 1);
  });

  it('completes variables, temps in scope, builtins, and read counts in logic', () => {
    const at = STORY.indexOf('* Sleep.');
    const doc = `${STORY.slice(0, at)}~ w\n${STORY.slice(at)}`;
    const result = complete(doc, at + 3);
    const got = labels(result);
    expect(got).toEqual(
      expect.arrayContaining(['hunger', 'name', 'warmth', 'RANDOM', 'den', 'true']),
    );
    const random = result?.options.find((o) => o.label === 'RANDOM');
    expect(random?.type).toBe('function');
    expect(random?.apply).toBe('RANDOM(');
  });

  it('does not offer temps from another knot', () => {
    const doc = `${STORY}~ `;
    const result = complete(doc, doc.length, true);
    expect(labels(result)).not.toContain('warmth'); // warmth is scoped to den
    expect(labels(result)).toContain('hunger');
  });

  it('completes inside inline expression braces', () => {
    const at = STORY.indexOf('{hunger}') + 1;
    const result = complete(STORY, at + 1);
    expect(labels(result)).toContain('hunger');
  });

  it('offers no completion in plain prose', () => {
    const pos = STORY.indexOf('The fox curls') + 7;
    expect(complete(STORY, pos)).toBeNull();
  });

  it('offers binding stubs after "@" and reuses bound names', () => {
    const doc = `@fox(Reynard) waits.\n${STORY}@f`;
    const result = complete(doc, doc.length);
    expect(labels(result)).toContain('@fox(Reynard)');
  });

  it('offers a stub when no entity is bound yet', () => {
    const doc = `${STORY}@`;
    const result = complete(doc, doc.length);
    expect(labels(result)).toContain('@entity(Name)');
  });

  it('completes note references after "[[" and reuses titles', () => {
    const doc = `See [[The Night-Wood]].\n${STORY}[[`;
    const result = complete(doc, doc.length);
    expect(labels(result)).toContain('The Night-Wood');
    expect(result?.options[0]?.apply).toBe('The Night-Wood]]');
  });

  it('knotAt finds the knot containing an offset', () => {
    const state = makeState(STORY);
    const result = state.field(forgeCompileField);
    expect(knotAt(result.ast, STORY.indexOf('curls'))?.name.name).toBe('den');
    expect(knotAt(result.ast, STORY.indexOf('Sunlight'))?.name.name).toBe('morning');
    expect(knotAt(result.ast, 0)).toBeUndefined();
  });
});
