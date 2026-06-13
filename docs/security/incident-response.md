# Incident Response Runbook (F1277)

This document describes recovery procedures for common security and data incidents in Fables.

---

## Incident 1: Forgotten Vault Passphrase

**Symptoms:** User unlocked the vault, locked it, and now can't remember the passphrase.

### Assessment

**Data Loss Risk:** TOTAL. The passphrase is the only key to decrypt the vault. No recovery mechanism exists by design.

**Why?** A recovery mechanism would require storing the passphrase somewhere (e.g., server, backup), which defeats the purpose of client-side encryption.

### Recovery Steps

**Option A: Decrypt Using a Backup (if available)**

1. Restore `~/.fables/` from a backup taken BEFORE encryption was enabled (plaintext vault).
2. Upgrade to the latest Fables version.
3. Enable encryption mode again with a NEW passphrase you will remember.

**Precondition:** You must have a backup of the plaintext vault. If vault was encrypted when backed up, this won't help.

**Option B: Accept Data Loss & Start Fresh**

1. Back up the current `~/.fables/` directory to an external drive (for forensic analysis, optional).
2. Delete `~/.fables/`.
3. Restart Fables.
4. Fables creates a fresh vault with no data.
5. Restore from backups if you have unencrypted exports (`.md` files, `.fablesbak` plaintext backups).

**Option C: Brute-Force Offline (Expert Only)**

If your passphrase was weak (e.g., 6 characters), you could attempt to brute-force the KDF offline:

1. Extract `~/.fables/fables.sqlite`.
2. Extract the wrapped data key (query `SELECT wrapped_key FROM crypto_keys WHERE ...`).
3. Write a script using libsodium to try candidate passphrases.
4. Cost: 3 seconds per attempt × passphrase space. 1 million attempts = ~35 days on a single CPU.

**Not recommended.** Only feasible for very weak passphrases, and requires expertise.

---

## Incident 2: Vault Corruption (Encrypted)

**Symptoms:** Error on unlock: `"sealed envelope too short"` or `"unsupported algorithm id"`.

### Assessment

**Data Loss Risk:** MEDIUM to HIGH. The vault is corrupted, likely unrecoverable.

**Possible causes:**

- SQLite database corrupted (rare, but can happen if power fails during write).
- Wrapped data key corrupted.
- Encryption parameters were changed improperly.

### Recovery Steps

**Step 1: Verify the Corruption**

```bash
# Check SQLite integrity
sqlite3 ~/.fables/fables.sqlite "PRAGMA integrity_check;"
# Output: "ok" or error message listing corrupt tables
```

If output is "ok", the corruption is in the envelope format (not SQLite itself).

**Step 2: Inspect the Wrapped Key**

```bash
# Query the wrapped key
sqlite3 ~/.fables/fables.sqlite \
  "SELECT hex(wrapped_key), hex(salt) FROM crypto_keys LIMIT 1;"
# Output: hex-encoded wrapped key and salt

# Check if the envelope is valid (first 3 bytes are version + alg + nonce len)
# Expected: v=01, alg=01, nonce_len=18 (24 bytes in hex)
```

If the first byte is not `01`, the version is unrecognized.

**Step 3: Attempt Recovery from Backup**

1. Stop Fables.
2. Restore `~/.fables/` from a recent backup.
3. Restart Fables and unlock with your passphrase.
4. If the backup is also corrupt, try an older backup.

**Step 4: If All Backups Are Corrupt**

1. Check if you have plaintext exports (`.md` files, unencrypted `.fablesbak`).
2. Manually re-import the exports into a fresh vault.
3. If you don't have backups, the data is lost.

---

## Incident 3: Device Stolen (Encrypted Vault)

**Symptoms:** Your laptop was stolen, and the vault is in encrypted mode.

### Assessment

**Data Loss Risk:** MEDIUM (if passphrase is strong) to HIGH (if passphrase is weak).

**Time to Mitigate:** Immediate action required.

### Response Steps

**Immediate (First 24 hours)**

1. **Change your Tailscale account password** (https://login.tailscale.com).
   - This revokes all existing devices' access to your tailnet.
   - Attacker cannot view live data over the VPN.

2. **Revoke collaboration share links** (if any).
   - Log in from another device.
   - In Fables settings, list all shared documents.
   - Revoke the links.
   - Attacker cannot access shared docs anymore.

3. **Rotate your FABLES_TOKEN** (if enabled).
   - Generate a new token.
   - Update your server environment.
   - Attacker cannot authenticate to the API.

**Short-term (24 hours to 1 week)**

4. **Monitor Tailscale activity** (https://login.tailscale.com/admin/machines).
   - Confirm the stolen device is not actively accessing your tailnet.
   - If it is, the attacker knows your Tailscale password. You may have a larger compromise.

5. **Assess backup location**.
   - If backups are stored on an external drive that was also stolen, they're at risk too.
   - If backups are in the cloud (future), ensure they're encrypted and access revoked on the stolen device.

**Long-term (1 week onwards)**

6. **Wipe the remote device** (if you have remote access).
   - Some devices support remote wipe via MDM or iCloud.
   - Use it if available.

7. **Assume vault is secure** (if passphrase was strong).
   - The attacker cannot decrypt the vault without your passphrase.
   - Argon2id with a 12+ character passphrase would take years to brute-force.

8. **Assume vault is compromised** (if passphrase was weak).
   - The attacker could have brute-forced the KDF (days to weeks with a weak passphrase).
   - You may need to manually rotate sensitive data (passwords stored in entities, etc.).

### Passphrase Strength Assessment

| Passphrase                                | Cost to Brute-Force | Assessment               |
| ----------------------------------------- | ------------------- | ------------------------ |
| "password" (8 chars)                      | Hours               | WEAK, assume compromised |
| "correct-horse-battery-staple" (28 chars) | 10,000+ years       | STRONG, assume safe      |
| "MyVault2024!" (12 chars, mixed)          | 1–10 years          | MEDIUM, monitor closely  |

**If you're unsure:**

- Assume the worst (passphrase is weak).
- Plan to change sensitive data (rotate API keys, etc.).
- Monitor for unauthorized access to your accounts.

---

## Incident 4: Key Material Leak (Backup or Export)

**Symptoms:** You exported a backup and realized it was plaintext (vault was in plaintext mode).

### Assessment

**Data Loss Risk:** MEDIUM (depends on backup location).

**Scenarios:**

- Backup was emailed to yourself (email provider can read it).
- Backup was uploaded to cloud storage (service owner can read it).
- Backup was stored on an external drive left in a public place.

### Recovery Steps

**If Backup is Still Available (Attacker Hasn't Found It Yet)**

1. **Locate the backup** (email, cloud storage, USB drive).
2. **Delete it immediately** from all locations.
3. **Verify deletion** (check trash, cloud recycle bin, etc.).
4. **Assume your data was exposed** if the backup was in an untrusted location.

**Minimize Future Exposure**

1. **Always use encryption mode** (F1211+) before exporting backups.
2. **Export to encrypted containers** (VeraCrypt, BitLocker) or encrypted external drives.
3. **Never email backups** without encryption.
4. **Use private cloud storage** (S3 with server-side encryption, or encrypted storage services like Tresorit).

**If Sensitive Data Was in the Backup**

1. **Rotate API keys** if any were stored in entities.
2. **Change passwords** if any were stored (use a password manager instead).
3. **Monitor your accounts** for unauthorized access (check login history, IP addresses, etc.).

---

## Incident 5: Malicious Plugin Installed

**Symptoms:** A plugin is behaving suspiciously (slow performance, weird API calls, crashes).

### Assessment

**Data Loss Risk:** LOW (plugin is sandboxed) to MEDIUM (if plugin has "read notes" permission).

**Plugin Capabilities (Assumed Worst-Case)**

- ✅ Can read notes (if permission granted at install).
- ✅ Can modify entities (if permission granted).
- ❌ Cannot access encryption keys (never exposed to plugins).
- ❌ Cannot access filesystem or network (not available).
- ❌ Cannot escape worker thread sandbox (would require V8 exploit).

### Recovery Steps

1. **Uninstall the plugin immediately**.
   - Fables settings → Plugins → click the trash icon.

2. **Check what data the plugin accessed**.
   - Audit log (F1284, future): review operations performed by the plugin.
   - Manual review: check if the plugin modified any notes/entities.

3. **Restore from backup** if the plugin corrupted data.
   - Restore `~/.fables/` from backup.
   - Re-import any lost changes.

4. **Review the plugin's manifest and code** (if open-source).
   - Look for suspicious permissions (e.g., "write entities" without legitimate reason).
   - Report the plugin to the Fables security team if you suspect malice.

5. **Reinstall only trusted plugins**.
   - Prefer plugins from the official catalog (with code review).
   - Read plugin reviews before installing.

---

## Incident 6: Compromised Server (Local Machine)

**Symptoms:** Fables server process is behaving erratically (crashes, slow, refusing connections).

### Assessment

**Data Loss Risk:** MEDIUM (malware may corrupt the database).

**Possible Causes:**

- Malware on your machine (rootkit, virus).
- Disk I/O error (hardware failure).
- Software bug in Fables (report as a GitHub issue).

### Recovery Steps

**If You Suspect Malware**

1. **Isolate the machine** (unplug from Tailscale immediately).
   - Run `tailscale down` in terminal.
   - This prevents the attacker from accessing your vault over the network.

2. **Back up critical data** (if possible).
   - Copy `~/.fables/` to an external USB drive.
   - This preserves the vault even if the machine is damaged.

3. **Run antivirus scan**.
   - Use a reputable antivirus (e.g., Kaspersky Rescue Disk, Bitdefender, Malwarebytes).
   - Boot from a clean USB if possible (to scan while OS is not running).

4. **If malware is detected:**
   - Quarantine / remove it.
   - Change all passwords from a clean machine.
   - Monitor accounts for unauthorized access.

5. **Restore Fables** (if data was corrupted).
   - Restore `~/.fables/` from a clean backup (USB drive or cloud storage).
   - Restart Fables.

**If You Suspect a Software Bug**

1. Check Fables logs: `~/.fables/logs/`.
2. Report the error to the Fables GitHub issues with:
   - The error message.
   - Steps to reproduce.
   - Your Fables version and OS.
3. In the meantime, restart Fables and try again.

---

## Incident 7: Passphrase Compromised (Leaked, Guessed, Phished)

**Symptoms:** You suspect someone knows your vault passphrase (saw you type it, phishing email, keylogger).

### Assessment

**Data Loss Risk:** TOTAL (if attacker has passphrase + device).

**Mitigations:**

- If attacker has passphrase but NOT the device, they need to brute-force the wrapped key (hard).
- If attacker has device but NOT passphrase, they can't decrypt the vault (hard if strong passphrase).
- If attacker has BOTH, vault is compromised.

### Recovery Steps

**Immediate**

1. **Change your Tailscale password** (revokes all devices).
2. **Rotate your FABLES_TOKEN** (if enabled).
3. **Stop Fables** and run Tailscale down (isolate from network).

**Short-term**

4. **Change your vault passphrase** (F1221+, future feature).
   - Enter the old passphrase → unlock vault.
   - In settings, change to a NEW passphrase.
   - Fables re-wraps the data key under the new master key.
   - All existing note content stays encrypted under the original data key.
   - No re-encryption needed (cheap operation).

5. **If passphrase change is not yet implemented:**
   - Export vault as plaintext or encrypted backup.
   - Delete `~/.fables/`.
   - Create a new vault with a NEW, strong passphrase.
   - Re-import your data from the backup.

**Assume Compromise**

6. Assume someone has read some or all of your notes.
7. Change sensitive information (rotate API keys, etc.).
8. Monitor accounts for unauthorized access.

---

## Incident 8: Collaboration Share Link Leaked

**Symptoms:** A share link URL was accidentally sent to the wrong person, or guessed by an attacker.

### Assessment

**Data Loss Risk:** LOW to MEDIUM (depends on permission level).

**Leakage:**

- Share link gives access to the shared document only (not the entire vault).
- Attacker can read or edit (depending on permission level).
- Other documents are NOT accessible.

### Recovery Steps

**Immediate**

1. **Revoke the share link** (F1141+, in settings).
   - Go to Fables settings → Sharing → find the link → click revoke.
   - Attacker loses access immediately.

2. **Check document history** (if audit log is available, F1284).
   - See if the attacker made any changes.
   - Use the undo/restore feature to revert malicious edits.

**If Damage Was Done**

3. **Restore from backup** if the attacker corrupted the document.
4. **Re-share with the correct collaborators** (new link).
5. **Review document content** for deleted or modified text.

---

## Incident 9: CRDT Merge Conflict During Collaboration

**Symptoms:** Two collaborators made conflicting edits (both deleted the same sentence), and the UI shows a merge conflict.

### Assessment

**Data Loss Risk:** LOW (CRDT resolves conflicts deterministically).

**What Happened:**

- Both collaborators edited the same note simultaneously.
- CRDT detected a conflict (both attempted the same deletion).
- Fables resolved it using the CRDT algorithm (e.g., last-write-wins, or vector-clock tiebreaker).

### Recovery Steps

**Resolve the Conflict**

1. Review the conflict in the UI (if conflict UI is available, F1161+).
2. Choose the version you want:
   - Accept your version (undo collaborator's change).
   - Accept collaborator's version (undo your change).
   - Merge manually (keep both, edit to combine).
3. Save the resolved document.

**Prevent Future Conflicts**

- Communicate with collaborators in real-time (use presence indicators to see who's editing).
- Use cursor positions to avoid overlapping edits.
- Avoid simultaneous bulk deletes.

---

## Incident 10: Backup Recovery from Full Disk Encryption Failure

**Symptoms:** Your hard drive failed, machine was stolen, or you're migrating to a new device.

### Assessment

**Data Loss Risk:** TOTAL (if no backup exists) or NONE (if backup is available).

### Recovery Steps

**If You Have a Recent Backup**

1. **Get a new machine**.
2. **Install Fables** on the new machine.
3. **Restore the backup**:
   - If backup is plaintext (`.md` files or plaintext `.fablesbak`):
     - Use the import wizard (Fables UI).
     - Select the backup files and import.
   - If backup is encrypted (`.fablesbak` created in vault mode):
     - Copy the backup file to `~/.fables/` on the new machine.
     - Restart Fables.
     - Unlock with your vault passphrase.
     - Data is restored.

4. **Verify data integrity**: Check a few notes to ensure the restore was successful.

**If You Don't Have a Backup**

- Data is lost. No recovery is possible.
- For future, always maintain backups:
  - Export a plaintext backup weekly (Settings → Export).
  - Store the backup in multiple locations (cloud, external drive, etc.).
  - If vault mode is enabled, encrypted backups are equally safe.

---

## Incident Severity Levels

| Severity     | Example                                                 | Recovery Time      | Data Loss  |
| ------------ | ------------------------------------------------------- | ------------------ | ---------- |
| **Critical** | Stolen device + weak passphrase, full server compromise | Days to weeks      | HIGH       |
| **High**     | Forgotten passphrase, vault corruption, backup leak     | Hours to days      | MEDIUM     |
| **Medium**   | Malicious plugin, passphrase phished, merge conflict    | Minutes to hours   | LOW        |
| **Low**      | Share link leaked (but revoked), CRDT merge conflict    | Seconds to minutes | NEGLIGIBLE |

---

## Reporting Security Incidents

If you discover a security vulnerability or incident:

1. **Do not post publicly** (avoid giving attackers detailed information).
2. **Report to:** security@fables.example.com (or GitHub security advisory, TBD).
3. **Include:**
   - Description of the incident.
   - Steps to reproduce (if applicable).
   - Your Fables version and OS.
   - Impact assessment (data loss, access control, etc.).
   - Any evidence (logs, error messages, screenshots).

The Fables security team will:

- Acknowledge receipt within 24 hours.
- Investigate and fix the issue.
- Release a security patch.
- Credit you in the changelog (if you want).

---

## Prevention Best Practices

| Threat                   | Prevention                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Forgotten passphrase** | Write it down in a secure location (safe, password manager), or use a hardware security key (future). |
| **Weak passphrase**      | Use 12+ characters, random or memorable (BIP39 word lists).                                           |
| **Vault corruption**     | Maintain regular backups, enable full-disk encryption (FileVault, BitLocker).                         |
| **Device theft**         | Keep your machine locked, use strong OS password, enable Find My device.                              |
| **Malicious plugin**     | Install only from the official catalog, read reviews, check permissions.                              |
| **Passphrase leak**      | Don't type passphrase in chat / email, use a secure password input, enable antivirus.                 |
| **Backup leak**          | Store backups encrypted, use private cloud storage, never email unencrypted.                          |
| **Server compromise**    | Keep OS and Fables updated, run antivirus, use strong OS login.                                       |
| **Collaboration leak**   | Use expiring share links, limit permissions (read-only when possible), audit access.                  |

---

## Recovery Time Estimates

| Incident                                      | Time to Recover | Complexity                            |
| --------------------------------------------- | --------------- | ------------------------------------- |
| Revoke leaked share link                      | <1 minute       | Easy                                  |
| Restore from backup (device fails)            | 1–2 hours       | Medium                                |
| Decrypt vault offline (weak passphrase)       | Days to weeks   | Hard (expert only)                    |
| Brute-force passphrase (attacker with device) | Weeks to years  | Hard (depends on passphrase strength) |

---

## References

- **Threat Model v2:** `docs/security/threat-model-v2.md`
- **Attack Tree:** `docs/security/vault-attack-tree.md`
- **Crypto Design:** `docs/security/crypto-design.md`
- **Privacy Data-Flow:** `docs/security/privacy-data-flow.md`

---

**Last updated:** Day 11, Epic 13 F1277. Covers encryption tier and multi-device collaboration scenarios. Assumes features F1211+ (encrypted storage), F1231–F1240 (lock behavior), and F1141+ (collaboration).
