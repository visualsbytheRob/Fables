# Vault Compromise Attack Tree (F1272)

This document enumerates the paths an attacker could take to compromise the encrypted vault, with the specific mitigations for each leaf node.

**Goal:** Decrypt the vault and read plaintext note content.

```
                         Vault Compromise
                               |
                    ┌──────────┼──────────┐
                    |          |          |
         Brute-Force   Memory    Steal    Trick User
         Passphrase   Attack   Laptop    into Reveal
            (Path A) (Path B)  (Path C)   (Path D)
```

---

## Path A: Brute-Force Passphrase (Offline)

**Precondition:** Attacker has stolen the laptop and extracted the vault data (SQLite + salt + wrapped key).

### A1: Dictionary Attack

**Attack:** Try 10,000 common passwords/phrases.

**Mitigations:**

- **Argon2id cost (F1202):** Each attempt costs 3 seconds (moderate) to 8+ seconds (sensitive).
- **Unique salt (F1202):** Every vault has a different salt. Rainbow tables don't apply.
- **Memory hardness:** Argon2id requires 64 MB RAM per operation. GPU parallelization is bottlenecked by memory bandwidth.

**Residual risk:** LOW. 10,000 attempts = ~8 hours to ~24 hours depending on hardware. A motivated attacker might rent GPU time, but cost scales with attack duration. Defense: use a passphrase that's not a dictionary word.

**References:** F1202 (key derivation), F1209 (param versioning), `packages/core/src/crypto.ts:deriveMasterKey()`.

---

### A2: Brute Force All 6-Char Alphanumeric

**Attack:** Try all ~296 million possible 6-character passphrases.

**Mitigations:**

- **Argon2id cost:** Same as A1. 296 million attempts × 3 seconds = ~27 years on a single CPU.
- **Cost amortization (limited):** Attacker rents 1,000 GPUs. Cost: ~10 days. Not trivial, but very expensive.

**Residual risk:** MEDIUM-LOW. Practical only for highly motivated attackers or nation-state-level resources. Defense: use passphrase > 7 characters, or combine words.

**References:** F1202, Argon2 design (https://password-hashing.info/).

---

### A3: Precomputed Lookup Table (Attacker Knows Salt)

**Attack:** Build a lookup table of (passphrase → key) for all passphrases and this specific vault's salt.

**Mitigations:**

- **Table size:** Each entry is (passphrase + salt + key) → at least 100+ bytes. 296 million entries = 30+ TB. Impractical to store.
- **Computation cost:** Computing the table itself costs the same as A2 (27 years). Not a shortcut.

**Residual risk:** NEGLIGIBLE. The table is too large to build or store.

**References:** F1202 (salt randomness), libsodium's salting design.

---

### A4: Side-Channel on KDF (Timing, Power)

**Attack:** Measure the time or power consumption of the KDF and infer passphrase bits.

**Mitigations:**

- **Argon2id constant-time:** The KDF's runtime does not leak information about the passphrase (it's a hash of the passphrase, not a branching algorithm).
- **Timing attacks not applicable:** Even if two passphrases have different hashes, the KDF takes the same time to compute the hash.

**Residual risk:** NEGLIGIBLE. Timing attacks don't apply to Argon2id (it's designed to be timing-resistant).

**References:** Argon2 spec, libsodium's implementation.

---

## Path B: Memory/Runtime Attacks (Active Vault)

**Precondition:** User is active (vault is unlocked) and attacker has local code execution (malware, debugger, DLL injection).

### B1: Read Master Key from Memory (Debugger / gdb)

**Attack:** Attach a debugger to the Fables process, read the `masterKey` variable from the heap.

**Mitigations:**

- **Key zeroing (F1205):** Immediately after the KDF returns, the key is in memory. It's used to unwrap data keys, then filled with 0x00. Window is microseconds.
- **Process isolation (OS):** A regular user cannot attach a debugger to another user's process without sudo/admin privileges.
- **Privileged debugging warning:** If user runs Fables with `sudo`, they've elevated the attack surface. Not Fables' fault.

**Residual risk:** MEDIUM (if attacker has local code execution). Defense: don't run untrusted binaries, use antivirus.

**References:** F1205 (zeroing), `packages/core/src/crypto.ts:zeroKey()`.

---

### B2: Memory Scraping (DLL Injection)

**Attack:** Inject a DLL that reads the heap of the Fables process and searches for key-sized buffers.

**Mitigations:**

- **Key zeroing (F1205):** Keys are filled with 0x00 as soon as possible. After 1 millisecond of inactivity, only data keys exist and they're wrapped (ciphertext, not plaintext).
- **Entropy check:** A random key has ~256 bits of entropy. Searching the heap for "random-looking" buffers is impractical (too many false positives).
- **Process isolation (OS):** DLL injection requires elevated privileges. A regular user can't DLL-inject into another user's process.

**Residual risk:** MEDIUM-HIGH (if attacker has admin privileges). Defense: don't run untrusted code as admin.

**References:** F1205, Windows security model (process isolation).

---

### B3: Cold-Boot Attack

**Attack:** Machine is running (vault unlocked), attacker forces shutdown and dumps RAM before power loss.

**Mitigations:**

- **Key zeroing (F1205):** If vault is locked, keys are zeroed. If vault is active, keys are in RAM (no defense).
- **Sleep/hibernation:** Modern systems use memory encryption on sleep (e.g., Intel SME, AMD SEV). Prevents cold-boot attacks if the machine is asleep.
- **Lock on idle (F1231–F1240, future):** Auto-lock after 5 minutes. User must re-enter passphrase.
- **DRAM decay:** DRAM contents degrade after ~1 second without power. Keys may be unrecoverable if dump is delayed.

**Residual risk:** MEDIUM. If vault is actively unlocked, attacker wins. Defense: lock vault when stepping away, or use hardware security key (future).

**References:** F1205, F1231–F1240 (lock behavior, future).

---

### B4: Side-Channel on Encryption (Cache Timing)

**Attack:** Measure cache hit/miss timing during encryption operations to infer plaintext or key bits.

**Mitigations:**

- **libsodium constant-time:** XChaCha20-Poly1305 is timing-resistant (no data-dependent branches or memory accesses).
- **Hardware support:** Modern CPUs have cache-timing defenses (Intel CAT, AMD SMT isolation).

**Residual risk:** NEGLIGIBLE. Libsodium's primitives are designed to resist cache timing.

**References:** Libsodium documentation, ChaCha20 constant-time design.

---

## Path C: Steal Laptop & Extract Data

**Precondition:** Attacker has physical possession of the machine and can boot it or extract the storage.

### C1: Read Unencrypted Vault Mode

**Attack:** Boot into a different OS or remove the storage, access SQLite directly.

**Mitigations:**

- **Vault encryption mode (F1211–F1220):** All note bodies, entity data, and attachments are encrypted at rest.
- **Full disk encryption (recommended):** User should enable FileVault (macOS) or BitLocker (Windows). Fables assumes this responsibility is outside its scope.
- **SQLite permissions (0600):** Even if disk is readable, OS file permissions deny access (unless attacker mounts as root).

**Residual risk:** MEDIUM (if vault is in unencrypted mode). Defense: enable encryption mode, or use full-disk encryption.

**References:** F1211–F1220 (encrypted storage, future).

---

### C2: Brute-Force Offline (Path A Re-applied)

**Attack:** Extract the SQLite file, salt, and wrapped key. Try passphrases offline.

**Mitigations:** Same as Path A (dictionary attack, brute force).

**Residual risk:** MEDIUM-LOW (see A1, A2).

**References:** F1202.

---

### C3: Extract Key Material from Backup

**Attack:** Find a `.fablesbak` backup file on the disk that was exported in plaintext.

**Mitigations:**

- **Backup inheritance:** Exported backups inherit the vault's encryption state. If vault is encrypted, backup is encrypted.
- **User responsibility:** If user exported in plaintext mode, backup is plaintext. Fables must educate users on this risk.
- **Backup encryption (future):** (F1281+, compliance tier) Always encrypt backups, prompt user for separate backup passphrase.

**Residual risk:** MEDIUM (if backup is plaintext and unencrypted). Defense: store backups in encrypted containers (VeraCrypt, etc.) or on encrypted external drives.

**References:** F1281+ (compliance features, future).

---

### C4: BIOS/Firmware Modification

**Attack:** Rewrite the UEFI firmware to enable booting into a custom OS, then read the disk.

**Mitigations:**

- **UEFI Secure Boot:** Verify firmware signatures. Prevents boot into unsigned code.
- **Password-protected BIOS:** Attacker can't change firmware settings without entering the BIOS password.
- **TPM (Trusted Platform Module):** Seals encryption keys to the device's hardware identity. Stolen disk is useless on another machine.

**Residual risk:** MEDIUM-LOW (if Secure Boot and BIOS password are enabled). Defense: enable BIOS security features.

**References:** OS-level security (out of Fables' scope), TPM.org.

---

## Path D: Trick User into Revealing Passphrase

**Precondition:** User is social-engineered or phished.

### D1: Phishing Email / Social Engineering

**Attack:** Attacker impersonates Fables support, asks user to reply with passphrase for "account recovery."

**Mitigations:**

- **No support channel asks for passphrases:** Fables documentation explicitly states this. User education.
- **Passphrase is never sent:** It's only stored in the user's mind. No recovery procedure exists.
- **Hardware security key (future, F1251+):** Multi-factor unlock prevents a single leaked passphrase from compromising the vault.

**Residual risk:** MEDIUM (user error). Defense: users should never type passphrases into forms or emails.

**References:** OWASP phishing prevention, user security best practices.

---

### D2: Shoulder Surfing / Observation Attack

**Attack:** Attacker watches user type the passphrase.

**Mitigations:**

- **Browser password input (masked):** Web form hides typed characters.
- **Lock screen / privacy screen:** User should lock their device when stepping away.

**Residual risk:** MEDIUM (physical security). Defense: use a privacy screen, don't type around strangers.

**References:** Physical security best practices.

---

### D3: Keylogger (Malware)

**Attack:** Malware logs keystrokes as user types the passphrase.

**Mitigations:**

- **Antivirus / EDR:** Run reputable security software.
- **Secure input (OS feature):** Modern browsers implement "secure input" to prevent keylogging by processes not in focus. Varies by OS.
- **Hardware keyboard logging (attacker has device):** Can't be defended by software.

**Residual risk:** MEDIUM-HIGH (if malware is present). Defense: run antivirus, keep OS updated, don't plug in untrusted USB devices.

**References:** Antivirus, OS security updates.

---

### D4: Prompt Injection / UI Spoofing

**Attack:** Malware displays a fake "vault unlock" dialog, captures passphrase.

**Mitigations:**

- **Secure UI (OS feature):** OS should prevent spoofing of system dialogs (varies by platform).
- **Browser UI consistency:** The unlock form is in the web app. Spoofing requires tricking the browser (very hard).

**Residual risk:** MEDIUM (if OS is compromised). Defense: use security software, verify the URL is `https://<your-machine>.ts.net`.

**References:** OS security model.

---

## Summary Table: Attack Paths & Mitigations

| Path   | Attack                    | Precondition             | Mitigation                               | Residual Risk | Defense                          |
| ------ | ------------------------- | ------------------------ | ---------------------------------------- | ------------- | -------------------------------- |
| **A**  | Brute-force passphrase    | Stolen laptop            | Argon2id cost + unique salt              | MEDIUM-LOW    | Strong passphrase (12+ chars)    |
| **B1** | Debugger reads key        | Local code execution     | Key zeroing + process isolation          | MEDIUM        | Don't run untrusted code         |
| **B2** | Memory scraping (DLL)     | Admin/local access       | Key zeroing + entropy                    | MEDIUM-HIGH   | Don't elevate Fables to admin    |
| **B3** | Cold-boot attack          | Running machine          | Lock on idle (future) + sleep encryption | MEDIUM        | Lock vault when away             |
| **B4** | Cache-timing side-channel | Active encryption        | libsodium constant-time                  | NEGLIGIBLE    | (None needed)                    |
| **C1** | Read unencrypted vault    | Physical theft           | Encryption mode + disk encryption        | MEDIUM        | Enable vault encryption mode     |
| **C2** | Offline brute-force       | Extracted SQLite         | Argon2id cost                            | MEDIUM-LOW    | Strong passphrase                |
| **C3** | Extract plaintext backup  | Physical theft + backup  | Backup encryption (future)               | MEDIUM        | Store backups encrypted          |
| **C4** | Firmware modification     | Physical theft           | UEFI Secure Boot + BIOS password         | MEDIUM-LOW    | Enable BIOS security             |
| **D1** | Phishing                  | Social engineering       | User education + no recovery             | MEDIUM        | Never reply with passphrase      |
| **D2** | Shoulder surfing          | Physical observation     | Privacy screen + lock on idle            | MEDIUM        | Use privacy screen               |
| **D3** | Keylogger                 | Malware installed        | Antivirus + secure input (OS)            | MEDIUM-HIGH   | Run antivirus                    |
| **D4** | UI spoofing               | Malware / compromised OS | Secure UI (OS) + verify URL              | MEDIUM        | Check `https://<machine>.ts.net` |

---

## Risk Levels by Scenario

### Easiest for Attacker: Path D (Social Engineering)

- No technical skills needed.
- User can be tricked by a convincing email.
- **Defense:** User education and authentication best practices.

### Hardest for Attacker: Path A (Brute Force)

- Requires stolen device.
- Cost scales with passphrase strength.
- With 12+ character passphrase, cost is years to decades.
- **Defense:** Strong passphrase chosen at vault creation.

### Most Likely (if Machine is Compromised): Path B (Memory Attack)

- Requires malware or elevated privileges.
- Trivial if attacker has admin access.
- **Defense:** Antivirus, OS security updates, principle of least privilege.

### Highest Impact (Least Effort if Device is Stolen): Path C1 (Unencrypted Vault)

- No passphrase guessing needed.
- If vault is unencrypted, read SQLite directly.
- **Defense:** Enable vault encryption mode.

---

## Recommendations

1. **Threat A & B:** Use a strong passphrase (12+ characters, random or memorized passprase like BIP39).
2. **Threat B:** Don't run Fables as admin. Enable OS antivirus. Lock vault on idle.
3. **Threat C:** Enable vault encryption mode (F1211–F1220, in progress). Use full-disk encryption (FileVault/BitLocker).
4. **Threat D:** Never give your passphrase to anyone. No legitimate support channel will ask for it.
5. **Threat B3:** Enable auto-lock after 5 minutes (F1231–F1240, future).
6. **Threat C3:** Store backups in encrypted containers. Or use cloud backup with client-side encryption (future, F1281+).

---

## Future Mitigations

- **F1231–F1240:** Lock on idle, screen lock integration.
- **F1251+:** Hardware security key (FIDO2) as alternative to passphrase.
- **F1281+:** Full vault wipe with verification, backup encryption, retention policies, tamper-evident audit log.
- **Biometric unlock:** Fingerprint/face unlock (via OS APIs) as MFA.

---

## References

- **Threat Model v2:** `docs/security/threat-model-v2.md`
- **Crypto Design:** `docs/security/crypto-design.md`
- **Incident Response:** `docs/security/incident-response.md`
- **OWASP:** https://owasp.org/
- **Argon2 Security:** https://password-hashing.info/

---

**Last updated:** Day 11, Epic 13 F1272. Compiled by security team. See threat-model-v2.md for context.
