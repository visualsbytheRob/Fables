/**
 * Client-side recovery code generation (F1222).
 *
 * Generates 8 codes, each 5 groups of 4 uppercase hex chars separated by
 * dashes, e.g. "A3F2-91BC-44ED-7731-B09C".
 *
 * These are shown ONCE at vault creation time and must be stored by the user.
 * They are never sent to the server; the user is responsible for safekeeping.
 * Forgetting the passphrase AND losing recovery codes = permanent data loss
 * (see F1229 messaging in VaultCreateFlow).
 */

const CODE_COUNT = 8;
const GROUP_COUNT = 5;
const BYTES_PER_GROUP = 2; // 4 hex chars

export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < CODE_COUNT; i += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(GROUP_COUNT * BYTES_PER_GROUP));
    const groups: string[] = [];
    for (let g = 0; g < GROUP_COUNT; g += 1) {
      const chunk = bytes.slice(g * BYTES_PER_GROUP, (g + 1) * BYTES_PER_GROUP);
      groups.push(
        Array.from(chunk)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase(),
      );
    }
    codes.push(groups.join('-'));
  }
  return codes;
}

/**
 * Derive a short display fingerprint from an opaque server string (F1227).
 * Takes the first 32 hex chars of the SHA-256 of the input and formats
 * them as 4 groups of 8 chars.
 *
 * If the server doesn't yet return a fingerprint value, callers should pass
 * undefined and display a "—" placeholder.
 */
export async function deriveFingerprint(raw: string | undefined): Promise<string | null> {
  if (!raw) return null;
  try {
    const enc = new TextEncoder().encode(raw);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    const hex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    // 4 groups × 8 chars
    return [hex.slice(0, 8), hex.slice(8, 16), hex.slice(16, 24), hex.slice(24, 32)].join(' ');
  } catch {
    return null;
  }
}
