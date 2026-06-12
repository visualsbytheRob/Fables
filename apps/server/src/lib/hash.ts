import { createHash } from 'node:crypto';

/** Hex-encoded sha256 — used for revision content hashes and content-addressed attachments. */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
