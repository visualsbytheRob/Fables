/**
 * SSRF guard for outbound URL fetches (F1268).
 *
 * The web clipper and importers fetch arbitrary user-supplied URLs. Without a
 * guard, a URL like `http://169.254.169.254/…` or `http://localhost:port/…`
 * could be used to reach cloud metadata endpoints or services bound to the
 * Fables host. `assertSafeUrl` enforces:
 *   - http/https only (no file:, gopher:, etc.)
 *   - the hostname must resolve, and EVERY resolved address must be a public
 *     unicast address — literal private/loopback/link-local/reserved IPs are
 *     rejected, and so is a hostname that *resolves* to one (DNS-rebinding).
 */

import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { validation } from '@fables/core';

/** True for an IPv4 address in a private, loopback, link-local or reserved range. */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // not a clean IPv4 → treat as unsafe
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 (test nets)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a >= 224) return true; // multicast + reserved (224.0.0.0/4, 240.0.0.0/4)
  return false;
}

/** True for an IPv6 address that is loopback/unspecified/ULA/link-local/multicast. */
export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) → check the embedded v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  const first = lower.split(':')[0] ?? '';
  const head = parseInt(first || '0', 16);
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isPrivateIPv4(ip);
  if (fam === 6) return isPrivateIPv6(ip);
  return true; // not an IP literal → unsafe
}

/**
 * Validate an outbound URL against SSRF. Returns the parsed URL when safe;
 * throws a VALIDATION AppError otherwise. Resolves DNS so a public hostname that
 * points at a private address is still rejected.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw validation('invalid URL', { url: rawUrl });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw validation('only http(s) URLs are allowed', { protocol: url.protocol });
  }
  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Literal IP → check directly (no DNS).
  if (isIP(host) !== 0) {
    if (isPrivateAddress(host)) {
      throw validation('refusing to fetch a private/reserved address', { host });
    }
    return url;
  }

  // Hostname → resolve and reject if ANY address is private (DNS-rebinding safe).
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw validation('could not resolve host', { host });
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw validation('host resolves to a private/reserved address', { host });
  }
  return url;
}

/** A `fetch` that refuses SSRF-unsafe targets before issuing the request. */
export async function safeFetch(rawUrl: string, init?: RequestInit): Promise<Response> {
  await assertSafeUrl(rawUrl);
  return fetch(rawUrl, init);
}
