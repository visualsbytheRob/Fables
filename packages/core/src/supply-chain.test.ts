/**
 * Dependency supply-chain pinning policy (F1266).
 *
 * Enforces, as a test, that every dependency across the monorepo uses a bounded,
 * registry-pinned specifier: an exact version, a caret/tilde range, or the
 * `workspace:*` protocol for internal packages. Wildcards (`*`, `latest`),
 * unbounded ranges (`>=`, `>`), and remote specifiers (git/http/file) are
 * rejected — they would let an unreviewed or attacker-controlled version slip in.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function packageJsonPaths(): string[] {
  const paths = [path.join(REPO_ROOT, 'package.json')];
  for (const group of ['apps', 'packages']) {
    const dir = path.join(REPO_ROOT, group);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry, 'package.json');
      if (fs.existsSync(p)) paths.push(p);
    }
  }
  return paths;
}

/** Exact (1.2.3), caret (^1.2.3), tilde (~1.2.3), or the workspace protocol. */
const SAFE_SPECIFIER = /^(workspace:\*|[\^~]?\d[\w.\-+]*)$/;

describe('dependency supply-chain pinning policy (F1266)', () => {
  it('finds at least the root + every workspace package.json', () => {
    expect(packageJsonPaths().length).toBeGreaterThanOrEqual(8);
  });

  it('every dependency uses a bounded, pinned specifier', () => {
    const violations: string[] = [];
    for (const p of packageJsonPaths()) {
      const json = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >;
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const [name, version] of Object.entries(json[field] ?? {})) {
          if (!SAFE_SPECIFIER.test(version)) {
            violations.push(`${path.relative(REPO_ROOT, p)} :: ${name}@${version}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('rejects known-dangerous specifiers (policy self-check)', () => {
    for (const bad of ['*', 'latest', '>=1.0.0', '>1.0.0', 'git+https://x/y', 'file:../z', 'x']) {
      expect(SAFE_SPECIFIER.test(bad)).toBe(false);
    }
    for (const good of ['1.2.3', '^1.2.3', '~1.2.3', '^0.7.15', 'workspace:*']) {
      expect(SAFE_SPECIFIER.test(good)).toBe(true);
    }
  });
});
