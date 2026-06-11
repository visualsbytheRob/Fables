#!/usr/bin/env node
/**
 * Environment doctor: verifies this machine can run Fables.
 * Exits non-zero if any required check fails.
 */
import { execSync } from 'node:child_process';
import net from 'node:net';

const DEFAULT_PORT = Number(process.env.PORT ?? 4870);
let failures = 0;

function ok(label, detail = '') {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail = '') {
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) ok('Node version', `v${process.versions.node}`);
  else fail('Node version', `v${process.versions.node} (need >= 22, see .nvmrc)`);
}

function checkPnpm() {
  try {
    const v = execSync('pnpm --version', { encoding: 'utf8' }).trim();
    const major = Number(v.split('.')[0]);
    if (major >= 10) ok('pnpm version', v);
    else fail('pnpm version', `${v} (need >= 10)`);
  } catch {
    fail('pnpm', 'not found — install via `corepack enable`');
  }
}

function checkPort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => {
      fail(`Port ${port}`, 'already in use (set PORT to override)');
      resolve();
    });
    srv.once('listening', () => {
      srv.close(() => {
        ok(`Port ${port}`, 'available');
        resolve();
      });
    });
    srv.listen(port, '127.0.0.1');
  });
}

function checkTailscale() {
  try {
    execSync('tailscale status', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    ok('Tailscale', 'running (optional, needed for phone access)');
  } catch {
    console.log('  - Tailscale not detected (optional — only needed for phone access)');
  }
}

console.log('Fables doctor\n');
checkNode();
checkPnpm();
await checkPort(DEFAULT_PORT);
checkTailscale();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll required checks passed.');
