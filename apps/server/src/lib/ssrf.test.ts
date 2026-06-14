/**
 * SSRF guard tests (F1268).
 */

import { describe, it, expect, vi } from 'vitest';
import { assertSafeUrl, isPrivateIPv4, isPrivateIPv6 } from './ssrf.js';

describe('isPrivateIPv4', () => {
  it('flags private/reserved ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254', // cloud metadata
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isPrivateIPv4(ip)).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1']) {
      expect(isPrivateIPv4(ip)).toBe(false);
    }
  });
});

describe('isPrivateIPv6', () => {
  it('flags loopback, ULA, link-local, mapped-private', () => {
    for (const ip of [
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateIPv6(ip)).toBe(true);
    }
  });

  it('allows a public v6 address', () => {
    expect(isPrivateIPv6('2606:4700:4700::1111')).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(assertSafeUrl('gopher://x/')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects literal private/loopback/metadata IPs', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(assertSafeUrl('http://10.0.0.5:8080/x')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(assertSafeUrl('http://[::1]/')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('allows a public literal IP (no DNS needed)', async () => {
    const url = await assertSafeUrl('https://8.8.8.8/resolve');
    expect(url.hostname).toBe('8.8.8.8');
  });

  it('rejects a hostname that resolves to a private address (DNS-rebinding)', async () => {
    const dns = await import('node:dns');
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '10.0.0.99', family: 4 },
    ] as never);
    await expect(assertSafeUrl('http://evil.example.com/')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    vi.restoreAllMocks();
  });

  it('allows a hostname that resolves to a public address', async () => {
    const dns = await import('node:dns');
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
    const url = await assertSafeUrl('https://example.com/page');
    expect(url.hostname).toBe('example.com');
    vi.restoreAllMocks();
  });

  it('rejects a malformed URL', async () => {
    await expect(assertSafeUrl('not a url')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
