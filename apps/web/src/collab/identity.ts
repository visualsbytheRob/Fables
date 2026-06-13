/**
 * Per-device presence identity (F1136): persisted name + color.
 * Loaded from localStorage; falls back to a derived name + a seeded color.
 */

const STORAGE_KEY = 'fables.collab.identity';

export interface PresenceIdentity {
  name: string;
  color: string;
}

/** 12 distinct colors that contrast well in both light/dark themes. */
export const PRESENCE_COLORS = [
  '#e05c5c', // red
  '#e07b5c', // orange-red
  '#e0a95c', // amber
  '#7cc47c', // sage
  '#5cb8e0', // sky
  '#5c7ce0', // indigo
  '#a05ce0', // purple
  '#e05cb8', // pink
  '#5ce0b8', // teal
  '#7ce0d0', // cyan
  '#c4b45c', // gold
  '#b45c7c', // rose
];

function deviceColor(): string {
  // Derive a stable color from the user-agent + timestamp seed
  let h = 0;
  const s = (navigator.userAgent || '') + String(Date.now());
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return PRESENCE_COLORS[Math.abs(h) % PRESENCE_COLORS.length] ?? PRESENCE_COLORS[0]!;
}

function deviceName(): string {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'PC';
  return 'Device';
}

export function loadIdentity(): PresenceIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PresenceIdentity>;
      if (parsed.name && parsed.color) return parsed as PresenceIdentity;
    }
  } catch {
    // ignore
  }
  return { name: deviceName(), color: deviceColor() };
}

export function saveIdentity(id: PresenceIdentity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
  } catch {
    // ignore
  }
}

// ---- privacy toggle (F1137) ----
const PRIVACY_KEY = 'fables.collab.private';

export function loadPrivacy(): boolean {
  try {
    return localStorage.getItem(PRIVACY_KEY) === 'true';
  } catch {
    return false;
  }
}

export function savePrivacy(v: boolean): void {
  try {
    localStorage.setItem(PRIVACY_KEY, String(v));
  } catch {
    // ignore
  }
}
