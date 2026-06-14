# Secure Defaults & Self-Audit Checklist (F1278)

This document describes Fables' secure-by-default posture and provides a checklist for verifying that your Fables instance is hardened.

---

## Secure-by-Default Posture

Fables ships with security settings that prioritize user safety over convenience. Users must **opt-in to weaker settings**, not opt-out of strong ones.

### 1. Network & Authentication

| Setting               | Default                                 | Reasoning                                                                               |
| --------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| **Tailscale only**    | Enabled (no public internet by default) | Fables only listens on localhost. Access is ONLY via Tailscale VPN.                     |
| **Tailscale Funnel**  | Disabled                                | Funnel exposes the tailnet app to the public internet. Users must explicitly enable it. |
| **Bearer token auth** | Disabled                                | Optional single-user token. Disabled by default (uses Tailscale as the perimeter).      |
| **HTTPS/TLS**         | Required                                | All communication over Tailscale uses TLS 1.3. No downgrade to HTTP.                    |
| **CORS**              | Restricted to tailnet origins           | Only `*.ts.net` and `127.0.0.1` (dev) accepted. No wildcard.                            |

### 2. Data Encryption

| Setting                | Default (Tier 1)              | Tier 2 (F1211+, Shipped)                   | Reasoning                                                                                            |
| ---------------------- | ----------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Vault encryption**   | Plaintext (no encryption)     | Opt-in (user chooses at setup)             | Encryption adds overhead; Tier 1 assumes trust in local filesystem. Tier 2 adds optional encryption. |
| **At-rest encryption** | None (file-system perms only) | XChaCha20-Poly1305 (if vault mode enabled) | Encryption key is user's passphrase (Argon2id KDF). User controls the master key.                    |
| **Backup encryption**  | Inherits vault mode           | Inherits vault mode (F1211+)               | Exported backups are plaintext or encrypted depending on vault mode.                                 |
| **Key zeroing**        | Automatic on lock (F1205)     | Automatic on lock                          | Keys are filled with 0x00 as soon as they're no longer needed.                                       |

### 3. Search & Export

| Setting                           | Default               | Reasoning                                                                                                    |
| --------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Full-text search**              | Enabled               | Standard feature. All notes are indexed for user convenience.                                                |
| **Encrypted content search**      | TBD (F1211+)          | If vault is encrypted, search index may also be encrypted (reduces false positives if attacker accesses DB). |
| **Export unencrypted**            | Allowed, with warning | User is warned when exporting in plaintext mode. Fables doesn't block it (user's choice).                    |
| **Secrets exclusion from search** | Not implemented       | Future feature: allow user to tag notes as "secrets" and exclude from search index.                          |
| **Search history**                | Not persisted         | Search queries are not logged or stored.                                                                     |

### 4. Plugins & Extensions

| Setting                     | Default                            | Reasoning                                                                     |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| **Plugin sandboxing**       | Strict (worker threads, F1011+)    | Plugins run in isolated worker threads with NO filesystem access by default.  |
| **Capability allowlist**    | Minimal (read-only by default)     | Plugins can read notes only if "read notes" permission is granted at install. |
| **Network access**          | Disabled (not in API yet)          | Plugins cannot make network requests (future scope: F1061+).                  |
| **Plugin signing**          | Not enforced (future)              | Currently any code can be loaded. Future: plugin catalog with code review.    |
| **Permission escalation**   | Denied at runtime                  | Plugin permissions are fixed at install time. No dynamic escalation.          |
| **Plugin execution budget** | Limited (CPU + memory caps, F1011) | Runaway plugins are killed after exceeding resource limits.                   |

### 5. Collaboration & Sharing

| Setting                  | Default (Tier 2, F1141+)                   | Reasoning                                                                                                             |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Share links**          | Require explicit generation                | Users must intentionally create a share link. No document is shared by default.                                       |
| **Share link expiry**    | Optional (default: no expiry, but visible) | User can set an expiration date. If not set, link is valid indefinitely (but listed in settings for easy revocation). |
| **Share token strength** | 256-bit random (F1141+)                    | HMAC-sealed with server secret. Cannot be guessed or forged.                                                          |
| **Read-only sharing**    | Available                                  | User can grant read-only access (no edit permission).                                                                 |
| **Presence visibility**  | Opt-in (show who's editing)                | By default, other collaborators' cursors are shown. User can toggle privacy mode (F1141+).                            |
| **Comment visibility**   | All collaborators see all comments         | No per-comment access control (would require more complex CRDT structure).                                            |

### 6. Logging & Auditing

| Setting                    | Default                  | Reasoning                                                             |
| -------------------------- | ------------------------ | --------------------------------------------------------------------- |
| **Server logs**            | Enabled (summaries only) | Operation summaries logged to `~/.fables/logs/`. No note content.     |
| **Audit trail**            | Enabled (F1284, shipped) | Tamper-evident audit log (hash-chained) records vault ops, always on. |
| **User activity tracking** | None (local only)        | No analytics or telemetry sent to external servers.                   |
| **Log retention**          | 30 days (default, TBD)   | Old logs are pruned. User can configure retention.                    |

### 7. Attachment Handling

| Setting                     | Default                             | Reasoning                                                                           |
| --------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| **Attachment upload limit** | 100 MB (configurable)               | Prevents disk space attacks (malicious user uploads gigabytes).                     |
| **MIME type allowlist**     | Strict (images, PDFs, audio only)   | Executable files (.exe, .sh, .app) are rejected.                                    |
| **Attachment scanning**     | No (antivirus integration future)   | Fables doesn't scan for malware. User is responsible for safe downloads.            |
| **Inline PDF rendering**    | Disabled (downloaded as attachment) | PDFs are served with `Content-Disposition: attachment` to prevent inline execution. |
| **Image dimensions**        | Not enforced                        | Zip bombs / decompression attacks are theoretically possible (rare in practice).    |

### 8. Secrets Management

| Setting                         | Default                   | Reasoning                                                                                            |
| ------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Secrets in notes**            | Allowed (but discouraged) | Fables doesn't prevent users from storing API keys in notes. User education is the control.          |
| **FABLES_TOKEN in env only**    | Enforced                  | Bearer token is stored in environment variables (not in a config file). Reduces accidental exposure. |
| **Password in version control** | Prevented (`.gitignore`)  | Fables source code excludes `.env` files. Lockfile is committed.                                     |
| **Dependency audit**            | Automated (CI/pnpm audit) | Every commit runs `pnpm audit`. Critical vulnerabilities block merge.                                |

---

## Self-Audit Checklist

Use this checklist to verify that your Fables instance is hardened. Check each item as you review.

### Network Layer

- [ ] **Tailscale VPN is running** (`tailscale status` shows device online).
- [ ] **Tailscale Funnel is disabled** (Fables is not exposed to the public internet).
- [ ] **No listener on 0.0.0.0:3000 or similar** (only listening on localhost or Tailscale interface).
  ```bash
  netstat -tlnp | grep -E ':(3000|5000|8080)' | grep -v 127.0.0.1 | grep -v ts-
  # Output should be empty (no public listeners)
  ```
- [ ] **HTTPS/TLS is enforced** (Fables server uses Tailscale's certificates).
- [ ] **Firewall is enabled** (macOS: System Preferences → Security → Firewall, Windows: Windows Defender Firewall).

### Encryption (Tier 2)

- [ ] **Vault encryption is enabled** (if using vault mode, check settings).
- [ ] **Passphrase is strong** (12+ characters, random or memorable).
- [ ] **Passphrase is NOT the same as OS login password** or email password.
- [ ] **Passphrase is stored securely** (in your head, a password manager, or a safe—NOT a sticky note on your monitor).
- [ ] **Keys are zeroed on lock** (when you lock the vault, memory is cleared; verified in code review).

### Data Storage

- [ ] **`~/.fables` directory has correct permissions** (0755 on the directory, 0600 on files).
  ```bash
  ls -ld ~/.fables
  # Output: drwxr-xr-x (or 755, owned by your user)
  ls -l ~/.fables/fables.sqlite
  # Output: -rw------- (or 600, owned by your user)
  ```
- [ ] **No world-readable files in `~/.fables`** (only your user can read).
  ```bash
  find ~/.fables -perm /077 -type f
  # Output should be empty (no files readable by others)
  ```
- [ ] **Backups are encrypted** (if vault is encrypted, `.fablesbak` exports are also encrypted).
- [ ] **Backup storage is secure** (external drive is encrypted, cloud storage has fine-grained access control).

### Search & Export

- [ ] **Search queries are not logged** (verify in server logs that search input is never stored).
- [ ] **Export warnings are shown** (when exporting in plaintext, user sees a warning).
- [ ] **Exported files are handled securely** (stored encrypted or in a secure location).

### Plugins & Extensions

- [ ] **No untrusted plugins are installed** (Plugins → list all → verify each is from a trusted source).
- [ ] **Plugin permissions are minimal** (each plugin has only the permissions it needs).
- [ ] **Plugins cannot access the filesystem** (no fs, no network API exposed).
- [ ] **Plugins run in worker threads** (isolated from the main process; verified in code review).

### Collaboration & Sharing

- [ ] **No unintended share links exist** (Settings → Sharing → verify all listed documents are intentional).
- [ ] **Share links have expiration dates** (optional, but recommended for sensitive docs).
- [ ] **Presence is visible to collaborators** (or privacy mode is enabled, user's choice).
- [ ] **Read-only sharing is used for sensitive docs** (edit-only shares are avoided when possible).

### Logging & Auditing

- [ ] **Server logs are accessible** (`~/.fables/logs/` directory exists).
- [ ] **Logs contain no note content** (spot-check: open a log file, verify only operation summaries).
  ```bash
  head -20 ~/.fables/logs/fables-*.log
  # Should show operation counts, route hits; no plaintext note content
  ```
- [ ] **Logs are rotated** (old logs are not retained indefinitely).
- [ ] **Audit trail is enabled** (if using vault for compliance; optional in Tier 1).

### Authentication & Secrets

- [ ] **FABLES_TOKEN is set in environment only** (not in a config file).
  ```bash
  echo $FABLES_TOKEN  # Should show the token (if enabled)
  # OR
  grep -r "FABLES_TOKEN" ~/.fables/  # Should be empty (not in config files)
  ```
- [ ] **No secrets are committed to the repo** (run `git-secrets` or `trufflehog` scan).
- [ ] **Dependencies are audited** (run `pnpm audit` and fix high/critical vulnerabilities).

### OS & Hardware

- [ ] **Machine is running the latest OS updates** (check for security patches).
- [ ] **Full-disk encryption is enabled** (FileVault on macOS, BitLocker on Windows).

  ```bash
  # macOS
  diskutil info / | grep Encrypted
  # Output: Encrypted: Yes

  # Windows (PowerShell)
  manage-bde -status
  # Output: Protection status is On
  ```

- [ ] **Screen lock is enabled** (and set to lock after 5–10 minutes of inactivity).
- [ ] **Antivirus is installed and updated** (Windows Defender or equivalent).

### Best Practices

- [ ] **Regular backups are maintained** (at least one backup per week, stored securely).
- [ ] **Passphrase is memorable** (so you won't write it down or forget it).
- [ ] **No plaintext credentials are stored in notes** (use a password manager instead).
- [ ] **Tailscale ACLs are restrictive** (only necessary devices can access Fables; check https://login.tailscale.com/admin/acls).
- [ ] **Phone is locked with a passcode** (before accessing Fables over Tailscale).

---

## Audit Results

After completing the checklist, you should have:

✅ **Network security:** Tailscale only, TLS enforced, no public exposure.  
✅ **Data at rest:** File permissions strict, or encryption enabled (Tier 2).  
✅ **Secrets:** Passphrases strong, tokens in environment only, no plaintext in repos.  
✅ **Plugins:** Sandboxed, minimal permissions, no filesystem access.  
✅ **Collaboration:** Share links intentional, permissions limited, audit trail available.  
✅ **Logging:** No sensitive content in logs, logs rotated, audit trail enabled (Tier 2+).  
✅ **OS:** Latest updates, disk encryption, screen lock, antivirus.

---

## Common Findings & Fixes

| Finding                                   | Risk     | Fix                                                                         |
| ----------------------------------------- | -------- | --------------------------------------------------------------------------- |
| **Tailscale Funnel enabled accidentally** | HIGH     | Disable Funnel. Run `tailscale funnel off`. Verify no public listeners.     |
| **Weak passphrase**                       | MEDIUM   | Rotate to a strong passphrase (12+ chars). Feature F1221+ coming in Tier 2. |
| **`~/.fables/` world-readable**           | HIGH     | Fix permissions: `chmod 700 ~/.fables`.                                     |
| **FABLES_TOKEN in a config file**         | HIGH     | Move to environment variables; delete from file.                            |
| **Untrusted plugins installed**           | MEDIUM   | Review plugin source; uninstall if suspicious.                              |
| **No backups exist**                      | CRITICAL | Start weekly backups immediately.                                           |
| **Full-disk encryption disabled**         | MEDIUM   | Enable FileVault (macOS) or BitLocker (Windows).                            |
| **Share link never expires**              | LOW      | Set expiration date in Sharing settings (F1141+).                           |
| **Server logs contain note content**      | HIGH     | Report as bug. Should never include plaintext notes.                        |

---

## Compliance Tiers

### Tier 1 (Default): Single-User Personal Knowledge OS

✅ Tailnet perimeter  
✅ File permissions  
✅ TLS encryption in transit  
✅ Plugin sandboxing  
❌ No encryption at rest (plaintext SQLite)  
❌ No audit trail

**Use case:** Personal notes, not sensitive to device theft.  
**Recommendation:** Pair with full-disk encryption (FileVault, BitLocker).

### Tier 2 (Shipped, F1211+): Encrypted Vault

✅ All of Tier 1  
✅ Encryption at rest (Argon2id + XChaCha20-Poly1305)  
✅ Passphrase-protected master key  
✅ Per-vault data key  
✅ Tamper-evident audit trail (hash-chained, always on)  
✅ Full vault wipe with verification  
✅ SSRF guard for outbound fetches  
❌ No multi-device cloud sync (yet)

**Use case:** Sensitive notes, protection against disk theft.  
**Recommendation:** Use strong passphrase, maintain offline backups.

### Tier 3 (Future): Compliance-Grade

✅ All of Tier 2  
✅ Full audit log with forensic recovery  
✅ Legal hold (freeze deletions)  
✅ Redaction tool (purge content from history)  
✅ Data retention policies  
✅ Data inventory export  
✅ Vault wipe with verification

**Use case:** Enterprise, regulated industries (healthcare, finance, legal).  
**Recommendation:** Enable all audit/compliance features.

---

## Reporting Security Issues

If you discover a security flaw or configuration issue:

1. **Do not post publicly** (avoid disclosing exploits).
2. **Report to:** [security@fables.example.com](mailto:security@fables.example.com) or GitHub Security Advisory.
3. **Include:** Description, steps to reproduce, Fables version, OS, impact.

---

## References

- **Main Security Doc:** `docs/security.md`
- **Threat Model v2:** `docs/security/threat-model-v2.md`
- **Incident Response:** `docs/security/incident-response.md`
- **Crypto Design:** `docs/security/crypto-design.md`

---

**Last updated:** Day 14, Epic 13 (F1278 + F1284 + F1281). Covers Tier 1 defaults and Tier 2 encryption (shipped). Tier 2 includes vault encryption, passphrase-protected keys, audit log, vault wipe, SSRF guards. Audit checklist is actionable and includes command examples.
