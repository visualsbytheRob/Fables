/**
 * Plugin network-capability SSRF gating (F1273 — escalation closed).
 *
 * A plugin granted the `network` permission must still not be able to reach
 * private/internal or cloud-metadata addresses through `http.fetch`; the
 * capability is routed through the same SSRF guard as the clipper.
 */

import { describe, it, expect } from 'vitest';
import type { CapabilityCall } from '@fables/plugin-sdk';
import { openDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { buildCapabilityHandler } from './capability-handler.js';

function handler() {
  const db = openDb(':memory:');
  migrate(db);
  return buildCapabilityHandler(db, 'test-plugin');
}

describe('plugin http.fetch is SSRF-guarded (F1273)', () => {
  it('rejects the cloud-metadata address', async () => {
    const call = {
      cap: 'http.fetch',
      params: { url: 'http://169.254.169.254/latest/meta-data/' },
    } as unknown as CapabilityCall;
    await expect(handler()(call)).rejects.toThrow();
  });

  it('rejects a loopback address', async () => {
    const call = {
      cap: 'http.fetch',
      params: { url: 'http://127.0.0.1:8080/internal' },
    } as unknown as CapabilityCall;
    await expect(handler()(call)).rejects.toThrow();
  });

  it('rejects a non-http(s) scheme', async () => {
    const call = {
      cap: 'http.fetch',
      params: { url: 'file:///etc/passwd' },
    } as unknown as CapabilityCall;
    await expect(handler()(call)).rejects.toThrow();
  });
});
