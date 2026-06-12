#!/usr/bin/env node
/**
 * Fails CI when the web bundle exceeds budget. Run after `pnpm build`.
 * Initial-load JS (scripts referenced from index.html) is the budget that
 * matters; lazy route chunks get a looser total cap.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BUDGET_INITIAL_GZIP_KB = 350;
const BUDGET_TOTAL_GZIP_KB = 2048;
const distDir = path.resolve('apps/web/dist');
const assetsDir = path.join(distDir, 'assets');

if (!fs.existsSync(assetsDir)) {
  console.error('no web build found — run `pnpm build` first');
  process.exit(1);
}

const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const initialFiles = new Set([...html.matchAll(/assets\/([^"']+\.js)/g)].map((m) => m[1]));

const gzipKb = (file) => zlib.gzipSync(fs.readFileSync(path.join(assetsDir, file))).length / 1024;

let initial = 0;
let total = 0;
for (const file of fs.readdirSync(assetsDir)) {
  if (!file.endsWith('.js')) continue;
  const kb = gzipKb(file);
  total += kb;
  const isInitial = initialFiles.has(file);
  if (isInitial) initial += kb;
  console.log(`  ${isInitial ? 'entry' : ' lazy'} ${file}: ${kb.toFixed(1)} KB gzip`);
}

console.log(
  `initial JS: ${initial.toFixed(1)} KB gzip (budget ${BUDGET_INITIAL_GZIP_KB} KB); ` +
    `total: ${total.toFixed(1)} KB (cap ${BUDGET_TOTAL_GZIP_KB} KB)`,
);
if (initial > BUDGET_INITIAL_GZIP_KB || total > BUDGET_TOTAL_GZIP_KB) {
  console.error('bundle size budget exceeded');
  process.exit(1);
}
