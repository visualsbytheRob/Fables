/**
 * Audio a11y transcript/caption tests (F1682/F1684/F1690).
 */

import { describe, expect, it } from 'vitest';
import { buildTranscript, buildVtt, numberedChoiceMenu } from './transcript.js';
import type { AudioScene, SceneItem } from '../narration/scene.js';

function line(text: string, speaker: string | null = null): SceneItem {
  return { kind: 'line', knot: 'k', text, speaker, voice: null, estDurationMs: 1000 };
}

const choiceItem: SceneItem = {
  kind: 'choice',
  knot: 'k',
  text: '',
  speaker: null,
  voice: null,
  estDurationMs: 800,
  choices: [
    { index: 1, text: 'Open the door' },
    { index: 2, text: 'Turn back' },
  ],
};

const earcon: SceneItem = {
  kind: 'earcon',
  knot: 'k',
  text: '',
  speaker: null,
  voice: null,
  estDurationMs: 400,
  earcon: 'choice-prompt',
};

function scene(items: SceneItem[]): AudioScene {
  return { items, totalEstMs: items.reduce((n, i) => n + i.estDurationMs, 0) };
}

describe('buildTranscript (F1684)', () => {
  it('attributes speakers and lists choices, skipping earcons', () => {
    const t = buildTranscript(
      scene([line('The hall was dark.'), line('Who goes there?', 'Mira'), earcon, choiceItem]),
    );
    expect(t).toContain('Narrator: The hall was dark.');
    expect(t).toContain('Mira: Who goes there?');
    expect(t).toContain('[Choices] 1. Open the door  2. Turn back');
    expect(t).not.toContain('choice-prompt');
  });
});

describe('buildVtt (F1684)', () => {
  it('emits a WEBVTT header and timed cues', () => {
    const vtt = buildVtt(scene([line('First line.'), line('Second line.', 'Mira')]));
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.000');
    expect(vtt).toContain('<v Narrator>First line.');
    expect(vtt).toContain('<v Mira>Second line.');
  });
});

describe('numberedChoiceMenu (F1682)', () => {
  it('reads choices as a numbered spoken menu', () => {
    const menu = numberedChoiceMenu([
      { index: 1, text: 'Go north' },
      { index: 2, text: 'Go south' },
    ]);
    expect(menu).toContain('Option 1: Go north.');
    expect(menu).toContain('Option 2: Go south.');
    expect(menu).toContain('Say the number');
  });

  it('is empty when there are no choices', () => {
    expect(numberedChoiceMenu([])).toBe('');
  });
});
