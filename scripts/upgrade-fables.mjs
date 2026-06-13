#!/usr/bin/env node
/**
 * pnpm upgrade-fables (F967)
 *
 * Upgrade script: pull latest from main, install deps, build, and restart.
 * Intended to be run as: `pnpm upgrade-fables`
 *
 * Steps:
 *  1. `git pull origin main`
 *  2. `pnpm install --frozen-lockfile`
 *  3. `pnpm build`
 *  4. Migrations run automatically on next server start.
 *  5. Restart hint (launchd/systemd/manual).
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';

function run(cmd, args = [], opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    console.error(`  ✗ Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nFables upgrade\n');

// 1. Pull latest.
console.log('  → git pull origin main…');
run('git', ['pull', 'origin', 'main']);

// 2. Install.
console.log('  → pnpm install…');
run('pnpm', ['install', '--frozen-lockfile']);

// 3. Build.
console.log('  → pnpm build…');
run('pnpm', ['build']);

console.log('  ✓ Upgrade complete.\n');
console.log('  Migrations will run automatically on next server start.\n');

// 4. Restart hint.
const platform = os.platform();
if (platform === 'darwin') {
  console.log('  Restart Fables:');
  console.log('    launchctl stop com.fables.server && launchctl start com.fables.server');
} else if (platform === 'linux') {
  console.log('  Restart Fables:');
  console.log('    sudo systemctl restart fables');
} else {
  console.log('  Restart the server manually to pick up the new build.');
}
console.log('');
