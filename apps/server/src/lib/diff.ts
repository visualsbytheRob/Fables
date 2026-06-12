/**
 * Word-level diff (F119) — a plain LCS over word/whitespace tokens, written
 * here so the server stays dependency-free. Ops transform `base` into `target`:
 * concatenating `equal` + `del` texts reproduces the base, `equal` + `add` the target.
 */

export interface DiffOp {
  op: 'equal' | 'add' | 'del';
  text: string;
}

/** O(n·m) DP cell budget; beyond this the middle section degrades to del+add. */
const MAX_CELLS = 4_000_000;

/** Splits into word and whitespace tokens; joining tokens reproduces the input exactly. */
export function tokenizeWords(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t !== '');
}

function push(ops: DiffOp[], op: DiffOp['op'], text: string): void {
  if (text === '') return;
  const last = ops[ops.length - 1];
  if (last && last.op === op) last.text += text;
  else ops.push({ op, text });
}

function lcsOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1]! + 1
          : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(ops, 'equal', a[i]!);
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
      push(ops, 'del', a[i]!);
      i += 1;
    } else {
      push(ops, 'add', b[j]!);
      j += 1;
    }
  }
  while (i < n) push(ops, 'del', a[i++]!);
  while (j < m) push(ops, 'add', b[j++]!);
  return ops;
}

/** Word-level diff from `base` to `target`. */
export function diffWords(base: string, target: string): DiffOp[] {
  const a = tokenizeWords(base);
  const b = tokenizeWords(target);

  // Trim the common prefix and suffix so the quadratic part only sees the changed middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd -= 1;
    bEnd -= 1;
  }

  const ops: DiffOp[] = [];
  push(ops, 'equal', a.slice(0, start).join(''));
  const aMid = a.slice(start, aEnd);
  const bMid = b.slice(start, bEnd);
  if (aMid.length * bMid.length > MAX_CELLS) {
    push(ops, 'del', aMid.join(''));
    push(ops, 'add', bMid.join(''));
  } else {
    for (const op of lcsOps(aMid, bMid)) push(ops, op.op, op.text);
  }
  push(ops, 'equal', a.slice(aEnd).join(''));
  return ops;
}
