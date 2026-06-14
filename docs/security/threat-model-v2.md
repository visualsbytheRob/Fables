# Threat Model v2: Encryption, Collaboration, and Plugins

This document updates the Tier-1 threat model (see `threat-model.md`) to account for three new surfaces introduced in Tier 2: encrypted vault (Epic 13), real-time collaboration (Epic 12), and the plugin sandbox (Epic 11).

## Deployment Context (Updated)

Fables remains a single-user, local-first application deployed over Tailscale (`tailscale serve`). New in Tier 2:

- **Encrypted vault:** notes and entities may be encrypted at rest in SQLite under a master passphrase.
- **Real-time collaboration:** opt-in, per-document CRDT sync over WebSockets; only participants with explicit share links join.
- **Plugin system:** sandboxed JavaScript running in worker threads with a capability-based security model.

These layers sit on the original Tailnet perimeter and TLS transport.

---

## Assets & Sensitivity

| Asset                                       | Sensitivity                 | Protection                                                           | Location                                   |
| ------------------------------------------- | --------------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| **Note bodies & titles**                    | High (personal IP)          | At-rest encryption (vault mode), TLS in transit, file-system perms   | `~/.fables/fables.sqlite`                  |
| **Entity data (characters, places, items)** | High                        | At-rest encryption (vault mode)                                      | SQLite                                     |
| **Master passphrase**                       | Critical                    | Never stored, only in memory (zeroed on lock), KDF'd once per unlock | User's mind + temporary memory             |
| **Data keys**                               | Critical                    | Wrapped under master key, never persisted unencrypted                | Sealed in SQLite, unwrapped in memory only |
| **Attachments**                             | High                        | Encrypted if in vault mode; unencrypted if not                       | `~/.fables/attachments/`                   |
| **Collaboration WebSocket traffic**         | Medium (mirrored plaintext) | TLS 1.3 (Tailscale), constrained to tailnet participants             | Network                                    |
| **Plugin code & data**                      | Medium                      | Sandboxed worker thread, capability allowlist, memory budget         | Worker VM                                  |
| **Share tokens (collab links)**             | High                        | HMAC-sealed, scoped, expirable, per-document                         | Database + URL                             |
| **Auth token (`FABLES_TOKEN`)**             | High                        | Constant-time comparison, optional bearer token                      | Env var / cookie                           |
| **CRDT snapshots & op-log**                 | High                        | Encrypted if in vault mode                                           | SQLite                                     |
| **Server logs**                             | Low                         | Operation summaries (no note content)                                | `~/.fables/logs/`                          |

---

## Threat Model Hierarchy

### 1. Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│ User's Tailnet (Private VPN)                                │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ User's Machine (Fables Server)                        │ │
│  │                                                       │ │
│  │  ┌─────────────────────────────────────────────────┐ │ │
│  │  │ Process Memory (volatile)                       │ │ │
│  │  │ - Master passphrase (unlocked)                  │ │ │
│  │  │ - Data keys (unwrapped)                         │ │ │
│  │  │ - Plaintext notes                               │ │ │
│  │  │ - Plugin execution (worker threads)             │ │ │
│  │  └─────────────────────────────────────────────────┘ │ │
│  │         ↕                                             │ │
│  │  ┌─────────────────────────────────────────────────┐ │ │
│  │  │ Disk (at rest)                                  │ │ │
│  │  │ - SQLite (encrypted at rest in vault mode)      │ │ │
│  │  │ - Attachments (encrypted or not)                │ │ │
│  │  │ - Collaboration state & CRDT snapshots          │ │ │
│  │  └─────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────┘ │
│                         ↕                                   │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ WebSocket (Collaboration)                            │ │
│  │ - Only open to tailnet participants with share link  │ │
│  │ - TLS encrypted, CRDT ops are plaintext encrypted    │ │
│  └───────────────────────────────────────────────────────┘ │
│                         ↕                                   │
└─────────────────────────────────────────────────────────────┘
        ↕
    Other Devices (Phone, Laptop)
    via Tailscale WireGuard
```

The **innermost boundary** is process memory during active operations. The **outer boundary** is the Tailnet perimeter. The **disk boundary** is encrypted in vault mode.

### 2. Threat Actors & Capabilities

| Actor                                   | Capabilities                                               | Motivation                                                      |
| --------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| **Remote network attacker**             | Eavesdrop on public WiFi, DNS hijack, BGP hijack           | Steal notes, impersonate server, MITM                           |
| **Tailnet insider**                     | Access the VPN, read WebSocket traffic, forge share tokens | Spy on notes, collaborate without permission                    |
| **Physical attacker (theft)**           | Possess the laptop, read disk                              | Dump database, decrypt vault (needs passphrase or key material) |
| **Malicious plugin**                    | Execute code in worker thread, access plugin API surface   | Exfiltrate notes, steal secrets, trigger side effects           |
| **Malicious collaborator**              | Participate in doc CRDT, write comments, see history       | Inject hidden text, steal other collaborators' data             |
| **Weak passphrase attacker**            | Offline brute force (with stolen salt + wrapped key)       | Derive master key, decrypt vault                                |
| **Memory scraping**                     | DLL injection, debugger, memory forensics                  | Extract master key or data keys from heap                       |
| **Supply-chain compromise**             | Backdoored npm dependency                                  | Exfiltrate keys, logs, or vault content                         |
| **Device compromise (malware/rootkit)** | Full OS-level access, intercept syscalls                   | Bypass all app-level controls                                   |

---

## Threat Scenarios & Mitigations

### Scenario 1: Encrypted Vault Unlock

**Threat:** User is attacked during or shortly after vault unlock.

**Attack paths:**

- **Memory scraping (active secret):** Attacker reads master passphrase or data keys from process memory.
- **Cold boot:** Attacker steals powered-on laptop, dumps RAM before it clears.
- **Debugger attachment:** Attacker attaches gdb/lldb to the Fables process, inspects the `key` variable.

**Mitigations:**

- **Memory zeroing (F1205):** Keys are filled with 0x00 immediately after use (lock). Once locked, no secrets in memory.
- **Process isolation:** Fables runs as a single user process; the OS kernel isolates it from other users. (Does not protect against root/malware.)
- **Constant-time KDF:** Argon2id is inherently constant-time; timing the unlock reveals nothing about the passphrase.
- **No key logging:** Passphrase is read from stdin (no keystroke logging hook).
- **Lock on idle:** (F1231–F1240 scope) Auto-lock after inactivity, keys zeroed.
- **Secure passphrase input:** Web form with browser's password input (no paste, no autocomplete unless user opts in).

**What we DON'T protect against:**

- Rootkit/malware running with kernel privileges can intercept memory reads before zeroing.
- Cold boot attacks (attacker steals running machine) — mitigated by encryption key + machine sleep.
- Attacker logging in as the same user (same as compromised machine).

---

### Scenario 2: Disk Theft

**Threat:** Attacker steals the laptop and tries to decrypt the vault offline.

**Attack paths:**

- **Weak passphrase brute force:** Attacker tries 100 million passphrases offline against the wrapped key.
- **Key material extraction:** Attacker finds unencrypted data keys in old backups or crash dumps.
- **Database extraction:** If vault is not in encryption mode, plaintext SQLite is readable.

**Mitigations:**

- **High-entropy KDF:** Argon2id with "moderate" or "sensitive" cost (F1202). A modern CPU can try ~1 million passphrases per second; "moderate" costs 3 seconds per derive. 100 million attempts = ~35 years.
- **Per-vault salt:** Each vault has a unique 128-bit salt; can't pre-compute a rainbow table.
- **Key wrapping:** Data keys are stored wrapped, never in plaintext.
- **At-rest encryption:** Vault mode encrypts all note bodies, entity data, and CRDT snapshots. Attachments encrypted too.
- **Full disk encryption (recommended):** User should enable FileVault (macOS) or BitLocker (Windows). Not handled by Fables (OS concern).
- **Backup policy:** Backups (`.fablesbak` exports) inherit the vault's encryption; if unencrypted vault mode is used, exports are also unencrypted. User is responsible for encrypting backups separately.

**What we DON'T protect against:**

- Attacker with physical access + sufficient GPU clusters can potentially crack very weak passphrases (8 chars) in months.
- Unencrypted vault mode offers no protection; disk encryption is required.
- Side-channel attacks on KDF (timing, power analysis) — not a realistic threat for desktop.

---

### Scenario 3: Real-Time Collaboration MITM

**Threat:** Attacker on the Tailnet intercepts or forges WebSocket messages between collaborators.

**Attack paths:**

- **Eavesdrop on CRDT ops:** Attacker reads plaintext CRDT ops over WebSocket.
- **Forge share token:** Attacker guesses a share token, joins the room, impersonates a participant.
- **Inject malicious ops:** Attacker injects a CRDT op that corrupts the document state.

**Mitigations:**

- **TLS encryption (Tailscale):** All WebSocket messages are encrypted end-to-end via Tailscale's WireGuard tunnel. Passive eavesdropping fails.
- **Share token strength:** Tokens are HMAC-sealed with a server secret and scoped to a document. Can't be guessed; require explicit generation by the doc owner.
- **Room membership validation:** Server checks the share token on every WebSocket message. Revoked tokens are immediately invalid.
- **CRDT integrity:** Yjs CRDT ops are cryptographically identified by (`clientID`, `clock`). Forged ops cause merge conflicts (visible to collaborators).
- **Presence attestation:** (F1141–F1150) Collaborators see each other's avatars and cursors. Unexpected guests are obvious.
- **Audit log (F1284, shipped):** Every vault op (unlock, lock, passphrase change, wipe) is logged server-side with timestamp. Hash-chained for tamper detection. Malicious edits are forensically verifiable.

**What we DON'T protect against:**

- If Tailscale is compromised, TLS is bypassed.
- If the server is compromised, share tokens can be forged.
- Compromised collaborator can read all document content (no per-collaborator encryption).
- Replay attacks (an old op sent twice) — CRDT deduplicates by clientID+clock, so benign.

---

### Scenario 4: Plugin Privilege Escalation

**Threat:** A malicious plugin escapes the sandbox and reads the vault or steals keys.

**Attack paths:**

- **Direct file I/O:** Plugin calls `fs.readFile('~/.fables/fables.sqlite')` to read the database.
- **VM internals exploitation:** Plugin exploits a bug in Node's worker_threads to access host memory.
- **Capability confusion:** Plugin tricks the host API into granting access to a protected resource.
- **Side-channel attack:** Plugin triggers GC behavior to infer the master key's bit pattern.

**Mitigations:**

- **Capability allowlist (F1011–F1020):** Plugins run in worker threads with NO filesystem access by default. The only APIs available are those explicitly granted: notes API, story API, UI APIs.
- **No native modules:** Plugins are pure JavaScript; can't call into C libraries or system calls.
- **Host API boundary:** Notes/stories/effects are accessed through a typed gateway (e.g., `notesAPI.read(noteId)` returns sanitized JSON). The gateway validates every request.
- **IPC serialization:** All data passed between worker and host is serialized (JSON or Structured Clone), preventing reference leaks.
- **Memory isolation:** Worker memory is separate from the host process. Heap spraying in the worker does not affect the main thread.
- **Installation check:** (F1061–F1070) Users grant permissions at install time. A plugin's manifest declares what it needs (e.g., "read notes with tag #secret"). Mismatch is detected.
- **Plugin review (future):** Community/curated plugin catalog with code review before publishing.

**What we DON'T protect against:**

- 0-day exploits in Node.js worker_threads (e.g., a V8 JIT bug). Fables can't defend against VM exploits.
- Attacker can bypass checks by uploading a plugin with false manifest claims (requires user to grant permissions at install).
- Collaborators can read your live notes if you share a document; plugins can't prevent that (it's by design).

---

### Scenario 5: Malicious Collaborator

**Threat:** A user joins a shared document with malicious intent.

**Attack paths:**

- **Document content theft:** Read all notes in the shared doc.
- **Edit history tampering:** See all past revisions and comments.
- **Comment injection:** Plant hidden comments or suggestions.
- **Side effects:** Trigger effects that mutate shared entities.

**Mitigations:**

- **Read/edit permissions:** (F1141–F1150) Share links grant either read-only or read-write access. Read-only collaborators cannot modify the doc.
- **Presence visibility:** All collaborators see each other's cursors and avatars. Unexpected participation is obvious.
- **Audit log:** Every CRDT op is attributed to the peer. Malicious edits can be traced and undone.
- **Link revocation:** Owner can immediately revoke a share link. Future collaborators can't join.
- **End date expiry:** (F1141–F1150) Share links expire after a configurable time, reducing the window.

**What we DON'T protect against:**

- Read-only collaborator sees all document content (by definition of "read").
- Screenshot/copy-paste (standard attack on any shared doc).
- Compromised collaborator device (malware on their machine can see everything they have access to).
- Timing attacks (attacker infers document structure from CRDT op sizes and timing).

---

### Scenario 6: Weak Passphrase

**Threat:** User chooses a weak passphrase (e.g., "password123") and the vault is stolen.

**Attack paths:**

- **Dictionary attack:** Attacker tries 1,000 common passwords.
- **Brute force:** Attacker tries all 6-character lowercase passphrases (~300 million).

**Mitigations:**

- **KDF cost:** Argon2id "moderate" costs 3 seconds per attempt. Even a GPU can't parallelize this effectively. 1,000 attempts = ~50 minutes; 1 million attempts = ~11 days.
- **Passphrase strength meter:** (F1221–F1230, future) UI warns users when passphrase is weak. Discourages dictionary words.
- **Hardware constraints:** Argon2id requires significant memory (64 MB per derive). GPU-accelerated brute force is impractical (memory bandwidth bottleneck).
- **Entropy measurement:** (Future) Passphrase input UI estimates entropy and blocks very weak inputs.

**What we DON'T protect against:**

- User who chooses "password" as passphrase — no tool prevents bad user choices. Education is the control.
- Attacker with access to a GPU farm (e.g., AWS) can try more passphrases in parallel, but still amortized to ~days/weeks per target.
- Passphrase reuse (user's vault passphrase == email password). Fables can't enforce unique secrets.

---

### Scenario 7: Supply-Chain Compromise

**Threat:** A malicious actor poisons the npm supply chain and injects code into Fables.

**Attack paths:**

- **Dependency poisoning:** Attacker publishes a trojanized version of `libsodium-wrappers` or similar.
- **Typosquatting:** Attacker publishes `@fables-core/crypto` (confusingly close to `@fables/core`).
- **Maintainer account compromise:** Attacker gains access to the `@fables` npm account and publishes backdoored versions.

**Mitigations:**

- **Lockfile pinning:** `pnpm-lock.yaml` is checked into version control. Exact versions of all transitive dependencies are committed.
- **Dependency audit:** `pnpm audit` runs in CI and blocks PRs with critical vulnerabilities.
- **Minimal dependencies:** Crypto core depends only on `libsodium-wrappers-sumo` (no extra deps). Small surface.
- **Integrity checking:** npm lockfile includes integrity hashes (sha512) for all packages. tampered packages are rejected.
- **Code review:** All changes to dependencies (version bumps) are reviewed and tested in CI before merge.
- **Release notes:** Changelog includes all dependency updates. Users can audit what shipped.

**What we DON'T protect against:**

- Zero-day vulnerability in libsodium itself (upstream security issue). Only mitigated by prompt upstream patching.
- Attacker with access to npm's infrastructure (e.g., backdoored CDN). Out of scope (trust npm to be secure).
- Attacker controls the GitHub account (commit history could be rewritten). Mitigated by using GitHub's branch protection and signing commits (enabled by default on Fables repo).

---

### Scenario 8: Device Compromise (Malware/Rootkit)

**Threat:** User's machine is compromised by malware or a rootkit.

**Attack paths:**

- **Process injection:** Malware injects a DLL into the Fables process, reads memory.
- **Keylogger:** Malware logs the user's passphrase as it's typed.
- **Syscall interception:** Rootkit intercepts `read()` syscalls and exfiltrates all data.
- **Firmware attack:** Rootkit overwrites UEFI firmware and persists across OS reinstalls.

**Mitigations:**

- **Antivirus/EDR:** Run reputable antivirus. Fables cannot defend against a compromised OS.
- **OS updates:** Keep your OS and all software updated. Security patches close exploit vectors.
- **Least privilege:** Run Fables as a regular user, not root. Limits malware's capabilities (still can't prevent determined root malware).

**What we DON'T protect against:**

- Rootkit with kernel privileges beats all app-level security. This is **out of scope for Fables**; it's an OS-level threat.
- Firmware/BIOS malware (persistent across reinstalls). Mitigated by UEFI Secure Boot (OS feature, not Fables).
- If the OS is compromised, Fables is compromised. No exceptions.

---

## Summary: Security Properties by Tier

### Tier 1 (Baseline)

- Single-user, Tailnet perimeter.
- Network-level threat model.
- **No encryption at rest** (F979 in Tier 2).
- Protects against: remote attackers, MITM, XSS, SQLi, VM sandbox escape, malicious plugins (F945).
- **Does NOT protect against:** physical theft, malware on the machine, forgotten Tailscale sessions.

### Tier 2 (With Encryption & Collab)

- Encryption at rest in vault mode.
- Real-time collaboration over CRDT.
- Plugin sandbox hardening.
- **New protections:** data confidentiality (vault mode), offline brute-force resistance (Argon2id), collaborator transparency (presence), audit trail (op-log).
- **New threats:** passphrase weakness, key material leaks, collaborator trust, share link forgery.
- **Still does NOT protect against:** malware, physical theft (without passphrase), memory scraping (on running machine), rootkits.

---

## Audit Checklist

- [ ] Crypto primitives match `packages/core/src/crypto.ts` (Argon2id, XChaCha20-Poly1305).
- [ ] KDF parameters tested against reference vectors (F1207).
- [ ] Master key never written to disk or logs.
- [ ] Data keys zeroed after use (F1205).
- [ ] Share tokens are HMAC-sealed and scoped.
- [ ] WebSocket messages validated server-side.
- [ ] Plugin capability allowlist enforced (no filesystem access by default).
- [ ] Attachment serving uses stored hashes, not user-supplied paths.
- [ ] All SQL queries use parameterized statements.
- [ ] DOMPurify sanitizes all HTML renders.
- [ ] CORS restricted to Tailnet origins.
- [ ] Security headers present (CSP, X-Content-Type-Options, etc.).

---

## References

- **Threat Model v1:** `docs/security/threat-model.md` (Tier 1 baseline)
- **Crypto Design:** `docs/security/crypto-design.md` (primitives, key hierarchy, KDF strategy)
- **Privacy Data-Flow:** `docs/security/privacy-data-flow.md` (what leaves the machine)
- **Incident Response:** `docs/security/incident-response.md` (recovery playbooks)
- **Libsodium Security:** https://doc.libsodium.org/ (primitive documentation)
- **Argon2 Security:** https://password-hashing.info/ (latest KDF guidance)
- **OWASP Top 10:** https://owasp.org/Top10/

---

**Last updated:** Day 14, Epic 13. Covers F1201–F1210 (crypto core), F1211–F1223 (encrypted storage & vault ops), F1268 (SSRF guard), F1284 (audit log), F1281 (vault wipe). Real-time collaboration (Epic 12) and plugin system (Epic 11) are complete; encrypted vault fully shipped in Tier 2 Phase 1.
