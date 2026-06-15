/**
 * Generative-art prompt construction (Epic 19, F1863/F1864/F1865/F1866).
 *
 * Pure builders that turn story/entity/scene metadata + a style preset into the
 * text prompt an image backend (ComfyUI) consumes. No I/O.
 */

export interface StylePreset {
  /** Short style label, e.g. "ink-wash", "storybook", "noir". */
  name: string;
  /** Positive style modifiers appended to every prompt (consistency, F1866). */
  modifiers: string[];
  /** Negative prompt terms. */
  negative: string[];
}

export const DEFAULT_STYLE: StylePreset = {
  name: 'storybook',
  modifiers: ['storybook illustration', 'soft lighting', 'painterly', 'cohesive palette'],
  negative: ['text', 'watermark', 'lowres', 'extra limbs'],
};

/** Built-in style presets for a consistent look per story (F1866). */
export const STYLE_PRESETS: Record<string, StylePreset> = {
  storybook: DEFAULT_STYLE,
  inkwash: {
    name: 'inkwash',
    modifiers: ['ink wash painting', 'monochrome', 'loose brushwork', 'negative space'],
    negative: ['text', 'watermark', 'photo', 'lowres'],
  },
  noir: {
    name: 'noir',
    modifiers: ['film noir', 'high contrast', 'dramatic shadows', 'moody'],
    negative: ['text', 'watermark', 'bright colors', 'lowres'],
  },
  watercolor: {
    name: 'watercolor',
    modifiers: ['watercolor illustration', 'soft edges', 'pastel palette', 'paper texture'],
    negative: ['text', 'watermark', 'harsh lines', 'lowres'],
  },
};

/** Resolve a preset by name, defaulting to storybook. */
export function resolveStyle(name?: string): StylePreset {
  return (name && STYLE_PRESETS[name]) || DEFAULT_STYLE;
}

export interface ImagePrompt {
  prompt: string;
  negative: string;
}

function compose(subject: string, style: StylePreset): ImagePrompt {
  const positive = [subject, ...style.modifiers].filter((s) => s.trim().length > 0).join(', ');
  return { prompt: positive, negative: style.negative.join(', ') };
}

/** Cover prompt from title + blurb + theme (F1863). */
export function buildCoverPrompt(
  title: string,
  blurb: string,
  theme: string,
  style: StylePreset = DEFAULT_STYLE,
): ImagePrompt {
  const subject = [
    `book cover for "${title.trim()}"`,
    theme.trim().length > 0 ? `theme: ${theme.trim()}` : '',
    blurb.trim().length > 0 ? `depicting: ${blurb.trim().slice(0, 200)}` : '',
  ]
    .filter((s) => s.length > 0)
    .join(', ');
  return compose(subject, style);
}

/** Entity portrait prompt from an entity's fields (F1864). */
export function buildPortraitPrompt(
  entity: { name: string; type?: string; description?: string; fields?: Record<string, unknown> },
  style: StylePreset = DEFAULT_STYLE,
): ImagePrompt {
  const traits = Object.entries(entity.fields ?? {})
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ');
  const subject = [
    `character portrait of ${entity.name.trim()}`,
    entity.type ? `(${entity.type})` : '',
    entity.description?.trim() ? entity.description.trim().slice(0, 200) : '',
    traits,
  ]
    .filter((s) => s.length > 0)
    .join(', ');
  return compose(subject, style);
}

/** Scene illustration prompt from a `# scene:` tag (F1865). */
export function buildScenePrompt(
  sceneTag: string,
  style: StylePreset = DEFAULT_STYLE,
): ImagePrompt {
  const subject = `scene illustration of ${sceneTag.replace(/[_-]+/g, ' ').trim()}, atmospheric, establishing shot`;
  return compose(subject, style);
}
