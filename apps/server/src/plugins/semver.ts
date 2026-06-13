/**
 * Minimal semver utilities (F1007).
 *
 * We only need:
 *  - parse: extract major/minor/patch from "M.m.p"
 *  - compat check: plugin's minAppVersion ≤ current app version
 *    (same major required)
 *  - dep compat: installed dep version satisfies required minimum
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export function parseSemver(version: string): SemVer {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`invalid semver: "${version}"`);
  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
    raw: version,
  };
}

/** Compare two versions: -1, 0, +1 (a < b, a == b, a > b). */
export function compareSemver(a: SemVer, b: SemVer): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Returns ok=true if `actual` satisfies the `required` minimum version.
 *
 * Rules:
 *  - major versions must match (breaking changes)
 *  - actual >= required within the same major
 */
export function semverCompat(
  actual: string,
  required: string,
): { ok: true } | { ok: false; reason: string } {
  let a: SemVer;
  let r: SemVer;
  try {
    a = parseSemver(actual);
    r = parseSemver(required);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  if (a.major !== r.major) {
    return {
      ok: false,
      reason: `major version mismatch: requires ${r.raw} (major ${r.major}) but got ${a.raw} (major ${a.major})`,
    };
  }

  const cmp = compareSemver(a, r);
  if (cmp < 0) {
    return {
      ok: false,
      reason: `version ${a.raw} is older than required minimum ${r.raw}`,
    };
  }

  return { ok: true };
}
