#!/usr/bin/env node
/** Fails CI when the web bundle exceeds budget. Run after `pnpm build`. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BUDGET_GZIP_KB = 350;
const assetsDir = path.resolve('apps/web/dist/assets');

if (!fs.existsSync(assetsDir)) {
  console.error('no web build found — run `pnpm build` first');
  process.exit(1);
}

let totalGzip = 0;
for (const file of fs.readdirSync(assetsDir)) {
  if (!file.endsWith('.js')) continue;
  const gz = zlib.gzipSync(fs.readFileSync(path.join(assetsDir, file))).length;
  totalGzip += gz;
  console.log(`  ${file}: ${(gz / 1024).toFixed(1)} KB gzip`);
}

const totalKb = totalGzip / 1024;
console.log(`total JS: ${totalKb.toFixed(1)} KB gzip (budget ${BUDGET_GZIP_KB} KB)`);
if (totalKb > BUDGET_GZIP_KB) {
  console.error('bundle size budget exceeded');
  process.exit(1);
}
