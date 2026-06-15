/**
 * Multi-device key-exchange tests (Epic 13, F1253–F1257, F1260).
 */

import { generateDataKey, toBase64 } from '@fables/core';
import { describe, expect, it } from 'vitest';
import {
  deviceFingerprint,
  generateDeviceKeypair,
  grantKeyToDevices,
  minimizeEnvelope,
  openFromDevice,
  rotateOnRevoke,
  sealForDevice,
} from './device-sync.js';

describe('device key exchange (F1253)', () => {
  it('seals a key to a device and only that device can open it', async () => {
    const phone = await generateDeviceKeypair();
    const laptop = await generateDeviceKeypair();
    const key = await generateDataKey();

    const sealed = await sealForDevice(key, phone.publicKey);
    const opened = await openFromDevice(sealed, phone);
    expect(await toBase64(opened)).toBe(await toBase64(key));

    // The laptop's keypair cannot open a grant sealed to the phone.
    await expect(openFromDevice(sealed, laptop)).rejects.toThrow();
  });
});

describe('device fingerprint (F1254)', () => {
  it('is deterministic and matches the same public key', async () => {
    const kp = await generateDeviceKeypair();
    const a = await deviceFingerprint(kp.publicKey);
    const b = await deviceFingerprint(kp.publicKey);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f ]+$/);
  });

  it('differs for different keys', async () => {
    const k1 = await generateDeviceKeypair();
    const k2 = await generateDeviceKeypair();
    expect(await deviceFingerprint(k1.publicKey)).not.toBe(await deviceFingerprint(k2.publicKey));
  });
});

describe('share grants + rotation (F1255/F1256)', () => {
  it('grants a key to every device', async () => {
    const phone = await generateDeviceKeypair();
    const laptop = await generateDeviceKeypair();
    const key = await generateDataKey();

    const grants = await grantKeyToDevices(key, [
      { id: 'phone', publicKey: phone.publicKey },
      { id: 'laptop', publicKey: laptop.publicKey },
    ]);
    expect(grants.map((g) => g.deviceId).sort()).toEqual(['laptop', 'phone']);

    const phoneGrant = grants.find((g) => g.deviceId === 'phone')!;
    expect(await toBase64(await openFromDevice(phoneGrant.sealed, phone))).toBe(
      await toBase64(key),
    );
  });

  it('revoking a device re-grants a new key only to the survivors', async () => {
    const phone = await generateDeviceKeypair();
    const laptop = await generateDeviceKeypair();
    const stolen = await generateDeviceKeypair();
    const newKey = await generateDataKey();

    const grants = await rotateOnRevoke(
      newKey,
      [
        { id: 'phone', publicKey: phone.publicKey },
        { id: 'laptop', publicKey: laptop.publicKey },
        { id: 'stolen', publicKey: stolen.publicKey },
      ],
      'stolen',
    );
    expect(grants.map((g) => g.deviceId).sort()).toEqual(['laptop', 'phone']);
    expect(grants.find((g) => g.deviceId === 'stolen')).toBeUndefined();
    // The remaining devices get the rotated key.
    const laptopGrant = grants.find((g) => g.deviceId === 'laptop')!;
    expect(await toBase64(await openFromDevice(laptopGrant.sealed, laptop))).toBe(
      await toBase64(newKey),
    );
  });
});

describe('metadata minimization (F1257)', () => {
  it('drops all plaintext metadata from the sync envelope', () => {
    const env = minimizeEnvelope({
      id: 'note_1',
      version: 7,
      ciphertext: 'BASE64CT',
      title: 'My secret diary',
      notebookId: 'nb_private',
      tags: ['personal', 'health'],
    });
    expect(env).toEqual({ id: 'note_1', v: 7, ct: 'BASE64CT' });
    expect(JSON.stringify(env)).not.toMatch(/diary|private|health/);
  });
});
