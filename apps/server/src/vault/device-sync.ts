/**
 * Multi-device key exchange + encrypted share grants (Epic 13, F1253–F1257).
 *
 * The crypto core for sharing an encrypted vault's data key with other devices
 * without a server ever seeing it. Each device holds an X25519 keypair; to
 * authorize a device the owner seals the data key to the device's PUBLIC key
 * (libsodium anonymous sealed box), which only that device's secret key can open
 * (F1253). A short fingerprint of the public key drives out-of-band verification
 * (F1254). Revoking a device means rotating the data key and re-granting it to
 * the devices that remain (F1255). Sync envelopes carry only opaque ids +
 * ciphertext — no plaintext metadata (F1257).
 *
 * This is the pure cryptography; the transport that moves grants and envelopes
 * between devices over the tailnet is a separate networking concern.
 */

import { cryptoReady, toBase64, fromBase64 } from '@fables/core';

export interface DeviceKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface DeviceRef {
  id: string;
  publicKey: Uint8Array;
}

export interface DeviceGrant {
  deviceId: string;
  /** The vault key sealed to the device's public key (base64). */
  sealed: string;
}

/** Generate an X25519 keypair for a device (F1253). */
export async function generateDeviceKeypair(): Promise<DeviceKeypair> {
  const sodium = await cryptoReady();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

/**
 * A short, human-comparable fingerprint of a device public key for out-of-band
 * verification (F1254) — e.g. shown beside a QR code on both devices.
 */
export async function deviceFingerprint(publicKey: Uint8Array): Promise<string> {
  const sodium = await cryptoReady();
  const hex = sodium.crypto_generichash(8, publicKey, null, 'hex');
  // Group into 4-char blocks for readability: "a1b2 c3d4 …".
  return (hex.match(/.{1,4}/g) ?? [hex]).join(' ');
}

/** Seal a secret (e.g. the vault data key) to a device's public key (F1253). */
export async function sealForDevice(
  secret: Uint8Array,
  devicePublicKey: Uint8Array,
): Promise<string> {
  const sodium = await cryptoReady();
  return toBase64(sodium.crypto_box_seal(secret, devicePublicKey));
}

/** Open a sealed secret with a device's own keypair. Throws on a wrong key. */
export async function openFromDevice(
  sealedB64: string,
  keypair: DeviceKeypair,
): Promise<Uint8Array> {
  const sodium = await cryptoReady();
  const opened = sodium.crypto_box_seal_open(
    await fromBase64(sealedB64),
    keypair.publicKey,
    keypair.secretKey,
  );
  if (!opened) throw new Error('sealed key could not be opened by this device');
  return opened;
}

/** Grant a key to a set of devices, sealing it to each one (F1256). */
export async function grantKeyToDevices(
  key: Uint8Array,
  devices: DeviceRef[],
): Promise<DeviceGrant[]> {
  const grants: DeviceGrant[] = [];
  for (const device of devices) {
    grants.push({ deviceId: device.id, sealed: await sealForDevice(key, device.publicKey) });
  }
  return grants;
}

/**
 * Rotate after revoking a device (F1255): the caller supplies a freshly
 * generated key and the devices that remain; the revoked device is dropped and
 * the new key is re-granted to the survivors. The revoked device's old grants
 * are now useless because the key has changed.
 */
export async function rotateOnRevoke(
  newKey: Uint8Array,
  remaining: DeviceRef[],
  revokedDeviceId: string,
): Promise<DeviceGrant[]> {
  return grantKeyToDevices(
    newKey,
    remaining.filter((d) => d.id !== revokedDeviceId),
  );
}

export interface MinimalEnvelope {
  /** Opaque record id — no titles, tags or notebooks leak. */
  id: string;
  /** Monotonic version for ordering, not a wall-clock timestamp. */
  v: number;
  /** Base64 ciphertext blob; the only payload. */
  ct: string;
}

export interface SyncRecord {
  id: string;
  version: number;
  ciphertext: string;
  /** Plaintext metadata that MUST NOT cross the wire. */
  title?: string | undefined;
  notebookId?: string | undefined;
  tags?: string[] | undefined;
}

/**
 * Reduce a sync record to a metadata-minimized envelope (F1257): only an opaque
 * id, a version, and the ciphertext survive — titles, notebooks and tags are
 * dropped so an observer learns nothing from the envelope.
 */
export function minimizeEnvelope(record: SyncRecord): MinimalEnvelope {
  return { id: record.id, v: record.version, ct: record.ciphertext };
}
