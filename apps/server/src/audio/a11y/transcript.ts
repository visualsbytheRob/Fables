/**
 * Audio accessibility: transcripts, captions, and spoken menus (Epic 17,
 * F1682 numbered choice reading, F1684 caption/transcript view).
 *
 * Turns a narration scene into accessible text artifacts:
 *   - a plain transcript (speaker-attributed lines) for a caption/transcript view,
 *   - WebVTT captions timed off the scene timeline (cue per spoken line),
 *   - a numbered, spoken choice menu ("Option 1: …") so choices are navigable by
 *     voice without a visual list.
 *
 * Pure module — no I/O.
 */

import type { AudioScene, SceneChoice } from '../narration/scene.js';
import { buildTimeline } from '../narration/timeline.js';

/** Plain speaker-attributed transcript of a scene (F1684). */
export function buildTranscript(scene: AudioScene): string {
  const lines: string[] = [];
  for (const item of scene.items) {
    if (item.kind === 'choice') {
      const menu = (item.choices ?? []).map((c) => `${c.index}. ${c.text}`).join('  ');
      if (menu.length > 0) lines.push(`[Choices] ${menu}`);
      continue;
    }
    if (item.kind === 'earcon') continue;
    if (item.text.trim().length === 0) continue;
    const speaker = item.speaker ?? 'Narrator';
    lines.push(`${speaker}: ${item.text}`);
  }
  return lines.join('\n');
}

/** Format milliseconds as a WebVTT timestamp (HH:MM:SS.mmm). */
function vttTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`;
}

/**
 * WebVTT captions for a scene (F1684), one cue per spoken/choice item, timed off
 * the scene's estimated timeline. Earcons and empty items are skipped.
 */
export function buildVtt(scene: AudioScene): string {
  const timeline = buildTimeline(scene);
  const cues: string[] = ['WEBVTT', ''];
  scene.items.forEach((item, i) => {
    if (item.kind === 'earcon') return;
    const entry = timeline.entries[i];
    if (!entry) return;
    let text: string;
    if (item.kind === 'choice') {
      const menu = (item.choices ?? []).map((c) => `${c.index}. ${c.text}`).join(' / ');
      if (menu.length === 0) return;
      text = `Choices: ${menu}`;
    } else {
      if (item.text.trim().length === 0) return;
      const speaker = item.speaker ?? 'Narrator';
      text = `<v ${speaker}>${item.text}`;
    }
    cues.push(`${vttTime(entry.startMs)} --> ${vttTime(entry.endMs)}`);
    cues.push(text);
    cues.push('');
  });
  return cues.join('\n');
}

/**
 * A spoken, numbered choice menu for voice navigation (F1682). The narrator can
 * read this aloud and the listener selects by number.
 */
export function numberedChoiceMenu(choices: SceneChoice[]): string {
  if (choices.length === 0) return '';
  const ordered = [...choices].sort((a, b) => a.index - b.index);
  const options = ordered.map((c) => `Option ${c.index}: ${c.text}.`).join(' ');
  return `Make your choice. ${options} Say the number of your choice.`;
}
