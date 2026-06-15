/**
 * Audiobook manifest (Epic 17, F1661–F1668).
 *
 * Turns a narration scene into the metadata an audiobook export needs: chapters
 * derived from knot boundaries (F1662), embedded title/author/narrator/cover
 * metadata (F1663), an upfront output-size estimate per format (F1668), and a
 * `.cue` chapter sheet (F1661). The actual container muxing (m4b/mp3/opus) is a
 * codec concern handled by the export/web layer; this is the pure plan it bakes.
 */

import type { AudioScene } from '../narration/scene.js';

export type AudioExportFormat = 'wav' | 'mp3' | 'opus' | 'm4b';

export interface Chapter {
  title: string;
  knot: string;
  startMs: number;
  endMs: number;
  /** Inclusive scene-item index range covered by this chapter. */
  itemStart: number;
  itemEnd: number;
}

export interface AudiobookMetadata {
  title: string;
  author?: string | undefined;
  narrator?: string | undefined;
  /** Cover image as a data URI or library path; carried through to the muxer. */
  cover?: string | undefined;
}

export interface AudiobookManifest {
  metadata: AudiobookMetadata;
  chapters: Chapter[];
  totalMs: number;
  format: AudioExportFormat;
  /** Estimated output size in bytes for `format` (F1668). */
  estimatedBytes: number;
}

/** Humanised chapter title from a knot id ("forest_clearing" → "Forest Clearing"). */
function titleize(knot: string): string {
  const words = knot.replace(/[_-]+/g, ' ').trim().split(/\s+/);
  return words.map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');
}

/**
 * Group a scene's items into chapters by consecutive knot, timing each chapter
 * from the items' estimated durations (F1662). One chapter per contiguous run of
 * a knot, so re-entering a knot later starts a new chapter.
 */
export function buildChapters(scene: AudioScene): Chapter[] {
  const chapters: Chapter[] = [];
  let cursorMs = 0;
  let current: Chapter | null = null;

  scene.items.forEach((item, i) => {
    if (!current || current.knot !== item.knot) {
      if (current) chapters.push(current);
      current = {
        title: titleize(item.knot),
        knot: item.knot,
        startMs: cursorMs,
        endMs: cursorMs,
        itemStart: i,
        itemEnd: i,
      };
    }
    cursorMs += item.estDurationMs;
    current.endMs = cursorMs;
    current.itemEnd = i;
  });
  if (current) chapters.push(current);
  return chapters;
}

/** Approximate bytes/second for spoken-word audio at each format. */
const BYTES_PER_SEC: Record<AudioExportFormat, number> = {
  // 16-bit mono PCM @ 22.05 kHz.
  wav: 22_050 * 2,
  // ~64 kbps mp3 / ~24 kbps opus (spoken word) / ~64 kbps aac in m4b.
  mp3: 64_000 / 8,
  opus: 24_000 / 8,
  m4b: 64_000 / 8,
};

/** Estimate output size in bytes for a duration + format (F1668). */
export function estimateAudioBytes(durationMs: number, format: AudioExportFormat): number {
  const seconds = Math.max(0, durationMs) / 1000;
  return Math.round(seconds * BYTES_PER_SEC[format]);
}

/** Assemble the full audiobook manifest from a scene (F1661–F1663, F1668). */
export function buildAudiobookManifest(
  scene: AudioScene,
  metadata: AudiobookMetadata,
  format: AudioExportFormat,
): AudiobookManifest {
  const chapters = buildChapters(scene);
  const totalMs = scene.totalEstMs;
  return {
    metadata,
    chapters,
    totalMs,
    format,
    estimatedBytes: estimateAudioBytes(totalMs, format),
  };
}

/** Render chapters as a `.cue` sheet for players that read chapter marks (F1661). */
export function toCueSheet(manifest: AudiobookManifest): string {
  const lines: string[] = [];
  lines.push(`TITLE "${manifest.metadata.title}"`);
  if (manifest.metadata.author) lines.push(`PERFORMER "${manifest.metadata.author}"`);
  lines.push(`FILE "audiobook.${manifest.format}" WAVE`);
  manifest.chapters.forEach((ch, i) => {
    lines.push(`  TRACK ${String(i + 1).padStart(2, '0')} AUDIO`);
    lines.push(`    TITLE "${ch.title}"`);
    lines.push(`    INDEX 01 ${msToCueTime(ch.startMs)}`);
  });
  return lines.join('\n') + '\n';
}

/** Format ms as a cue-sheet MM:SS:FF timestamp (75 frames/sec). */
function msToCueTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const frames = Math.floor(((ms % 1000) / 1000) * 75);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}
