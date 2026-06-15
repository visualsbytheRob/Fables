/**
 * Example script gallery (Epic 20, F1948).
 *
 * A small set of ready-to-run starter scripts, each declaring exactly the scopes
 * it needs. Pure data + lookup — the console seeds the library from these.
 */

export interface ExampleScript {
  id: string;
  name: string;
  description: string;
  scopes: string[];
  source: string;
}

export const SCRIPT_GALLERY: ExampleScript[] = [
  {
    id: 'tag-untagged',
    name: 'Tag untagged notes',
    description: 'Find notes with no tags and add an "inbox" tag.',
    scopes: ['notes:read', 'notes:write'],
    source: [
      'const notes = await fables.notes.query("");',
      'for (const n of notes) {',
      '  const tags = await fables.notes.tags(n.id);',
      '  if (tags.length === 0) await fables.notes.update(n.id, { addTags: ["inbox"] });',
      '}',
    ].join('\n'),
  },
  {
    id: 'word-count-report',
    name: 'Word-count report',
    description: 'Sum the word counts of every note and store the total.',
    scopes: ['notes:read', 'storage'],
    source: [
      'const notes = await fables.notes.query("");',
      'const total = notes.reduce((sum, n) => sum + n.body.split(/\\s+/).length, 0);',
      'await fables.storage.set("wordCount", String(total));',
    ].join('\n'),
  },
  {
    id: 'daily-digest',
    name: 'Daily digest note',
    description: 'Create a note summarising what changed today.',
    scopes: ['notes:read', 'notes:write'],
    source: [
      'const recent = await fables.notes.query("updated:>1d");',
      'const body = recent.map((n) => `- ${n.title}`).join("\\n");',
      'await fables.notes.create({ title: "Daily digest", body });',
    ].join('\n'),
  },
];

export function getExample(id: string): ExampleScript | undefined {
  return SCRIPT_GALLERY.find((s) => s.id === id);
}
