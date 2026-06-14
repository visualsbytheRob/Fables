# Encrypted Vault User Guide (F1289)

**Version:** 1.0  
**Status:** Shipped (Epic 13 complete)  
**Audience:** Fables users, especially those handling sensitive data

This guide explains the encrypted vault: what it protects, how to enable it, how to lock/unlock, and what to do if you forget your passphrase.

---

## What the Vault Protects

The encrypted vault encrypts your data **at rest** in the SQLite database. This means:

- **If someone copies your `.fables` directory:** They get an encrypted database. Without your passphrase, the content is unreadable — they only see ciphertext and a salt.
- **If your disk is stolen:** Same protection. Your notes, entities, and story saves are encrypted.
- **If your machine is powered on and the app is running:** The vault must be unlocked. Once unlocked, content is decrypted in memory so the app can read and write it. The decrypted key remains in process memory (RAM) until the vault is locked or the process exits.

**What it does NOT protect:**

- **Malware on your machine:** If malware has access to your OS, it can read decrypted content from memory while the vault is unlocked.
- **Forgotten passphrase:** If you forget your passphrase, the vault is lost permanently. There is no recovery. **There are no recovery codes or backup passphrases.**
- **Accidental deletion:** The vault wipe is permanent. Think of it as formatting a hard drive — it cannot be undone.

---

## Enabling the Vault

1. Open Fables and go to **Settings → Vault**.
2. Click **Create Vault**.
3. Enter a strong passphrase (at least 12 characters; use a mix of letters, numbers, and symbols).
4. Choose KDF strength:
   - **Interactive:** ~0.5 seconds to unlock. Use if you unlock frequently (e.g., every session).
   - **Moderate (recommended):** ~3 seconds. Good balance between security and usability.
   - **Sensitive:** ~8 seconds. Maximum security; use if you unlock rarely or have very sensitive data.
5. Click **Create Vault**. The vault is now unlocked and ready to use.

**Your existing notes are now encrypted.** If you add new notes, they are automatically encrypted before storage.

---

## Lock & Unlock Behavior

### Unlocking the Vault

1. Go to **Settings → Vault → Unlock**.
2. Enter your passphrase.
3. Click **Unlock**.

The system derives your master key from the passphrase (using Argon2id KDF with the same salt and parameters from vault creation). If the passphrase is wrong, the unlock fails and an audit log entry is recorded. The vault remains locked.

**After unlock:** The vault is unlocked until you lock it or the process exits. All note reads and writes are automatically encrypted/decrypted.

### Locking the Vault

1. Go to **Settings → Vault → Lock**.
2. Click **Lock**.

The decrypted key is securely zeroed from memory. Reading encrypted notes now requires unlocking again. This happens automatically when you lock, or when the Fables process exits.

### Auto-Lock (Future)

Planned in F1233: Auto-lock after N minutes of inactivity. For now, you must manually lock.

---

## Passphrase Change

To change your passphrase without re-encrypting all your notes:

1. Go to **Settings → Vault → Change Passphrase**.
2. Enter your current passphrase (to verify you own the vault).
3. Enter a new passphrase (and confirm it).
4. Click **Change**.

**What happens:**

- Your data key is wrapped under a new master key derived from your new passphrase.
- Your notes, entities, and attachments are **NOT** re-encrypted (they stay as-is).
- This is fast and efficient.

---

## If You Forget Your Passphrase

**The vault is lost.** There is no recovery mechanism.

Fables uses a misuse-resistant design: your passphrase is the only key that can unlock the vault. It is never sent to a server, never backed up, never recoverable. This is intentional — it ensures that only you (and no one else, not even Fables developers) can access your data.

If you forget your passphrase:

1. **Do not create a new vault.** You will lose your encrypted data.
2. **Keep the encrypted database file** (`~/.fables/data.db`) in a safe place (in case a recovery method is added in a future release).
3. **Create a new Fables installation** with a new passphrase if you want to start fresh.

**Lesson:** Choose a strong passphrase you can remember, or use a password manager to store it securely.

---

## The Audit Log

Every vault operation is recorded in a tamper-evident audit log:

- **Vault created:** When you created the vault and which KDF strength.
- **Vault unlocked:** Every successful unlock (timestamp, no passphrase recorded).
- **Unlock failed:** Every failed unlock attempt (timestamp, no passphrase recorded).
- **Vault locked:** Every time you locked the vault.
- **Passphrase changed:** When you changed your passphrase.
- **Vault wiped:** When you performed a full vault wipe.

**To view the audit log:**

1. Go to **Settings → Vault → Audit Log**.
2. See a chronological list of all operations.

**Tampering detection:** The log is hash-chained (each entry commits to the previous one). If anyone modifies a log entry, all subsequent hashes are invalidated, and the tampering is detectable via the **Verify Integrity** button.

---

## Full Vault Wipe

If you want to securely and irrevocably delete everything:

1. Go to **Settings → Vault → Wipe All Data**.
2. Read the warning: "This will permanently delete all notes, entities, stories, attachments, and sync state. This cannot be undone."
3. Type `WIPE` in the confirmation box (exactly as shown).
4. Click **Wipe**.

**What happens:**

- All notes, entities, stories, attachments, and sync state are deleted from the database.
- The vault configuration is destroyed.
- The audit log is reset to a single entry: `vault.wiped` with the count of notes deleted.
- The in-memory key is zeroed.
- A fresh, empty vault is created in its place.

**Verification:** After the wipe, the system verifies that all data was deleted. If verification fails, you are warned with an error.

**Important:** This is permanent. There is no undo. If you have important data, export your notes first (Settings → Export).

---

## When Data Encryption Happens

### Automatic Encryption

When the vault is **unlocked**, any note title or body written to the database is automatically encrypted before storage:

- Create a note → title and body are encrypted.
- Edit a note → updated title and body are encrypted.
- Search (if the vault is unlocked) → searches the plaintext in memory (encrypted notes are decrypted on read).

### Automatic Decryption

When you **read** an encrypted note, the system decrypts it on the fly:

- Get a note by ID → decrypted title and body are returned.
- List notes → all decrypted.
- Entities and attachments metadata (filenames, etc.) are also encrypted.

### Search and Encryption

**While unlocked:** Full-text search works normally (encrypted content is decrypted before search).

**When locked:** Full-text search does NOT work on note bodies (it would need to decrypt all notes, which requires the vault to be unlocked). The persistent search index only ever sees ciphertext, so it cannot find plaintext queries.

**Future (F1213):** An in-memory, post-unlock search index will allow searching encrypted content without a persistent FTS index.

---

## Security Architecture

### Key Hierarchy

```
Passphrase (in your head)
    ↓ Argon2id KDF (salt + strength params)
Master Key (32 bytes, ephemeral, in memory)
    ↓ Wrap with XChaCha20-Poly1305
Sealed Data Key (encrypted, in database)
    ↓ Unwrap with Master Key (on unlock)
Data Key (32 bytes, ephemeral, in memory)
    ↓ Encrypt each note with XChaCha20-Poly1305
Encrypted Notes (ciphertext in database)
```

### Algorithms

- **KDF:** Argon2id13 (memory-hard, resistant to GPU brute-force).
- **Encryption:** XChaCha20-Poly1305 IETF (authenticated, no padding oracle, nonce is random per message).
- **Hashing:** SHA-256 (for audit log hash-chain, key fingerprints).

For details, see `docs/security/crypto-design.md`.

### Key Zeroing

After use, keys are securely overwritten in memory:

- Master key is zeroed after unlock completes.
- Data key is zeroed when you lock the vault or the process exits.

### Parameter Versioning

The vault stores which KDF and encryption parameters were used when it was created. If the Fables team upgrades the cryptographic parameters in the future, old vaults can still be unlocked with their original parameters. The system is forward-compatible.

---

## Exporting & Backups

### Exporting Your Data

You can export your vault as plaintext markdown or JSON:

1. Go to **Settings → Export**.
2. Choose format (Markdown, JSON, or .fablesbak).
3. Click **Export**.

The export is **decrypted** (plaintext) — it is not encrypted. Store it securely.

### Backing Up

Your encrypted database is at `~/.fables/data.db`. You can back this up normally:

```bash
cp ~/.fables/data.db ~/backups/data.db.backup
```

If you lose your machine, restore the backup file and use your passphrase to unlock. **Keep your passphrase safe.**

---

## Troubleshooting

### "Vault is locked" Error

The vault is locked. Go to **Settings → Vault → Unlock** and enter your passphrase.

### "Incorrect passphrase" Error

The passphrase you entered does not match. Try again. If you forget your passphrase, the vault cannot be recovered.

### Search Not Working

The vault is locked. Unlock it first. While locked, the search index cannot find plaintext (it only sees ciphertext).

### Notes Look Garbled or Corrupted

This should never happen. If it does, it indicates:

- The database is corrupted (hardware failure, corrupted backup).
- The decryption key is wrong (wrong passphrase, but this would have been caught at unlock).

Contact support with details.

### Audit Log Integrity Check Failed

Someone (or something) tampered with the audit log. This is very unlikely in normal use. Possible causes:

- Database file was modified by external tools.
- Disk corruption (rare).
- Malware.

Contact support. Do not trust the vault's state until the issue is investigated.

---

## Best Practices

1. **Use a strong passphrase:** At least 12 characters, mix of letter, numbers, symbols. Avoid dictionary words.
2. **Remember your passphrase:** Use a password manager if you can't remember it. Forgotten = data loss.
3. **Lock your vault when away:** If you step away from your machine, lock the vault so decrypted data is not in memory.
4. **Back up your encrypted database:** `~/.fables/data.db` is your encrypted vault. Back it up.
5. **Check your audit log regularly:** Verify that only you are performing operations (unlocks, changes).
6. **Use Moderate KDF strength:** Good balance between security and speed.
7. **Export before deleting:** If you wipe the vault, export first (in case you change your mind).

---

## FAQ

**Q: Can I change my KDF strength (e.g., from Moderate to Sensitive)?**  
A: Not yet. You would need to wipe the vault and create a new one. This is a planned feature.

**Q: Can multiple people share one vault?**  
A: No. One vault = one passphrase = one person. Future: per-document encryption for collaboration (F1251+).

**Q: What if I use the same passphrase on multiple devices?**  
A: Each device would need to have the same vault file (`~/.fables/data.db`). The passphrase unlocks that file. Recommended: use device-specific passphrases or centralized sync (future).

**Q: Is the vault encrypted on the wire (Tailscale, etc.)?**  
A: The vault encrypts at rest in SQLite. Tailscale provides TLS for network traffic. Together: data is encrypted at rest (vault) and in transit (TLS).

**Q: Can the Fables server see my passphrase?**  
A: No. The passphrase is never sent to the server. It is kept local to your machine.

**Q: What if the vault is corrupted?**  
A: Restore from a backup or export a previous version (if you have revisions).

---

## See Also

- **Crypto Design:** `docs/security/crypto-design.md` (technical details on algorithms & key hierarchy)
- **Compliance Features:** `docs/security/compliance.md` (audit log, legal hold, redaction, retention policies — future)
- **Threat Model:** `docs/security/threat-model-v2.md` (what the vault protects against)
- **Privacy Data-Flow:** `docs/security/privacy-data-flow.md` (where your data goes)

---

**Last updated:** Day 14, Epic 13 (F1289). Vault operations shipped: create, unlock, lock, passphrase change, full wipe with verification, audit log, SSRF guard.

**Status:** Shipped. All described features are implemented and available in the current release.
