/**
 * Workspace profile presets (Epic 20, F1972, F1976).
 *
 * Starter focus modes — a reading-only profile for phone evenings, a distraction
 * -free writing mode, and a review mode — each a named state blob a client can
 * import and interpret. Pure data + lookup.
 */

export interface ProfilePreset {
  id: string;
  name: string;
  description: string;
  state: Record<string, unknown>;
}

export const PROFILE_PRESETS: ProfilePreset[] = [
  {
    id: 'reading',
    name: 'Reading (evenings)',
    description: 'Read-only, larger type, no editing chrome — for the phone after dark.',
    state: {
      focus: 'reading',
      readOnly: true,
      theme: 'dark',
      fontScale: 1.25,
      hidden: ['toolbar', 'sidebar', 'editor'],
      notifications: 'muted',
    },
  },
  {
    id: 'writing',
    name: 'Writing mode',
    description: 'Single pane, no panels, typewriter scrolling — just you and the words.',
    state: {
      focus: 'writing',
      theme: 'light',
      hidden: ['sidebar', 'graph', 'notifications'],
      typewriter: true,
    },
  },
  {
    id: 'review',
    name: 'Review mode',
    description: 'Spaced-repetition + inbox front and centre, everything else tucked away.',
    state: {
      focus: 'review',
      openPanes: ['review', 'inbox'],
      hidden: ['graph', 'canvas'],
      notifications: 'review-only',
    },
  },
];

export function getPreset(id: string): ProfilePreset | undefined {
  return PROFILE_PRESETS.find((p) => p.id === id);
}
