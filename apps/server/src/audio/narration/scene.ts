/**
 * Narration Renderer — Scene Builder (F1621 + F1622).
 *
 * Turns a Forge story source + a knot path into an ordered, voiced audio scene.
 * Pure module — no I/O.
 */

import { parse, findKnot } from '@fables/forge-dsl';
import type { BlockNode, InlineNode, ChoiceNode as ASTChoiceNode } from '@fables/forge-dsl';
import { separateScript } from '../casting/separate.js';
import { resolveCast } from '../casting/resolve.js';
import type { CastSheet, VoiceAssignment } from '../casting/resolve.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SceneItemKind = 'line' | 'choice' | 'earcon';

export interface SceneChoice {
  index: number;
  text: string;
}

export interface SceneItem {
  kind: SceneItemKind;
  /** Source knot this item came from. */
  knot: string;
  /** Spoken text ('' for an earcon). */
  text: string;
  /** Speaker for dialogue lines; null for narration / choice / earcon. */
  speaker: string | null;
  /** Resolved voice, or null when uncast. */
  voice: VoiceAssignment | null;
  /** Estimated spoken duration in ms (from word count at wpm). */
  estDurationMs: number;
  /** Present on 'choice' items: the options offered at this branch. */
  choices?: SceneChoice[] | undefined;
  /** Present on 'earcon' items: a stable cue id, e.g. 'choice-prompt'. */
  earcon?: string | undefined;
}

export interface AudioScene {
  items: SceneItem[];
  totalEstMs: number;
}

export interface BuildSceneOptions {
  wpm?: number | undefined;
  knownSpeakers?: string[] | undefined;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WPM = 155;
const EARCON_DURATION_MS = 400;

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Extract plain text from a list of InlineNodes (only 'Text' segments). */
function inlineText(segments: readonly InlineNode[]): string {
  return segments
    .filter((s): s is Extract<InlineNode, { kind: 'Text' }> => s.kind === 'Text')
    .map((s) => s.text)
    .join('');
}

/**
 * Flatten a BlockNode's prose into paragraphs, returning:
 *   - prose: joined paragraphs from TextLine and Gather items (excluding choices)
 *   - choices: ChoiceNode[] found directly in the block
 *
 * We only look at direct items (not recursively into choice bodies) so we
 * don't accidentally include nested sub-choice text in the parent knot prose.
 */
function flattenBlock(block: BlockNode): { prose: string; choices: ASTChoiceNode[] } {
  const paragraphs: string[] = [];
  const choices: ASTChoiceNode[] = [];

  for (const item of block.items) {
    if (item.kind === 'TextLine') {
      const text = inlineText(item.segments).trim();
      if (text.length > 0) paragraphs.push(text);
    } else if (item.kind === 'Gather') {
      const text = inlineText(item.segments).trim();
      if (text.length > 0) paragraphs.push(text);
    } else if (item.kind === 'Choice') {
      choices.push(item);
    }
    // LogicLine and DivertLine are skipped for narration purposes.
  }

  return { prose: paragraphs.join(' '), choices };
}

// ---------------------------------------------------------------------------
// Main exports
// ---------------------------------------------------------------------------

/**
 * Estimate spoken duration of `text` at `wpm` words per minute.
 * Empty / whitespace-only text returns 0.
 */
export function estimateDurationMs(text: string, wpm: number): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const words = trimmed.split(/\s+/).length;
  return Math.round((words / wpm) * 60_000);
}

/**
 * Build an AudioScene from a Forge story source and a sequence of knot names.
 *
 * For each knot in `path`:
 *   1. Flatten prose → separateScript → resolveCast → emit 'line' SceneItems.
 *   2. If the knot has choices, emit an 'earcon' item then a 'choice' item.
 *
 * Unknown knot names are silently skipped.
 */
export function buildScene(
  source: string,
  path: string[],
  cast: CastSheet,
  opts?: BuildSceneOptions,
): AudioScene {
  const wpm = opts?.wpm ?? DEFAULT_WPM;
  const knownSpeakers = opts?.knownSpeakers;

  const { story } = parse(source);
  const items: SceneItem[] = [];

  for (const knotName of path) {
    const knot = findKnot(story, knotName);
    if (knot === undefined) continue;

    const { prose, choices } = flattenBlock(knot.body);

    // --- Prose lines ---
    if (prose.length > 0) {
      const scriptLines = separateScript(prose, knownSpeakers);
      const resolvedLines = resolveCast(scriptLines, cast);

      for (const line of resolvedLines) {
        items.push({
          kind: 'line',
          knot: knotName,
          text: line.text,
          speaker: line.speaker,
          voice: line.voice,
          estDurationMs: estimateDurationMs(line.text, wpm),
        });
      }
    }

    // --- Choice items ---
    if (choices.length > 0) {
      // Earcon first
      items.push({
        kind: 'earcon',
        knot: knotName,
        text: '',
        speaker: null,
        voice: cast.narrator,
        estDurationMs: EARCON_DURATION_MS,
        earcon: 'choice-prompt',
      });

      // Build the choice menu
      const sceneChoices: SceneChoice[] = choices.map((c, idx) => ({
        index: idx + 1,
        text: inlineText(c.prefix).trim(),
      }));

      const choiceMenuText = sceneChoices.map((c) => `${c.index}. ${c.text}`).join('; ');

      items.push({
        kind: 'choice',
        knot: knotName,
        text: choiceMenuText,
        speaker: null,
        voice: cast.narrator,
        estDurationMs: estimateDurationMs(choiceMenuText, wpm),
        choices: sceneChoices,
      });
    }
  }

  const totalEstMs = items.reduce((sum, item) => sum + item.estDurationMs, 0);

  return { items, totalEstMs };
}
