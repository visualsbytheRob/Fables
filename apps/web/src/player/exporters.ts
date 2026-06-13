/**
 * Export & sharing (F581/F585/F586/F590 + F566): transcript markdown,
 * story source bundles, the interop manifest and Web Share. Compiled
 * `.fable.bin` export/import (F582–F584) is deferred to the Day 19
 * .fablepack scope.
 *
 * F581 note: the "zip of .fable files" ships as a single self-describing
 * JSON bundle (no zip library in the workspace); the format records every
 * file verbatim so a zip writer can be swapped in later without data loss.
 */
import type { TranscriptEntry } from '@fables/forge-vm';
import type { StoryFile, StoryProject } from '../stories/api.js';

/* ── transcript markdown (F585) ────────────────────────────────────────── */

export interface TranscriptMarkdownOptions {
  readonly title: string;
  readonly playedAt?: Date;
  readonly ending?: string | null;
}

export function transcriptMarkdown(
  entries: readonly TranscriptEntry[],
  options: TranscriptMarkdownOptions,
): string {
  const date = options.playedAt ?? new Date();
  const choices = entries.filter((e) => e.kind === 'choice').length;
  const lines: string[] = [
    `# Transcript: ${options.title}`,
    '',
    `*Played ${date.toLocaleDateString()} · ${choices} choice${choices === 1 ? '' : 's'}${
      options.ending != null ? ` · ending: ${options.ending}` : ''
    }*`,
    '',
  ];
  for (const entry of entries) {
    if (entry.text.trim() === '') continue;
    lines.push(entry.kind === 'choice' ? `> **${entry.text}**` : entry.text, '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** Title used when a transcript is saved into the knowledge base (F566). */
export function transcriptNoteTitle(storyTitle: string, date: Date = new Date()): string {
  return `Transcript: ${storyTitle} — ${date.toISOString().slice(0, 10)}`;
}

/* ── source bundle (F581) ──────────────────────────────────────────────── */

export interface StoryBundle {
  readonly format: 'fables.story-bundle';
  readonly version: 1;
  readonly exportedAt: string;
  readonly story: {
    readonly title: string;
    readonly description: string;
    readonly entryFile: string;
    readonly settings: unknown;
  };
  readonly files: Readonly<Record<string, string>>;
}

export function storyBundle(story: StoryProject, files: readonly StoryFile[]): StoryBundle {
  return {
    format: 'fables.story-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    story: {
      title: story.title,
      description: story.description,
      entryFile: story.entryFile,
      settings: story.settings ?? null,
    },
    files: Object.fromEntries(files.map((f) => [f.path, f.source])),
  };
}

/* ── interop manifest (F586) ───────────────────────────────────────────── */

/** FNV-1a 32-bit — stable, dependency-free content checksum. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface StoryManifest {
  readonly format: 'fables.story-manifest';
  readonly version: 1;
  readonly title: string;
  readonly description: string;
  readonly entryFile: string;
  readonly files: readonly { path: string; bytes: number; checksum: string }[];
  /** Checksum over the per-file checksums, in path order. */
  readonly checksum: string;
}

export function storyManifest(story: StoryProject, files: readonly StoryFile[]): StoryManifest {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  const fileEntries = sorted.map((f) => ({
    path: f.path,
    bytes: new TextEncoder().encode(f.source).length,
    checksum: fnv1a(f.source),
  }));
  return {
    format: 'fables.story-manifest',
    version: 1,
    title: story.title,
    description: story.description,
    entryFile: story.entryFile,
    files: fileEntries,
    checksum: fnv1a(fileEntries.map((f) => `${f.path}:${f.checksum}`).join('\n')),
  };
}

/* ── browser download + share (F585/F590) ──────────────────────────────── */

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Web Share where the platform has it (iPhone PWA), clipboard otherwise.
 * Returns how the content went out so the caller can toast accordingly.
 */
export async function shareText(data: {
  title: string;
  text?: string;
  url?: string;
}): Promise<'shared' | 'copied' | 'unavailable'> {
  const nav = navigator as Navigator & { share?: (d: unknown) => Promise<void> };
  if (typeof nav.share === 'function') {
    try {
      await nav.share(data);
      return 'shared';
    } catch {
      return 'unavailable'; // user cancelled — treat as a no-op
    }
  }
  const fallback = data.url ?? data.text ?? data.title;
  if (typeof navigator.clipboard?.writeText === 'function') {
    await navigator.clipboard.writeText(fallback);
    return 'copied';
  }
  return 'unavailable';
}
