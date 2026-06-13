#!/usr/bin/env node
/**
 * Fables install script (F994)
 *
 * Guided setup: clone → pnpm install → doctor → build → configure autostart.
 * Run: node scripts/install.mjs
 *
 * This script assumes it is run from the repo root AFTER cloning.
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function info(msg) {
  console.log(`  → ${msg}`);
}
function warn(msg) {
  console.warn(`  ⚠ ${msg}`);
}
function fail(msg) {
  console.error(`  ✗ ${msg}`);
}
function hr() {
  console.log('');
}

async function ask(q) {
  return rl.question(`  ? ${q}: `);
}

// ── Step 1: Pre-flight ─────────────────────────────────────────────────────

console.log('\nFables Install\n');
console.log('This script will build Fables and optionally configure run-on-boot.\n');

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  fail(`Node.js v${process.versions.node} detected — Fables requires >= 22.`);
  console.log('Install the latest LTS from https://nodejs.org or via nvm: nvm install 22');
  process.exit(1);
}
ok(`Node.js ${process.versions.node}`);

try {
  const v = execSync('pnpm --version', { encoding: 'utf8' }).trim();
  ok(`pnpm ${v}`);
} catch {
  fail('pnpm not found. Install via: corepack enable && corepack prepare pnpm@latest --activate');
  process.exit(1);
}

// ── Step 2: Install dependencies ──────────────────────────────────────────

hr();
info('Installing dependencies (pnpm install)…');
const install = spawnSync('pnpm', ['install', '--frozen-lockfile'], { stdio: 'inherit' });
if (install.status !== 0) {
  fail('pnpm install failed.');
  process.exit(1);
}
ok('Dependencies installed.');

// ── Step 3: Run doctor ────────────────────────────────────────────────────

hr();
info('Running environment checks…');
spawnSync('node', ['scripts/doctor.mjs'], { stdio: 'inherit' });

// ── Step 4: Build ─────────────────────────────────────────────────────────

hr();
info('Building all packages (pnpm build)…');
const build = spawnSync('pnpm', ['build'], { stdio: 'inherit' });
if (build.status !== 0) {
  fail('Build failed. Check output above.');
  process.exit(1);
}
ok('Build complete.');

// ── Step 5: Optional autostart ───────────────────────────────────────────

hr();
const platform = os.platform();
const repoRoot = process.cwd();
const username = os.userInfo().username;
const dataDir = path.join(os.homedir(), '.fables');

if (platform === 'darwin') {
  const answer = await ask('Configure launchd autostart? (y/N)');
  if (answer.trim().toLowerCase() === 'y') {
    const plistSrc = path.join(repoRoot, 'deploy', 'fables.plist');
    const plistDest = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.fables.server.plist');

    let plistContent = fs.readFileSync(plistSrc, 'utf8');
    plistContent = plistContent.replaceAll('YOUR_USERNAME', username);
    plistContent = plistContent.replaceAll(
      '/Users/YOUR_USERNAME/fables',
      repoRoot,
    );
    // Detect node path.
    let nodePath = '/usr/local/bin/node';
    try {
      nodePath = execSync('which node', { encoding: 'utf8' }).trim();
    } catch { /* fallback */ }
    plistContent = plistContent.replace('/usr/local/bin/node', nodePath);

    fs.mkdirSync(path.dirname(plistDest), { recursive: true });
    fs.writeFileSync(plistDest, plistContent);
    info(`Plist written to ${plistDest}`);

    try {
      execSync(`launchctl load ${plistDest}`, { stdio: 'ignore' });
      ok('Fables registered with launchd (starts on next login).');
    } catch {
      warn('Could not load plist automatically. Run manually:');
      warn(`  launchctl load ${plistDest}`);
    }
  }
} else if (platform === 'linux') {
  const answer = await ask('Configure systemd autostart? (y/N)');
  if (answer.trim().toLowerCase() === 'y') {
    const svcSrc = path.join(repoRoot, 'deploy', 'fables.service');
    let svcContent = fs.readFileSync(svcSrc, 'utf8');
    svcContent = svcContent.replaceAll('YOUR_USERNAME', username);
    svcContent = svcContent.replaceAll('/home/YOUR_USERNAME/fables', repoRoot);

    const dest = `/etc/systemd/system/fables.service`;
    info(`To enable systemd, run:`);
    info(`  sudo tee ${dest} << 'EOF'`);
    console.log(svcContent);
    info('EOF');
    info('  sudo systemctl daemon-reload && sudo systemctl enable --now fables');
  }
}

// ── Step 6: First run instructions ───────────────────────────────────────

hr();
console.log('Fables is ready!\n');
console.log('  Start the server:  pnpm start');
console.log('  Or in dev mode:    pnpm dev');
console.log(`  Data directory:    ${dataDir}`);
console.log('');
console.log('  Phone access (Tailscale):');
console.log('    1. Run: tailscale serve --bg 4870');
console.log('    2. Open the printed ts.net URL on your iPhone.');
console.log('    3. Safari → Share → Add to Home Screen.');
console.log('');

rl.close();
