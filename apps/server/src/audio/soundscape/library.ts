/**
 * Bundled CC0 sound library + attribution manifest (Epic 17, F1634).
 *
 * A small catalogue of ambient loops and one-shot effects, all CC0 / public
 * domain so they can ship with the app and be used freely. The actual audio
 * files live under `<dataDir>/audio/library/` (downloaded/seeded separately);
 * this module is the metadata index + attribution manifest the UI and exports
 * read. Keeping the catalogue in code (not a DB table) makes it immutable and
 * reviewable; user-imported sounds (F1635) are a separate, additive layer.
 */

export type SoundKind = 'ambient' | 'oneshot';

export interface LibrarySound {
  /** Stable id referenced by scene bindings + `play("…")` triggers. */
  id: string;
  name: string;
  kind: SoundKind;
  /** Relative path under the audio library dir. */
  file: string;
  /** Tags for search/grouping (e.g. 'weather', 'interior'). */
  tags: string[];
  license: 'CC0';
  /** Where the sound came from, for the attribution manifest. */
  source: string;
}

/** The bundled catalogue. CC0 means no attribution is legally required, but we
 *  credit sources anyway as good practice (F1634). */
export const SOUND_LIBRARY: readonly LibrarySound[] = [
  {
    id: 'rain',
    name: 'Steady Rain',
    kind: 'ambient',
    file: 'ambient/rain.ogg',
    tags: ['weather', 'calm'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'storm',
    name: 'Thunderstorm',
    kind: 'ambient',
    file: 'ambient/storm.ogg',
    tags: ['weather', 'tense'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'forest',
    name: 'Forest Birds',
    kind: 'ambient',
    file: 'ambient/forest.ogg',
    tags: ['nature', 'day'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'tavern',
    name: 'Tavern Murmur',
    kind: 'ambient',
    file: 'ambient/tavern.ogg',
    tags: ['interior', 'crowd'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'ocean',
    name: 'Ocean Waves',
    kind: 'ambient',
    file: 'ambient/ocean.ogg',
    tags: ['water', 'calm'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'cave',
    name: 'Dripping Cave',
    kind: 'ambient',
    file: 'ambient/cave.ogg',
    tags: ['interior', 'eerie'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'fire',
    name: 'Crackling Fire',
    kind: 'ambient',
    file: 'ambient/fire.ogg',
    tags: ['interior', 'warm'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'wind',
    name: 'Howling Wind',
    kind: 'ambient',
    file: 'ambient/wind.ogg',
    tags: ['weather', 'cold'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'door',
    name: 'Wooden Door',
    kind: 'oneshot',
    file: 'oneshot/door.ogg',
    tags: ['interior'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'footsteps',
    name: 'Footsteps',
    kind: 'oneshot',
    file: 'oneshot/footsteps.ogg',
    tags: ['movement'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'sword',
    name: 'Sword Clash',
    kind: 'oneshot',
    file: 'oneshot/sword.ogg',
    tags: ['combat'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'bell',
    name: 'Bell Toll',
    kind: 'oneshot',
    file: 'oneshot/bell.ogg',
    tags: ['signal'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
  {
    id: 'chest',
    name: 'Chest Open',
    kind: 'oneshot',
    file: 'oneshot/chest.ogg',
    tags: ['interaction'],
    license: 'CC0',
    source: 'freesound.org (CC0)',
  },
];

const BY_ID = new Map(SOUND_LIBRARY.map((s) => [s.id, s]));

/** Look up a bundled sound by id. */
export function findSound(id: string): LibrarySound | undefined {
  return BY_ID.get(id);
}

/** Library entries of a given kind. */
export function soundsOfKind(kind: SoundKind): LibrarySound[] {
  return SOUND_LIBRARY.filter((s) => s.kind === kind);
}

export interface AttributionEntry {
  id: string;
  name: string;
  license: 'CC0';
  source: string;
}

/** The attribution manifest shipped with any export that uses the library. */
export function attributionManifest(): AttributionEntry[] {
  return SOUND_LIBRARY.map((s) => ({
    id: s.id,
    name: s.name,
    license: s.license,
    source: s.source,
  }));
}
