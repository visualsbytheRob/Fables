/**
 * Soundscape Bindings (F1632).
 *
 * Extracts knot-to-soundscape mappings from a Forge story source by scanning
 * `# scene: NAME` tags on each knot.  Pure module -- no I/O.
 */

import { parse, findAll } from '@fables/forge-dsl';
import type { TagNode, KnotNode } from '@fables/forge-dsl';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SceneBinding {
  knot: string;
  soundscape: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCENE_TAG_RE = /^scene:\s*(.+)$/i;

/** Collect all unique TagNodes for a knot: header tags + body tags. */
function collectKnotTags(knot: KnotNode): TagNode[] {
  const seen = new Set<string>();
  const result: TagNode[] = [];

  const addTag = (tag: TagNode): void => {
    if (!seen.has(tag.text)) {
      seen.add(tag.text);
      result.push(tag);
    }
  };

  for (const tag of knot.tags) {
    addTag(tag);
  }

  for (const tag of findAll(knot, 'Tag')) {
    addTag(tag);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse `source` and return one {@link SceneBinding} per (knot, scene-tag)
 * pair.  Knots with no `# scene:` tag are omitted.  Returns `[]` on parse
 * failure or empty source.
 */
export function extractSceneBindings(source: string): SceneBinding[] {
  let story: ReturnType<typeof parse>['story'] | undefined;
  try {
    const result = parse(source);
    story = result.story;
  } catch {
    return [];
  }

  if (!story) return [];

  const bindings: SceneBinding[] = [];

  for (const knot of story.knots) {
    const knotName = knot.name.name;
    const tags = collectKnotTags(knot);

    for (const tag of tags) {
      const match = SCENE_TAG_RE.exec(tag.text);
      if (match !== null) {
        const soundscape = match[1]!.trim().toLowerCase();
        bindings.push({ knot: knotName, soundscape });
      }
    }
  }

  return bindings;
}
