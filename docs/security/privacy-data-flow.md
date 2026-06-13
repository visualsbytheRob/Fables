# Privacy & Data-Flow Map (F1276)

**Audience:** Users, privacy advocates, auditors. "What data leaves my machine? Where is everything stored?"

**The honest answer:** In local-first mode, **nothing leaves your machine except Tailscale protocol overhead.** In optional encrypted collaboration mode, ciphertext (encrypted CRDT ops) flows to collaborators over Tailscale.

---

## Data Classification & Storage

### 1. Plaintext Data (on your machine)

| Data                    | Format                           | Location                  | Protection            | Notes                                                  |
| ----------------------- | -------------------------------- | ------------------------- | --------------------- | ------------------------------------------------------ |
| **Notes**               | Markdown                         | `~/.fables/fables.sqlite` | File perms (0600)     | Body, title, metadata                                  |
| **Entities**            | JSON fields                      | SQLite                    | File perms (0600)     | Characters, places, items, custom types                |
| **Tags**                | Index                            | SQLite                    | File perms (0600)     | Extracted from note bodies                             |
| **Wikilinks**           | Graph edges                      | SQLite                    | File perms (0600)     | `[[ref]]` resolution & backlinks                       |
| **Attachments**         | Files                            | `~/.fables/attachments/`  | File perms (0700 dir) | Images, PDFs, audio                                    |
| **Stories**             | Fable source + compiled bytecode | SQLite                    | File perms (0600)     | Forge `.fable` code, metadata                          |
| **Saves**               | Story variables + transcript     | SQLite                    | File perms (0600)     | Playthrough state, choice history                      |
| **Op-log**              | Lamport-timestamped mutations    | SQLite                    | File perms (0600)     | Sync operations, for offline-first conflict resolution |
| **Revisions**           | Snapshots                        | SQLite                    | File perms (0600)     | Note history (pruned: 24h full, then daily)            |
| **Search index**        | FTS5 inverted index              | SQLite                    | File perms (0600)     | Full-text and vector embeddings                        |
| **Logs**                | Operations, errors, access       | `~/.fables/logs/`         | File perms (0600)     | Summaries only, no note content                        |
| **Collaboration state** | CRDT snapshots, presence         | SQLite                    | File perms (0600)     | Yjs updates, room state (if shared)                    |
| **Sync checkpoints**    | Sequence numbers                 | SQLite                    | File perms (0600)     | Lamport clock, remote state vectors                    |

**Protection mechanism:** `~/.fables` is created with `0755` (read by user only). Other users and processes (with same UID) can't access the data. Root/malware with kernel access can read everything.

---

### 2. Encrypted Data (vault mode, at rest)

When **encryption mode** is enabled (F1211–F1220), plaintext data is encrypted before being written to disk.

| Data                     | Encryption                | Key                                     | Storage                     | Notes                                |
| ------------------------ | ------------------------- | --------------------------------------- | --------------------------- | ------------------------------------ |
| **Note bodies & titles** | XChaCha20-Poly1305        | DataKey                                 | SQLite, `ciphertext` column | Searchable if index is encrypted too |
| **Entity field values**  | XChaCha20-Poly1305        | DataKey                                 | SQLite                      | Custom fields all encrypted          |
| **Attachment files**     | XChaCha20-Poly1305        | DataKey (or per-attachment key, future) | `~/.fables/attachments/`    | On-disk encryption layer             |
| **CRDT snapshots**       | XChaCha20-Poly1305        | DataKey                                 | SQLite                      | If doc is shared & encrypted         |
| **Backups**              | Inherited from vault mode | DataKey                                 | `.fablesbak` export         | Backup inherits encryption state     |

**Key hierarchy:**

```
Passphrase (user's mind)
    ↓ Argon2id
MasterKey (ephemeral, in memory)
    ↓ Wrap
Sealed<DataKey> (persistent, in DB)
    ↓ Unwrap (on unlock)
DataKey (ephemeral, in memory)
    ↓ Encrypt
Ciphertext (persistent, on disk)
```

---

### 3. Network Data (Tailscale VPN)

| Data                   | Direction                          | Encryption          | Who Sees                 | Notes                                                 |
| ---------------------- | ---------------------------------- | ------------------- | ------------------------ | ----------------------------------------------------- |
| **HTTP API requests**  | Client → Server                    | TLS 1.3 (Tailscale) | Tailnet participants     | JSON payloads (notes, queries, etc.)                  |
| **WebSocket (collab)** | Client ↔ Client (via server relay) | TLS 1.3 (Tailscale) | Share link holders       | CRDT ops, presence updates                            |
| **Sync ops**           | Client ↔ Server                    | TLS 1.3 (Tailscale) | Tailnet, plus server     | Op-log mutations for offline sync                     |
| **Attachments**        | Client ← Server                    | TLS 1.3 (Tailscale) | Tailnet                  | Binary files, served as `application/octet-stream`    |
| **VPN overhead**       | Encrypted by WireGuard             | WireGuard           | Tailscale infrastructure | IP headers, timing, packet sizes visible to Tailscale |

**Key assumption:** Tailscale's TLS and WireGuard are secure. If Tailscale is compromised, this threat model fails.

---

### 4. Temporary Data (process memory)

| Data                     | Lifetime              | Scope                        | Risk                                             |
| ------------------------ | --------------------- | ---------------------------- | ------------------------------------------------ |
| **Master passphrase**    | ~100 µs               | In memory, KDF function      | Debugger / memory scraping if machine is running |
| **Master key**           | ~1 µs (after unlock)  | Unwrap data key, then zeroed | Same                                             |
| **Data keys**            | Duration of session   | Loaded once, zeroed on lock  | Same                                             |
| **Plaintext notes**      | During display / edit | Rendered in memory           | Read-only risk during viewing                    |
| **Search results**       | During query          | Temporary list               | Same                                             |
| **Plugin worker memory** | Plugin execution      | Worker thread isolate        | Malicious plugin can access, but not host data   |

**Mitigation:** Keys are zeroed with `key.fill(0)` immediately after use. If the vault is locked, no sensitive keys are in memory.

---

### 5. Browser Cache & Local Storage (PWA)

| Data                     | Storage                        | Encryption            | Retention           | Notes                                     |
| ------------------------ | ------------------------------ | --------------------- | ------------------- | ----------------------------------------- |
| **Service Worker cache** | Disk (iOS/Android app storage) | OS encryption at rest | Until app uninstall | App shell (HTML, CSS, JS)                 |
| **IndexedDB**            | Disk (app storage)             | OS encryption at rest | Until app uninstall | Mirrored notes, entities, search index    |
| **localStorage**         | Disk (app storage)             | OS encryption at rest | Until app uninstall | User prefs, draft recovery, feature flags |
| **Browser cookies**      | Disk (app storage)             | OS encryption at rest | Session or expiry   | Auth token (if enabled)                   |

**iOS/Android protection:** Native databases are encrypted by the OS. On logout or app uninstall, Safari/WebKit clears the storage.

---

### 6. Server-Side (on your machine, `localhost`)

| Data                | Stored Where                  | Scope                       | Sensitive?                         |
| ------------------- | ----------------------------- | --------------------------- | ---------------------------------- |
| **SQLite database** | `~/.fables/fables.sqlite`     | Main data store             | YES (plaintext or encrypted)       |
| **WAL file**        | `~/.fables/fables.sqlite-wal` | Write-ahead log (temporary) | YES                                |
| **Server logs**     | `~/.fables/logs/`             | Operation summaries         | NO (no note content)               |
| **Config / env**    | `~/.fables/.env` or env vars  | API token, settings         | YES (contains `FABLES_TOKEN`)      |
| **Backups**         | `~/.fables/backups/`          | User-initiated exports      | YES (inherits vault encryption)    |
| **Crash dumps**     | Varies (OS-specific)          | JIT errors, panics          | MEDIUM (may contain key fragments) |

**Access control:** All files in `~/.fables/` are owned by the user running Fables. No other user can read them (unless they're root).

---

## Data-Flow Diagrams

### Scenario 1: Reading a Note (Plaintext Mode)

```
User opens the web app (localhost)
    ↓
Browser sends GET /notes/:id (HTTP over Tailscale TLS)
    ↓ [Tailscale encrypts]
Network: [TLS-encrypted request payload]
    ↓ [Tailscale decrypts on server]
Server queries SQLite: SELECT body FROM notes WHERE id = ?
    ↓
SQLite returns plaintext note body
    ↓
Server sends JSON response (HTTP over Tailscale TLS)
    ↓ [Tailscale encrypts]
Network: [TLS-encrypted response]
    ↓ [Tailscale decrypts on browser]
Browser renders markdown → HTML (DOMPurify sanitization)
    ↓
User sees the note on screen
```

**Data exposure:**

- Plaintext in SQLite on disk.
- Plaintext in process memory (while serving the request).
- Plaintext in HTTP request/response (but encrypted by Tailscale's TLS layer).
- HTML + CSS in the browser's memory and IndexedDB.

---

### Scenario 2: Reading a Note (Vault Mode, Encrypted)

```
User enters passphrase → Unlock vault
    ↓
KDF: Argon2id(passphrase, salt) → MasterKey (in memory, 3 seconds)
    ↓
Unwrap: open(sealed_data_key, master_key) → DataKey (in memory)
    ↓
MasterKey is zeroed (not needed again until next unlock)
    ↓
Browser sends GET /notes/:id (HTTP over Tailscale TLS)
    ↓
Server queries SQLite: SELECT ciphertext FROM notes WHERE id = ?
    ↓
SQLite returns sealed(plaintext) (still encrypted on disk)
    ↓
Server decrypts (but does it? See below.)
    ↓
Server sends encrypted blob to browser OR plaintext?
```

**Design decision (to be finalized in F1211+):**

- **Option A (Client-side decryption):** Server sends ciphertext, browser decrypts locally. DataKey stays in browser memory.
- **Option B (Server-side decryption):** Server unwraps/decrypts using KeyManager, sends plaintext. Less secure (plaintext on server).

For the encrypted vault, **Option A is preferred** (end-to-end encryption): server never sees plaintext, only the ciphertext it stores.

**Data exposure (Option A):**

- Ciphertext on disk (SQLite).
- Ciphertext in transit (Tailscale TLS encrypted).
- Plaintext in browser memory only (during display).
- No plaintext on server, ever.

---

### Scenario 3: Collaboration (Shared Document, Encrypted)

```
User A creates a shared document
    ↓
Document is encrypted under Document DataKey
    ↓
Server generates share token (HMAC-sealed, scoped)
    ↓
User A sends URL to User B: https://machine.ts.net/docs/:id?share_token=...
    ↓
User B joins with the token
    ↓
WebSocket connection established (TLS over Tailscale)
    ↓
Server validates token: is it valid? not expired? right doc? right access level?
    ↓
User B and User A exchange CRDT ops (Yjs updates) over WebSocket
    ↓ [ciphertext = plaintext; Tailscale TLS encrypts]
Network: [CRDT ops, TLS-wrapped]
    ↓
Both browsers merge ops locally (CRDT conflict resolution)
    ↓
Plaintext is only in browser memory during display
```

**Data exposure:**

- CRDT ops are plaintext (the ops describe the edits, e.g., "insert 'hello' at offset 5").
- Encrypted on the network by Tailscale TLS.
- Only visible to the document owner and share link holders.
- Share token is HMAC-sealed (can't be forged).

**If document encryption is enabled (future):** CRDT ops themselves could be encrypted, but not currently.

---

### Scenario 4: Plugin Execution

```
Plugin code is downloaded and sandboxed in a worker thread
    ↓
Plugin requests access to notes (via plugin API)
    ↓
Host validates: does plugin have permission? (checked at install time)
    ↓
If yes: host sends note data (JSON) to plugin via IPC
    ↓ [IPC = serialize/deserialize; no reference leaks]
Plugin receives sanitized JSON (no raw key objects)
    ↓
Plugin processes (e.g., word count, tagging)
    ↓
Plugin cannot access:
  - Encryption keys (not in the API)
  - Raw filesystem (not in the API)
  - Network (unless explicitly granted, future)
  - Other plugins' memory (worker isolation)
```

**Data exposure:**

- Plugin can read note content if it has the "read notes" permission.
- Cannot read keys or access the filesystem.
- Cannot exfiltrate data (no network API yet).

---

## What Leaves Your Machine

### ✅ Stays Local (Tier 1 Default)

- ✅ Notes, entities, stories, attachments.
- ✅ All search indexes and embeddings.
- ✅ Revisions and history.
- ✅ Op-log for offline sync.
- ✅ Everything in `~/.fables`.

### ⚠️ Crosses the Tailnet (if collaboration is enabled)

- ⚠️ CRDT operations (plaintext diffs, but only to share link holders).
- ⚠️ Presence updates (who's viewing what).
- ⚠️ Comments & suggestions.
- ⚠️ VPN metadata (IP addresses, packet timing, Tailscale sees encrypted WireGuard packets).

### 🚫 Never Leaves (Current Design)

- 🚫 Master passphrase.
- 🚫 Encryption keys (unless they're wrapped by the KDF, then only in database).
- 🚫 Raw note plaintext to external servers (local-first).
- 🚫 User behavior analytics or telemetry (unless explicitly opted in, future).
- 🚫 Embeddings or AI inference requests (if AI tier is added, it would be local via Ollama).

---

## Future (Phase 2 & 3)

| Feature                               | Impact                                                                    | Status                  |
| ------------------------------------- | ------------------------------------------------------------------------- | ----------------------- |
| **Cloud Backups (F1281+)**            | Encrypted backups sync to cloud (user-owned S3, future)                   | Planned for Phase 2     |
| **AI Co-Writer (F1301+)**             | Local Ollama instance (no data leaves) or remote API (encrypted payloads) | Planned for Phase 3     |
| **Multi-Device Sync (beyond Tier 2)** | Encrypted sync across devices via server relay                            | Future                  |
| **Share Links with Analytics**        | Count views, track who accessed a shared doc                              | Possible future, opt-in |
| **Logging & Audit**                   | Tamper-evident audit log (hash-chained, local or cloud)                   | Phase 2 (F1284)         |

---

## User Responsibilities

### What Fables Handles

✅ Encrypting data at rest (vault mode).  
✅ Encrypting data in transit (Tailscale TLS).  
✅ Isolating plugins from each other and the host.  
✅ Clearing keys from memory on lock.

### What the User Handles

🔴 Choosing a strong passphrase.  
🔴 Keeping their machine updated and free of malware.  
🔴 Locking their device when stepping away.  
🔴 Using full-disk encryption (FileVault, BitLocker).  
🔴 Backing up the `~/.fables/` directory securely.  
🔴 Trusting Tailscale's security model.

---

## Audit Checklist

- [ ] All plaintext data is stored in `~/.fables` (confirmed).
- [ ] Encryption keys are never written to disk unencrypted.
- [ ] Keys are zeroed after use.
- [ ] Backup files inherit the vault's encryption state.
- [ ] Server logs contain no note content (only operation summaries).
- [ ] No telemetry or analytics sent to external servers (current).
- [ ] Plugin API does not expose raw keys or filesystem.
- [ ] WebSocket traffic for collaboration is TLS-encrypted (Tailscale).
- [ ] Share tokens are cryptographically validated server-side.

---

## References

- **Threat Model v2:** `docs/security/threat-model-v2.md`
- **Crypto Design:** `docs/security/crypto-design.md`
- **Attack Tree:** `docs/security/vault-attack-tree.md`
- **Main Security Doc:** `docs/security.md`
- **Tailscale Security:** https://tailscale.com/security/

---

**Last updated:** Day 11, Epic 13 F1276. Describes the local-first data model and how encryption affects data flow.
