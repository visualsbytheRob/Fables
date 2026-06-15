/**
 * TtsRuntime tests (F1601/F1602/F1610) — adapter selection + graceful degradation.
 */

import { describe, expect, it } from 'vitest';
import { TtsRuntime } from './runtime.js';
import { MockTtsAdapter } from './mock-adapter.js';

describe('TtsRuntime', () => {
  it('is unavailable with no adapters', async () => {
    const rt = new TtsRuntime();
    expect(await rt.isAvailable()).toBe(false);
    expect(await rt.listVoices()).toEqual([]);
    await expect(rt.synthesize({ text: 'hi' })).rejects.toThrow(/no speech engine/);
  });

  it('routes to the first available adapter', async () => {
    const down = new MockTtsAdapter();
    down.available = false;
    const up = new MockTtsAdapter();
    const rt = new TtsRuntime().register(down).register(up);

    expect(await rt.isAvailable()).toBe(true);
    expect(await rt.activeAdapter()).toBe(up);
    const res = await rt.synthesize({ text: 'hello' });
    expect(res.format).toBe('wav');
    expect(up.calls).toBe(1);
    expect(down.calls).toBe(0);
  });

  it('exposes the active voice catalog (F1602)', async () => {
    const rt = new TtsRuntime().register(new MockTtsAdapter());
    const voices = await rt.listVoices();
    expect(voices.map((v) => v.id)).toContain('mock-amy');
  });

  it('the disable switch turns every engine off', async () => {
    const rt = new TtsRuntime().register(new MockTtsAdapter());
    rt.setDisabled(true);
    expect(rt.isDisabled).toBe(true);
    expect(await rt.isAvailable()).toBe(false);
    expect(await rt.listVoices()).toEqual([]);
    await expect(rt.synthesize({ text: 'hi' })).rejects.toThrow();
  });

  it('looks up adapters by name', async () => {
    const mock = new MockTtsAdapter();
    const rt = new TtsRuntime().register(mock);
    expect(rt.adapterNamed('mock')).toBe(mock);
    expect(rt.adapterNamed('nope')).toBeUndefined();
  });
});
