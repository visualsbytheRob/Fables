# Vault Modes & Migration Guide

Fables stores your notes at one of three confidentiality levels. This guide
explains each, and how to move between them safely (F1297).

## The three modes

### 1. Plaintext vault (default)

No encryption. Note titles and bodies are stored as text in SQLite. Fast,
fully searchable by the normal index, and readable by anyone with the data dir.
Appropriate when the device itself is your security boundary.

### 2. Encrypted vault (whole-vault)

A passphrase (Argon2id) unwraps a data key (XChaCha20-Poly1305) that encrypts
**every** note's title and body at rest. While locked, nothing is readable;
while unlocked, the server holds the data key in memory and transparently
decrypts on read. Normal SQLite FTS can't index ciphertext, so search uses an
in-memory index built after unlock.

### 3. Secret notes (per-note, inside any vault)

A **separate** key path (its own passphrase, independent of the vault) encrypts
_individual_ notes — even inside a plaintext vault. Secret notes are excluded
from search, exports, AI and plugins until the secret box is unlocked, and the
secret session has its own idle timeout. Use this for a handful of sensitive
notes without encrypting the whole vault.

> Secret notes and the encrypted vault are independent and can be combined: a
> note can be secret inside an encrypted vault, protected by both keys.

## Migrations

### Plaintext → encrypted vault (F1215)

1. Create the vault from a passphrase (`POST /vault`). This generates the data
   key and leaves the vault unlocked.
2. Convert existing plaintext notes: `POST /vault/convert { "direction": "encrypt" }`.
   Every plaintext note is re-written as ciphertext and **verified to decrypt
   back to the original** before the pass commits. The operation is idempotent —
   already-encrypted notes are skipped — so it is safe to re-run.

After conversion, lock the vault (`POST /vault/lock`); thereafter every read
requires an unlock.

### Encrypted vault → plaintext

With the vault unlocked, `POST /vault/convert { "direction": "decrypt" }`
rewrites every note back to plaintext. Then wipe the vault config
(`POST /vault/wipe`, which requires re-authentication) to remove the key path.

### Adopting secret notes

No vault change is needed. Create the secret box (`POST /secret`), then mark
notes secret individually (`POST /notes/:id/secret`) or in bulk
(`POST /secret/bulk`). Reveal a note (`DELETE /notes/:id/secret`) to bring it
back to ordinary storage.

## Performance

Field-level AEAD encrypt/decrypt is microsecond-scale (see the benchmark in
`vault/conversion.test.ts`, F1219/F1292): a few thousand notes convert in well
under a second of crypto time, and per-read decryption overhead is negligible
next to SQLite and HTTP costs. The KDF (Argon2id) cost is paid once per unlock,
not per read, and its strength (`interactive`/`moderate`/`sensitive`) is chosen
at vault creation.

## Safety notes

- **Back up before converting.** Conversion is verified and transactional, but a
  backup is cheap insurance.
- **The passphrase is never stored.** If you lose it, encrypted content is
  unrecoverable by design. The vault wipe is the only way out, and it destroys
  the data.
- Secret-box and vault passphrases are independent — losing one doesn't affect
  the other.
