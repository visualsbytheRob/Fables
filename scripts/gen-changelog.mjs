#!/usr/bin/env node
/**
 * Generate a changelog section from git history (F995).
 *
 * Usage:
 *   node scripts/gen-changelog.mjs [<sinceRef>] [--version vX.Y.Z]
 *
 * Reads commit subjects since <sinceRef> (default: the latest tag, else the
 * whole history) and prints grouped markdown to stdout. The grouping logic is
 * the unit-tested pure module in apps/server/src/cli/changelog.ts; this wrapper
 * just supplies the git data.
 */

import { execSync } from 'node:child_process';
import { renderChangelog } from '../apps/server/src/cli/changelog.ts';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

const args = process.argv.slice(2);
const versionFlag = args.find((a) => a.startsWith('--version='));
const version = versionFlag ? versionFlag.slice('--version='.length) : 'Unreleased';
const sinceRef = args.find((a) => !a.startsWith('--'));

let range = '';
try {
  const since = sinceRef ?? sh('git describe --tags --abbrev=0');
  range = `${since}..HEAD`;
} catch {
  range = ''; // no tags yet — use the whole history
}

const log = sh(`git log ${range} --pretty=format:%s`);
const lines = log.split('\n').filter(Boolean);
process.stdout.write(renderChangelog(version, lines));
