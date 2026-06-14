/**
 * Encrypted sync payload tests (F1251, F1252, F1258).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as Y from 'yjs';
import { cryptoReady, generateDataKey, utf8ToBytes, type SecretKey } from '@fables/core';
import {
  encryptUpdate,
  decryptUpdate,
  encryptOpPayload,
  decryptOpPayload,
  isEncryptedPayload,
} from './encrypted.js';

let key: SecretKey;
let otherKey: SecretKey;

beforeAll(async () => {
  await cryptoReady();
  key = (await generateDataKey()) as unknown as SecretKey;
  otherKey = (await generateDataKey()) as unknown as SecretKey;
});

describe('encrypted op-log payloads (F1251)', () => {
  it('round-trips a JSON op payload', async () => {
    const payload = JSON.stringify({ type: 'note.update', id: 'n1', body: 'the secret plan' });
    const ct = await encryptOpPayload(payload, key);
    expect(ct).not.toContain('secret plan');
    expect(await decryptOpPayload(ct, key)).toBe(payload);
  });

  it('a different key cannot read the payload', async () => {
    const ct = await encryptOpPayload('classified', key);
    await expect(decryptOpPayload(ct, otherKey)).rejects.toThrow();
  });

  it('produces distinct ciphertext for identical payloads (fresh nonce)', async () => {
    const a = await encryptOpPayload('same', key);
    const b = await encryptOpPayload('same', key);
    expect(a).not.toBe(b);
    expect(await decryptOpPayload(a, key)).toBe('same');
  });
});

describe('encrypted CRDT updates (F1252)', () => {
  it('relays an encrypted Yjs update between peers without the relay reading it', async () => {
    // Author edits their doc and produces an update.
    const author = new Y.Doc();
    const updates: Uint8Array[] = [];
    author.on('update', (u: Uint8Array) => updates.push(u));
    author.getText('body').insert(0, 'The treasure is behind the third stone.');
    const update = updates[0]!;

    // Seal it for the (untrusted) relay.
    const sealed = await encryptUpdate(update, key);
    expect(isEncryptedPayload(sealed)).toBe(true);
    // The relay sees only ciphertext — no plaintext leaks.
    const asText = Buffer.from(sealed).toString('latin1');
    expect(asText).not.toContain('treasure');

    // A peer that shares the key decrypts and applies it → converges.
    const peer = new Y.Doc();
    const recovered = await decryptUpdate(sealed, key);
    Y.applyUpdate(peer, recovered);
    expect(peer.getText('body').toString()).toBe('The treasure is behind the third stone.');

    author.destroy();
    peer.destroy();
  });

  it('tampered ciphertext is rejected', async () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    doc.getText('t').insert(0, 'x');
    const sealed = await encryptUpdate(updates[0]!, key);
    sealed[sealed.length - 1] = (sealed[sealed.length - 1]! ^ 0x01) & 0xff;
    await expect(decryptUpdate(sealed, key)).rejects.toThrow();
    doc.destroy();
  });

  it('binary round-trip is lossless', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    const sealed = await encryptUpdate(bytes, key);
    expect([...(await decryptUpdate(sealed, key))]).toEqual([...bytes]);
  });
});

describe('server-compromise property (F1258)', () => {
  it('a store holding only ciphertext reveals no content', async () => {
    const secrets = ['alpha', 'bravo', 'charlie'];
    // Simulate the server op store: it only ever holds the sealed blobs.
    const store: Uint8Array[] = [];
    for (const secret of secrets) {
      store.push(await encryptUpdate(await utf8ToBytes(secret), key));
    }
    const dump = store.map((b) => Buffer.from(b).toString('latin1')).join('');
    for (const secret of secrets) expect(dump).not.toContain(secret);

    // But a keyholder recovers everything.
    const recovered: string[] = [];
    for (const b of store) recovered.push(new TextDecoder().decode(await decryptUpdate(b, key)));
    expect(recovered).toEqual(secrets);
  });
});
