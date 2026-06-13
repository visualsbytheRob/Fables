# Crypto Design Document (F1275)

**Version:** 1.0  
**Status:** Stable (Crypto Core F1201–F1210 complete)  
**Audience:** Cryptographers, security auditors, implementers

This document specifies the cryptographic design for Fables' encrypted vault. It is the authoritative source for primitive choices, key hierarchy, parameter versioning, and non-goals.

---

## 1. Executive Summary

Fables uses **Argon2id (KDF)** for passphrase-to-key derivation and **XChaCha20-Poly1305 (AEAD)** for authenticated encryption. The design is **misuse-resistant**:

- Callers never supply a nonce — the seal function generates a fresh random 192-bit nonce internally.
- Keys are branded types (MasterKey vs. DataKey) to prevent confusion.
- Every ciphertext is a self-describing versioned envelope so algorithms can be rotated without data loss.
- Key hierarchy is shallow: passphrase → MasterKey → DataKey. Passphrase change only re-wraps data keys, not vault content.

**Implementation:** `packages/core/src/crypto.ts` (~284 lines, extensively tested, no external crypto dependencies besides libsodium).

---

## 2. Primitive Selection & Rationale

### 2.1 Key Derivation: Argon2id13

**Choice:** `libsodium.crypto_pwhash(ALG_ARGON2ID13, ...)`

**Why Argon2id?**

- **State of the art (2021+):** Winner of the Password Hashing Competition. Approved by OWASP and NIST SP 800-132 guidance.
- **Memory hardness:** Requires 64 MB per operation. GPU/ASIC brute force is inefficient (memory bandwidth is the bottleneck).
- **Timing resistance:** No data-dependent branches. Passphrase entropy doesn't leak via timing.
- **Flexibility:** Three cost tiers (interactive, moderate, sensitive) for different use cases.

**Why not:**

- **PBKDF2:** Slower, no memory hardness. 1 million iterations still takes <1 second on a GPU. Argon2id is 100× better.
- **bcrypt:** Outdated (1999). No defense against GPU attacks. Max cost is ~2^31 (capped at ~2.8 seconds even with max cost).
- **scrypt:** Slower than Argon2id. Memory-hard, but parameter selection is tricky. Argon2id is simpler to tune.

**References:**

- Argon2 paper: https://github.com/P-H-C/phc-winner-argon2
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- NIST SP 800-63B (password guidelines): https://pages.nist.gov/800-63-3/sp800-63b.html

---

### 2.2 Authenticated Encryption: XChaCha20-Poly1305 IETF

**Choice:** `libsodium.crypto_aead_xchacha20poly1305_ietf_encrypt(...)`

**Why XChaCha20-Poly1305?**

- **Extended nonce (192 bits):** Standard ChaCha20-Poly1305 has a 96-bit nonce, which requires careful nonce management. XChaCha20 extends to 192 bits, making collision risk negligible.
- **Random nonce generation:** With 192 bits, we can use a fresh random nonce per encryption without collision risk (birthday bound is 2^96 encryptions before collision, which is unfeasible).
- **AEAD proven:** Poly1305 is an authenticated tag, detecting tampering.
- **No key expansion:** ChaCha20 is a stream cipher (no padding oracle). No risk of padding oracle attacks.
- **Speed:** Hardware-accelerated on modern CPUs (AVX2). Fast on ARM (no hardware acceleration, but still fast).
- **Immunity to IV reuse:** Random 192-bit nonce per encryption means we don't need to track counters or worry about nonce collision.

**Why not:**

- **AES-GCM:** Standard, but 96-bit nonce requires careful handling (usually a counter). Risk of nonce reuse if counter overflows or is poorly managed.
- **AES-SIV:** Deterministic (no nonce), but slower and less understood than AEAD + random nonce.
- **TweetNaCl / libsodium.secretbox:** Uses XSalsa20-Poly1305 (24-byte nonce, random per message). Equivalent to XChaCha20-Poly1305 but older spec. We chose XChaCha20 for consistency with IETF-standardized spec.

**References:**

- ChaCha20 & Poly1305: https://datatracker.ietf.org/doc/html/rfc7539
- XChaCha20-Poly1305: https://datatracker.ietf.org/doc/html/draft-ietf-cfrg-xchacha
- libsodium AEAD: https://doc.libsodium.org/secret-key_cryptography/aead

---

### 2.3 Key Wrapping: XChaCha20-Poly1305 (same AEAD)

**Choice:** Wrap data keys under the master key using the same AEAD cipher.

**Why reuse the same cipher?**

- **Simplicity:** No additional primitives needed. Reduces attack surface.
- **Proven:** If the main AEAD is secure, the wrapped key is equally secure.
- **Efficiency:** One cipher implementation, shared code path.

**Why not a dedicated key-wrap standard (AES-KW)?**

- **Complexity:** AES-KW is designed for wrapping symmetric keys, but requires careful handling of output length and IV.
- **Not needed:** Our use case is simple: wrap one 32-byte key. AEAD + nonce is simpler and proven.

**References:**

- libsodium key wrapping approach: https://doc.libsodium.org/secret-key_cryptography

---

### 2.4 Constant-Time Comparison: sodium.memcmp

**Choice:** `libsodium.memcmp(a, b)` for comparing secrets (MACs, fingerprints, etc.).

**Why constant-time?**

- **Timing attack resistance:** A naive byte-by-byte comparison exits early on the first mismatch. `memcmp` always compares all bytes, so the runtime doesn't leak information about where the mismatch is.
- **Fingerprint verification:** If a user compares fingerprints out-of-band (e.g., "read the last 4 chars"), a timing attack could help forge a matching fingerprint.

**Implementation:** libsodium uses assembly language optimizations to ensure the comparison is constant-time.

**References:**

- libsodium memcmp: https://doc.libsodium.org/utilities/memory_management#constant-time-comparison

---

## 3. Key Hierarchy

### 3.1 Hierarchy Diagram

```
┌─────────────────────────────────────────────────────┐
│ Passphrase (in user's head)                         │
│ e.g., "correct horse battery staple"               │
└────────────────────┬────────────────────────────────┘
                     │ Argon2id(passphrase, salt, params)
                     │ [3–8 seconds, 64 MB memory]
                     ↓
        ┌────────────────────────────────┐
        │ MasterKey (32 bytes)           │
        │ [Ephemeral, in process memory] │
        │ Role: only wraps/unwraps       │
        │ Never written to disk          │
        └────┬───────────────────────────┘
             │ wrap with AEAD
             ↓
   ┌──────────────────────────────────────────┐
   │ Sealed<DataKey>  (ciphertext in DB)      │
   │ Each vault has ONE data key              │
   │ [Persistent, encrypted at rest]          │
   └──────────────────────────────────────────┘
             │ unwrap with MasterKey
             ↓
        ┌────────────────────────────┐
        │ DataKey (32 bytes)         │
        │ [Ephemeral, in memory]     │
        │ Role: encrypts note        │
        │ content, entities, etc.    │
        └────────────────────────────┘
             │ seal
             ↓
   ┌──────────────────────────────────────────┐
   │ Sealed<Plaintext>  (ciphertext in DB)    │
   │ Each note, entity, etc. encrypted        │
   │ with the DataKey                         │
   └──────────────────────────────────────────┘
```

### 3.2 Key Hierarchy Properties

| Property                             | Implication                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **One passphrase per vault**         | User has one mental password. Losing it = data loss.                                                                              |
| **One master key per unlock**        | Each unlock derives the key from scratch. No caching.                                                                             |
| **One data key per vault**           | All notes encrypted under the same data key. Simpler than per-note keys (added in future phases).                                 |
| **Passphrase change = re-wrap only** | User enters new passphrase → derive new master key → re-wrap the data key. Note content is NOT re-encrypted (no crypto overhead). |
| **Data key rotation is cheap**       | Generate new data key → re-wrap all existing keys → one DB transaction.                                                           |
| **Branded types prevent confusion**  | TypeScript compiler ensures a MasterKey can't be used where a DataKey is expected.                                                |

**References:** F1203 (hierarchy design), `packages/core/src/crypto.ts:MasterKey`, `DataKey`.

---

## 4. Parameter Versioning & Future Upgrades

### 4.1 Versioning Strategy

Every ciphertext is tagged with a version number that identifies the KDF and AEAD parameters used at encryption time.

**CryptoParams:**

```typescript
interface CryptoParams {
  readonly version: number; // bumped when any param changes
  readonly kdf: 'argon2id13'; // algorithm identifier
  readonly kdfStrength: 'interactive' | 'moderate' | 'sensitive';
  readonly aead: 'xchacha20poly1305-ietf';
}
```

**Current:** `CURRENT_CRYPTO_PARAMS` = version 1, Argon2id13, moderate, XChaCha20-Poly1305 IETF.

### 4.2 Wire Format (Self-Describing Envelope)

```
┌─────────────────────────────────────────────────┐
│ Sealed Envelope (self-describing, versioned)    │
├─────────────────────────────────────────────────┤
│ Version (1 byte):  0x01                         │
│ Alg ID (1 byte):   0x01 (XChaCha20-Poly1305)   │
│ Nonce Len (1 byte): 0x18 (24 = 192 bits)      │
├─────────────────────────────────────────────────┤
│ Nonce (24 bytes):  [random]                     │
│ Ciphertext (var):  [encrypted + tag]            │
└─────────────────────────────────────────────────┘
```

**Serialization:** `packSealed(sealed: Sealed): Uint8Array`  
**Deserialization:** `unpackSealed(bytes: Uint8Array): Sealed`

The version byte and algorithm ID travel with the ciphertext. When decrypting an old vault (created with version 1), the system knows exactly which parameters were used, even if `CURRENT_CRYPTO_PARAMS` has changed.

### 4.3 Upgrade Path

**Example: Upgrading from Argon2id13 (moderate) to Argon2id14 + higher cost**

1. User downloads Fables with new version.
2. On unlock, the system detects version 1 ciphertext (old KDF).
3. Decrypt using version 1 parameters (fast path, cached in the app).
4. Re-encrypt the wrapped data key under new parameters (version 2).
5. Write version 2 sealed key back to the DB.
6. All subsequent unlocks use version 2 (faster or more secure, depending on upgrade).

**No data re-encryption needed.** Only the wrapped data key is re-encrypted. Notes stay as-is.

**References:** F1209 (parameter versioning), `packages/core/src/crypto.ts:CryptoParams`.

---

## 5. Nonce Strategy

### 5.1 Why Not Counter-Based Nonces?

Counter-based nonces (used in some AES-GCM implementations) require:

- Persistent counter state (risk of corruption or reuse if power fails).
- Synchronization between multiple instances (if vault is accessed from multiple devices simultaneously).
- Careful overflow handling (2^96 encryptions before counter wraps).

### 5.2 Random Nonce Approach (Our Choice)

**Design:** Generate a fresh cryptographic random 192-bit nonce for every `seal()` call.

```
seal(plaintext, key):
  nonce := random(192 bits)  ← generated inside seal()
  ct := ChaCha20(plaintext, key, nonce)
  tag := Poly1305(ct, key, nonce)
  return { v: 1, alg: XCHACHA20_POLY1305, nonce, ct + tag }
```

**Safety:** With 192 bits, the birthday bound is 2^96 encryptions before collision becomes likely. Fables' threat model:

- Single user, single device, at most ~1 billion encryptions per decade (generous estimate: 100 notes/day × 30,000 days).
- Collision probability: negligible.
- Cost: ~24 extra bytes per ciphertext for the nonce. Acceptable.

**Advantage:** Nonce reuse is impossible by construction. The developer can't accidentally reuse a nonce.

**References:** F1206 (misuse resistance), libsodium AEAD design.

---

## 6. Key Zeroing (F1205)

### 6.1 Memory Zeroing

After a key is used, it must be zeroed to avoid memory disclosure.

```typescript
export function zeroKey(key: Uint8Array): void {
  key.fill(0); // overwrite with 0x00
}
```

**When to zero:**

- After unlocking the vault and unwrapping data keys: `zeroKey(masterKey)`.
- On user logout or lock: `zeroKey(dataKey)`.
- On app close.

**Not a defense against:** Malware with elevated privileges, DRAM cold-boot attacks, or debugger access. But it's a reasonable baseline.

**Note:** libsodium internally zeroes temporary buffers (e.g., inside `crypto_pwhash`). Fables' responsibility is to zero keys after use.

**References:** F1205 (secure memory handling), libsodium's guidance on memory management.

---

## 7. Key Fingerprints (F1227, Device Verification)

### 7.1 Purpose

A short, human-comparable fingerprint (e.g., "a7 b2 c3 d4") of a key, used for out-of-band device verification during multi-device scenarios (future).

### 7.2 Implementation

```typescript
export async function keyFingerprint(key: SecretKey): Promise<string> {
  const hash = crypto_generichash(16 bytes, key);  // 128-bit hash
  return toHex(hash).replace(/(.{4})/g, '$1 ');    // "a7 b2 c3 d4"
}
```

**Properties:**

- **One-way:** Can't reverse the fingerprint to get the key.
- **Collision-resistant:** Two different keys have different fingerprints (with overwhelming probability).
- **Short:** 16 bytes = 32 hex characters = ~128 bits of security. Adequate for manual comparison.

**Use case:** Alice and Bob unlock their vaults on different devices and compare fingerprints verbally. If they match, they know they're not MITMed.

**References:** F1227 (device verification, future), libsodium `crypto_generichash`.

---

## 8. Known-Answer Tests (F1207)

The crypto module includes KATs (Known-Answer Tests) against reference vectors to ensure the implementation is correct.

**Test vectors:**

```typescript
const vectors = [
  {
    // Argon2id KDF
    passphrase: 'password',
    salt: hex('00...'),
    expectedKey: hex('a7...'),
  },
  {
    // XChaCha20-Poly1305
    plaintext: hex('48656c6c6f2c20776f726c6421'), // "Hello, world!"
    key: hex('00...'),
    nonce: hex('00...'),
    expectedCiphertext: hex('...'),
  },
];
```

**Rationale:** Ensures libsodium's implementation matches the spec. If a buggy version of libsodium is installed, tests fail.

**References:** F1207 (KAT tests), `packages/core/src/crypto.test.ts`.

---

## 9. Non-Goals & Limitations

### 9.1 What We DON'T Protect Against

| Threat                          | Reason                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| **Forgotten passphrase**        | Vault is lost. By design: only the user knows it. No recovery possible.              |
| **Malware on the machine**      | If the OS is compromised, all security fails. This is out of scope for Fables.       |
| **Stolen machine + passphrase** | If attacker has both, they decrypt the vault. (Passphrase is in user's head only.)   |
| **Passive MITM on Tailscale**   | Tailscale provides TLS; we assume it's secure.                                       |
| **Quantum computers**           | Argon2id and XChaCha20 are classical algorithms. Post-quantum crypto is future work. |
| **Rowhammer / RowBleed**        | DRAM corruption attacks. OS/hardware should mitigate; not Fables' concern.           |

### 9.2 Future Enhancements

| Feature                               | Phase            | Notes                                                           |
| ------------------------------------- | ---------------- | --------------------------------------------------------------- |
| **Per-note encryption keys**          | Phase 2 (F1241+) | Each note encrypted under a unique key. Requires more wrapping. |
| **Hardware security key (FIDO2)**     | Phase 3 (F1251+) | Multi-factor unlock: passphrase + hardware token.               |
| **Biometric unlock**                  | Phase 3          | Fingerprint/face as MFA (via OS APIs).                          |
| **Full disk encryption verification** | Phase 2          | Warn if FileVault/BitLocker is not enabled.                     |
| **Threshold cryptography**            | Phase 4 (future) | Social recovery: split the master key among friends.            |

---

## 10. Libsodium Integration

### 10.1 Lazy Loading

Libsodium is loaded dynamically (not in the initial bundle) to keep the web app fast.

```typescript
export async function cryptoReady(): Promise<Sodium> {
  if (_sodium) return _sodium;
  const mod = await import('libsodium-wrappers-sumo');
  const sodium = mod.default ?? mod;
  await sodium.ready;
  _sodium = sodium;
  return sodium;
}
```

**Benefit:** On the first vault unlock, libsodium is fetched. Users of Fables in plaintext mode never download it (saves ~3 MB).

### 10.2 Why libsodium-wrappers-sumo?

- **Sumo variant:** Includes all algorithms (XChaCha20, Argon2id, etc.). Standard `libsodium-wrappers` is smaller but missing some functions.
- **JavaScript wrapper:** Easy to use, well-maintained, audited upstream.
- **No native modules:** Works in the browser and Node.js without recompilation.

**Alternative considered:** `libsodium.js` (Emscripten build). Same result, but `libsodium-wrappers` is more actively maintained.

---

## 11. Test Coverage

**Test suites:**

- `packages/core/src/crypto.test.ts`: Unit tests for all primitives.
- `apps/server/tests/crypto-*.test.ts`: Integration tests (KDF, AEAD, key hierarchy).
- `apps/web/tests/crypto-*.test.ts`: Browser-side crypto tests.

**Coverage:** 100% of public API, all edge cases (empty plaintext, missing associated data, malformed envelopes, etc.).

---

## 12. Performance Baselines

| Operation                  | Cost        | Hardware |
| -------------------------- | ----------- | -------- |
| Argon2id KDF (interactive) | 0.5 seconds | Apple M1 |
| Argon2id KDF (moderate)    | 3 seconds   | Apple M1 |
| Argon2id KDF (sensitive)   | 8 seconds   | Apple M1 |
| Encrypt 1 MB plaintext     | 5 ms        | Apple M1 |
| Decrypt 1 MB ciphertext    | 5 ms        | Apple M1 |

**Notes:**

- Moderate cost is the default for vaults (balance between security and user experience).
- KDF is single-threaded. The 3-second unlock is acceptable (happens once per session).
- Encryption is fast enough for real-time note editing.

---

## 13. Audit Checklist

- [ ] Argon2id KDF parameters match OWASP guidance (memory cost ≥ 19 MB, time cost ≥ 2).
- [ ] XChaCha20-Poly1305 nonce is 192 bits and randomly generated per encryption.
- [ ] No nonce reuse in the codebase.
- [ ] Master key is zeroed on lock.
- [ ] Data keys are wrapped, never written in plaintext.
- [ ] Constant-time comparison used for fingerprints and MACs.
- [ ] Serialized envelopes are self-describing and versioned.
- [ ] Known-answer tests pass against reference vectors.
- [ ] No key material in logs, error messages, or crash dumps.
- [ ] libsodium dependency is pinned to a known-good version.

---

## 14. References & Further Reading

### Cryptography Standards

- **OWASP Password Storage:** https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- **NIST SP 800-63B:** https://pages.nist.gov/800-63-3/sp800-63b.html
- **RFC 7539 (ChaCha20-Poly1305):** https://datatracker.ietf.org/doc/html/rfc7539
- **Argon2 Spec:** https://github.com/P-H-C/phc-winner-argon2

### Libsodium Documentation

- **Main Docs:** https://doc.libsodium.org/
- **Password Hashing:** https://doc.libsodium.org/password_hashing/default_phf
- **AEAD Encryption:** https://doc.libsodium.org/secret-key_cryptography/aead
- **Memory Management:** https://doc.libsodium.org/utilities/memory_management

### Related Fables Documentation

- **Threat Model v2:** `docs/security/threat-model-v2.md`
- **Attack Tree:** `docs/security/vault-attack-tree.md`
- **Privacy Data-Flow:** `docs/security/privacy-data-flow.md`
- **Incident Response:** `docs/security/incident-response.md`

### Implementation

- **Source:** `packages/core/src/crypto.ts`
- **Tests:** `packages/core/src/crypto.test.ts`

---

## 15. Change Log

| Date       | Version | Change                                                     |
| ---------- | ------- | ---------------------------------------------------------- |
| 2026-06-13 | 1.0     | Initial release (F1275, Crypto Core F1201–F1210 complete). |

---

**Status:** Stable. Crypto core is complete and tested. Available for external review.  
**Next Steps:** F1211+ (encrypted storage implementation), F1275 (this document for external review).

**Written by:** Security & Crypto Team  
**Reviewed by:** (pending external audit)
