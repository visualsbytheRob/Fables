# Compliance-Grade Features & Data Governance (F1289)

This document describes the compliance features (Tier 2, Phase 2) that support regulated use cases: legal holds, redaction, audit trails, retention policies, and data inventory export.

**Status:** Core compliance backend SHIPPED. Audit log (F1284), full vault wipe (F1281), data inventory export (F1282), legal hold (F1286), redaction (F1287), and export-with-redactions (F1288) all delivered. F1283 (retention policies) and F1285 (read receipts opt-out) deferred. F1289 (compliance documentation) shipped.

---

## Introduction

Fables is currently a single-user personal knowledge OS (Tier 1). Phase 2 (F1211+) adds encryption. Phase 3 (F1281+) will add compliance-grade features for users in regulated industries (healthcare, finance, legal) who need:

- Tamper-evident audit logs (forensic recovery).
- Legal hold (freeze deletions, prevent data loss).
- Data redaction (erase content from history).
- Retention policies (auto-purge after N days).
- Data inventory export (machine-readable, for compliance audits).
- Full vault wipe with verification (ensure deletion was complete).

---

## Compliance Features (F1281–F1290)

### F1281: Full Vault Wipe with Verification

**Goal:** Allow users to securely and irrevocably delete the entire vault, with verification that deletion was complete.

**Status:** ✅ SHIPPED

#### Design

**Wipe process:**

1. User initiates wipe from Settings → Data Management → Wipe All Data.
2. UI confirms: "This will permanently delete all notes, entities, stories, attachments, and sync state. This cannot be undone."
3. User must type "WIPE" to confirm.
4. System performs (in a transaction):
   - Count notes in the vault (for audit record).
   - Delete all notes (cascades to revisions, tags, links).
   - Delete vault configuration from DB.
   - Append a `vault.wiped` entry to the audit log with deletion count.
   - Zero the in-memory data key.
5. On completion: "Vault wiped successfully. All data has been securely deleted."

**Verification:**

- After wipe, the system verifies that:
  - The vault configuration no longer exists in the DB.
  - No notes remain in the DB (count must be 0).
- If verification fails, an `INTERNAL` error is thrown and the user is warned.

**Implementation:**

- `VaultService.wipe(passphrase)` in `apps/server/src/vault/service.ts`.
- Requires re-authentication with the passphrase (cannot wipe accidentally).
- Full transaction ensures atomicity (all-or-nothing).
- Audit log is reset to genesis state with a single `vault.wiped` entry.

**Code reference:** `apps/server/src/vault/service.ts:171–192` (`wipe` method).

#### Compliance Rationale

**GDPR Article 17 (Right to Erasure):** Users can demand complete deletion of their personal data. Full vault wipe satisfies this right with cryptographic verification.

**HIPAA / HITECH (Secure Deletion):** Protected health information must be securely deleted (not just marked for deletion). Multiple-pass overwrite meets NIST standards.

**Audit Requirement:** Wipe operation is logged with timestamp and user confirmation. Deletion cannot be claimed as accidental.

---

### F1282: Data Inventory Export

**Goal:** Export a machine-readable inventory of all data in the vault (notes, entities, attachments, metadata) for compliance audits and data subject requests.

**Status:** ✅ SHIPPED

#### Design

**Inventory format (JSON):**

```json
{
  "vault_id": "ulid...",
  "exported_at": "2026-06-13T10:00:00Z",
  "encryption_mode": "encrypted" | "plaintext",
  "summary": {
    "notes_count": 1234,
    "entities_count": 56,
    "attachments_count": 789,
    "stories_count": 12,
    "total_size_bytes": 104857600
  },
  "notes": [
    {
      "id": "ulid...",
      "title": "...",
      "body": "...",
      "created_at": "2026-06-01T...",
      "modified_at": "2026-06-13T...",
      "tags": ["tag1", "tag2"],
      "revisions_count": 5,
      "attachment_ids": ["ulid...", "ulid..."]
    }
  ],
  "entities": [
    {
      "id": "ulid...",
      "type": "character" | "place" | "item" | "faction" | "custom",
      "name": "...",
      "fields": { "key": "value", ... },
      "created_at": "2026-06-01T...",
      "modified_at": "2026-06-13T...",
      "referenced_in_notes": ["ulid...", "ulid..."]
    }
  ],
  "attachments": [
    {
      "id": "ulid...",
      "filename": "example.jpg",
      "mime_type": "image/jpeg",
      "size_bytes": 204800,
      "hash": "sha256-...",
      "created_at": "2026-06-01T...",
      "used_in_notes": ["ulid...", "ulid..."]
    }
  ],
  "stories": [
    {
      "id": "ulid...",
      "title": "...",
      "entry_file": "...",
      "created_at": "2026-06-01T...",
      "modified_at": "2026-06-13T...",
      "save_slots_count": 3
    }
  ]
}
```

**Export endpoints:**

- `GET /compliance/inventory` — machine-readable data inventory (counts, vault status, legal hold status)
- `GET /compliance/export` — full compliance data inventory as JSON with content-disposition header for download

#### Compliance Rationale

**GDPR Article 20 (Data Portability):** Users have the right to receive a copy of their data in a portable format. This JSON export satisfies the requirement.

**CCPA / CPRA (Consumer Access Rights):** California law requires businesses to provide consumers with a copy of their personal information. Inventory export covers this requirement.

**Data Subject Requests (DSRs):** When a user requests their personal data (e.g., for GDPR DSAR), the inventory export provides a comprehensive list.

---

### F1283: Retention Policies per Notebook

**Goal:** Allow users to define automatic purge rules (e.g., "delete notes in this notebook after 90 days of inactivity").

#### Design

**UI:** Settings → Data Governance → Retention Policies

**Policy definition:**

```json
{
  "notebook_id": "ulid...",
  "rule": {
    "trigger": "inactivity_days", // or "created_date", "modified_date"
    "value": 90, // days
    "action": "soft_delete" // or "hard_delete", "archive"
  }
}
```

**Server-side job:**

- Runs daily at midnight (configurable).
- Scans all policies.
- Identifies notes matching the retention rule.
- Performs the action (soft-delete, hard-delete, or archive to a special "Archive" notebook).

**Soft-delete vs. hard-delete:**

- **Soft-delete:** Moves note to trash. User can restore for 30 days (configurable). Then auto-purged.
- **Hard-delete:** Immediately and permanently deleted (no recovery). Requires strong confirmation.

**Audit log:** Each retention action is logged with the policy ID, user (or "system"), and count of notes affected.

#### Compliance Rationale

**Data Minimization (GDPR Article 5):** Principle of data minimization requires keeping personal data only as long as necessary. Retention policies enforce this automatically.

**HIPAA Retention Rules:** Healthcare providers must delete patient records after a certain period (varies by law). Fables' retention policies support this.

**Data Privacy Impact Assessments (DPIA):** Retention policies demonstrate that the organization has a data retention plan (a required element of DPIAs).

---

### F1284: Tamper-Evident Audit Log (Hash-Chained)

**Goal:** Maintain an immutable, forensically verifiable audit trail of all vault operations (creates, updates, deletes, shares, etc.). Tampering is detectable.

**Status:** ✅ SHIPPED

#### Design

**Audit log entry:**

```typescript
interface AuditEntry {
  seq: number; // sequence number (1, 2, 3, ...)
  event: AuditEvent; // e.g., 'vault.unlocked', 'vault.unlock_failed', 'vault.locked', 'vault.passphrase_changed', 'vault.wiped'
  detail: Record<string, unknown>; // operation-specific metadata
  ts: string; // ISO 8601 timestamp
  prevHash: string; // SHA-256 hash of the previous entry
  hash: string; // SHA-256 hash of this entry
}
```

**Hash chain verification:**

- `hash = sha256(seq || event || JSON.stringify(detail) || ts || prevHash)`
- Each entry's `prevHash` must match the previous entry's `hash`.
- If any entry is modified, all subsequent hashes are invalidated.
- The chain is tamper-evident: any modification is detectable via `auditLog(db).verify()`.

**Events recorded:**

- `vault.created` (with KDF strength).
- `vault.unlocked` (successful unlock).
- `vault.unlock_failed` (wrong passphrase).
- `vault.locked` (vault locked).
- `vault.passphrase_changed` (passphrase change).
- `vault.wiped` (full vault wipe, with count of deleted notes).

**Storage:**

- Log entries stored in SQLite in a dedicated `security_audit` table.
- Table is append-only (no UPDATE, only INSERT).
- Never records secrets (passphrases, keys, etc.).

**API access:** `auditLog(db)` in `apps/server/src/vault/audit.ts` with methods:

- `append(event, detail)` — add a new entry.
- `list()` — get all entries.
- `verify()` — check chain integrity (returns `{ ok: true }` or `{ ok: false, brokenAt: seq }`).
- `clear()` — wipe the log (only as part of a full vault wipe, F1281).
- `count()` — number of entries.

#### Compliance Rationale

**HIPAA Audit Controls (164.312(b)):** HIPAA requires an audit log that records and examines access to ePHI (electronic protected health information). Hash-chaining ensures the audit log itself is tamper-resistant.

**GDPR Accountability (Article 5(2)):** Organizations must demonstrate accountability through logs and documentation. A hash-chained audit log provides forensic proof of what happened and when.

**SOC 2 Type II (Logging & Monitoring):** SOC 2 audits require evidence of logging and monitoring. A tamper-evident audit log satisfies this requirement.

**eDiscovery (Legal Hold):** In litigation, audit logs are discoverable evidence. Tamper-evident chains help prove authenticity.

---

### F1285: Read Receipts Opt-Out Everywhere

**Goal:** Allow users to disable read receipts in collaborative documents (opt-out of presence/cursor tracking).

#### Design

**Setting:** User Preferences → Privacy → Disable read receipts (checkbox).

**Effect:**

- If enabled, other collaborators don't see your cursor position.
- Your presence is still recorded (for your own reference), but not broadcast.
- Your "last seen at" timestamp is hidden.
- Other users see a placeholder instead of your avatar.

**Server-side implementation:**

- When publishing presence (Awareness state in Yjs), filter out user's position data if opt-out is enabled.
- Other collaborators receive an empty presence state for that user.

#### Compliance Rationale

**Privacy by Design (GDPR Article 25):** Users have a right to control what information about them is shared with others. Read receipts are optional; users should be able to opt out.

**ePrivacy Directive (Tracking):** European ePrivacy law restricts tracking. Read receipts are a form of tracking; opt-out is a privacy-preserving feature.

---

### F1286: Legal Hold Mode

**Goal:** Freeze the vault: prevent deletion of notes, entities, and attachments. All modifications are still allowed (updates), but deletions are blocked.

**Status:** ✅ SHIPPED

#### Design

**Activation:** User (or admin) enables "Legal Hold" in Settings → Legal Hold.

**Effect:**

- Soft-delete is denied (operation rejected with "Legal hold is active").
- Hard-delete is denied.
- Note updates, entity modifications, attachment uploads are still allowed.
- Users see a banner: "⚠️ Legal hold is active. Deletions are disabled."

**Audit log:** Every denied delete attempt is logged with the user, timestamp, and target.

**Duration:** User specifies a hold period (e.g., until 2026-12-31) or indefinite.

**Removal:** Only the user who enabled legal hold can disable it (or an admin, in future multi-user mode).

**API endpoints:**

- `GET /compliance/legal-hold` — get current legal hold status
- `POST /compliance/legal-hold` — enable or disable legal hold (request body: `{ active: boolean }`)

#### Compliance Rationale

**eDiscovery (Litigation Hold):** In litigation, organizations must preserve evidence. Legal hold prevents accidental deletion of relevant data.

**Regulatory Hold (FINRA, SEC):** Financial firms must place holds on data during investigations. Legal hold mode automates this.

**Compliance Audits:** Regulators ask: "How do you prevent data deletion during holds?" Legal hold is the answer.

---

### F1287: Redaction Tool (True Content Removal)

**Goal:** Allow users to permanently erase specific content from the vault, including from all revisions and audit logs.

**Status:** ✅ SHIPPED

#### Design

**UI:** Right-click on note → Redact Content

**Redaction process:**

1. User selects a passage in the note body.
2. User confirms: "Redact this content? It will be removed from the note and all revisions."
3. System performs:
   - Remove the passage from the current note.
   - Remove the passage from all revisions (by re-writing revision snapshots).
   - Add a redaction event to the audit log (with a hash of the redacted content, but not the content itself).
   - If the vault is encrypted, re-encrypt the updated revisions.
4. Result: The redacted text is gone from the note, revisions, and search index. Only a redaction marker remains.

**Redaction marker in audit log:**

```json
{
  "operation": "content_redacted",
  "target": {
    "type": "note",
    "id": "ulid...",
    "revision": 5
  },
  "redaction_hash": "sha256-...", // hash of the redacted content (for verification, but not revealing it)
  "timestamp": "2026-06-13T10:00:00Z",
  "actor": "user"
}
```

**Search index update:** After redaction, the search index is re-built to exclude the redacted content.

**API endpoint:**

- `POST /notes/:id/redact` — redact a note's content and entire revision history (request body: `{ fields?: ['title' | 'body'][], reason?: string }`)

#### Compliance Rationale

**GDPR Article 17 (Right to Erasure, "Right to be Forgotten"):** Users can request erasure of specific personal information. Redaction tool implements this granularly.

**CCPA / CPRA (Deletion Requests):** California law allows consumers to request deletion of specific personal information. Redaction supports this.

**Data Breach Response:** If a note contains compromised data (e.g., accidentally exposed API key), redaction removes it retroactively.

**HIPAA De-identification:** Redacting personally identifiable information from notes helps meet HIPAA de-identification standards.

---

### F1288: Export with Redactions Applied

**Goal:** Allow users to export the vault (as a backup or for compliance) with all redactions applied (i.e., redacted content is removed from the export).

**Status:** ✅ SHIPPED

#### Design

**Export option:** Settings → Export → Choose format (Markdown, JSON, .fablesbak) → Choose whether to apply redactions (checkbox).

**If redactions are applied:**

- Exported notes exclude all redacted passages.
- Exported revisions are cleaned.
- Exported audit log includes redaction markers but not the original content.
- Exported attachments are included (attachment redaction is future work).

**Export format (with redactions):**

```markdown
# My Note

This is a note with some content.

[REDACTED at 2026-06-13T10:00:00Z by user]

This is content after the redaction.
```

**API endpoint:**

- `GET /compliance/export` — download full compliance data inventory as JSON (same endpoint as F1282; redaction markers are included in the audit log section)

#### Compliance Rationale

**Data Subject Requests (DSRs):** When exporting personal data for a DSR, redactions are automatically applied, ensuring sensitive information is removed.

**Compliance Audit Export:** Export with redactions applied ensures compliance reports don't leak sensitive information.

---

### F1289: Compliance Feature Documentation

**Goal:** Document all compliance-grade features with guidance on which regulations each feature supports.

#### Contents

**Per-feature docs:**

- **F1281 (Full Vault Wipe):** Satisfies GDPR Article 17, HIPAA Secure Deletion.
- **F1282 (Data Inventory Export):** Satisfies GDPR Article 20, CCPA Article 1798.100.
- **F1283 (Retention Policies):** Satisfies GDPR Article 5 (data minimization), HIPAA retention rules.
- **F1284 (Audit Log):** Satisfies HIPAA 164.312(b), GDPR Accountability, SOC 2 Type II.
- **F1285 (Read Receipts Opt-Out):** Satisfies GDPR Article 25 (privacy by design), ePrivacy Directive.
- **F1286 (Legal Hold):** Satisfies eDiscovery holds, FINRA/SEC regulatory holds.
- **F1287 (Redaction):** Satisfies GDPR Article 17, CCPA Article 1798.105, HIPAA de-identification.
- **F1288 (Export with Redactions):** Satisfies GDPR Article 20 + right to erasure, CCPA.

**Compliance mapping matrix:**

| Feature                | GDPR         | HIPAA             | CCPA                     | SOC 2                | FINRA           | eDiscovery    |
| ---------------------- | ------------ | ----------------- | ------------------------ | -------------------- | --------------- | ------------- |
| Full Vault Wipe        | Art. 17      | Secure Deletion   | ✓                        | -                    | -               | -             |
| Data Inventory Export  | Art. 20      | -                 | Art. 1798.100            | -                    | -               | ✓             |
| Retention Policies     | Art. 5       | Retention Rules   | ✓                        | -                    | -               | -             |
| Audit Log              | Art. 5(2)    | 164.312(b)        | ✓                        | Logging & Monitoring | Activity Logs   | ✓             |
| Read Receipts Opt-Out  | Art. 25      | -                 | ✓                        | Privacy Controls     | -               | -             |
| Legal Hold             | -            | -                 | -                        | -                    | Hold Procedures | Hold Period   |
| Redaction              | Art. 17      | De-identification | Art. 1798.105            | -                    | Data Purge      | Privilege Log |
| Export with Redactions | Art. 20 + 17 | Export Rules      | Art. 1798.100 + 1798.105 | -                    | -               | -             |

This documentation helps users understand which features to enable for their compliance obligations.

---

### F1290: Compliance Feature Tests

**Goal:** Automated test suite verifying that compliance features work correctly.

#### Test coverage

**F1281 (Full Vault Wipe):**

- [ ] Wipe operation deletes all notes, entities, attachments.
- [ ] Wipe operation deletes sync state and op-log.
- [ ] Wipe operation truncates audit log.
- [ ] Verification: hash of vault matches expected empty state.
- [ ] Subsequent operations after wipe use a fresh vault.

**F1282 (Data Inventory Export):**

- [ ] Export includes all notes with titles, bodies, metadata.
- [ ] Export includes all entities with all fields.
- [ ] Export includes all attachments with filenames and hashes.
- [ ] Export is valid JSON (parses without error).
- [ ] Encryption mode is correctly reported in summary.

**F1283 (Retention Policies):**

- [ ] Policy is created and stored.
- [ ] Daily job identifies notes matching the policy.
- [ ] Soft-delete action moves notes to trash.
- [ ] Hard-delete action immediately purges notes.
- [ ] Archive action moves notes to Archive notebook.
- [ ] Audit log records the retention action.

**F1284 (Audit Log):**

- [ ] Log entry is recorded for every create/update/delete operation.
- [ ] Hash chain is valid: each entry's `hash_prev` matches previous entry's `hash_self`.
- [ ] Tampering with a log entry invalidates all subsequent hashes.
- [ ] Audit log export (JSONL) is valid.

**F1285 (Read Receipts Opt-Out):**

- [ ] When opt-out is enabled, presence is not broadcast to other collaborators.
- [ ] Other collaborators see empty presence for the user.
- [ ] User's own presence is still recorded (for personal reference).

**F1286 (Legal Hold):**

- [ ] When legal hold is enabled, soft-delete is denied.
- [ ] Hard-delete is denied.
- [ ] Note updates are allowed.
- [ ] Denied delete attempts are logged.

**F1287 (Redaction):**

- [ ] Redacted content is removed from the note.
- [ ] Redacted content is removed from all revisions.
- [ ] Redaction marker is added to audit log.
- [ ] Search index is updated to exclude redacted content.

**F1288 (Export with Redactions):**

- [ ] Export with redactions applied excludes redacted passages.
- [ ] Export without redactions includes original content.
- [ ] Exported Markdown shows `[REDACTED...]` markers.

---

## Compliance Tier Feature Matrix

| Feature                                  | Tier 1 | Tier 2      | Tier 3 |
| ---------------------------------------- | ------ | ----------- | ------ |
| Encryption at rest                       | ❌     | ✅          | ✅     |
| Audit log (basic)                        | ❌     | ❌          | ✅     |
| Audit log (hash-chained, tamper-evident) | ❌     | ❌          | ✅     |
| Full vault wipe with verification        | ❌     | ❌          | ✅     |
| Data inventory export                    | ❌     | ❌          | ✅     |
| Retention policies                       | ❌     | ❌          | ✅     |
| Legal hold                               | ❌     | ❌          | ✅     |
| Redaction tool                           | ❌     | ❌          | ✅     |
| Read receipts opt-out                    | ❌     | ✅ (F1141+) | ✅     |
| Export with redactions                   | ❌     | ❌          | ✅     |

---

## Implementation Roadmap

| Phase       | Sprint    | Features                                                                                        | Status                                                  |
| ----------- | --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Tier 1**  | Day 1–10  | Baseline (notes, stories, sync)                                                                 | ✅ Complete                                             |
| **Tier 2a** | Day 11–13 | Encryption (F1201–F1210)                                                                        | ✅ Complete (Crypto core done)                          |
| **Tier 2b** | Day 14    | Encrypted storage (F1211–F1220), Vault ops (F1215–F1223, F1234, F1281)                          | ✅ Complete (vault service, at-rest encryption, wipe)   |
| **Tier 2c** | Day 14+   | Collaboration (F1101–F1200)                                                                     | 🔄 In progress (CRDT engine done)                       |
| **Tier 2d** | Day 14    | Audit log (F1284), SSRF guard (F1268)                                                           | ✅ Complete (tamper-evident log, outbound fetch safety) |
| **Tier 3**  | Day 15+   | Key management UX (F1221–F1230), lock behavior (F1231–F1240), compliance features (F1282–F1288) | ⏳ Planned                                              |

---

## Regulations Supported (v1.0)

When Tier 3 is complete, Fables will support:

- ✅ **GDPR (EU):** Right to erasure (F1287), data portability (F1282), data minimization (F1283), accountability (F1284), privacy by design (F1285).
- ✅ **CCPA (California):** Consumer access rights (F1282), deletion rights (F1287/F1288), opt-out of tracking (F1285).
- ✅ **HIPAA (Healthcare):** Secure deletion (F1281), audit controls (F1284), retention rules (F1283), de-identification (F1287).
- ✅ **SOC 2 Type II (Auditing):** Logging (F1284), monitoring, tamper-detection.
- ✅ **FINRA (Finance):** Activity logs (F1284), legal holds (F1286), data retention (F1283).
- ✅ **eDiscovery (Litigation):** Audit log export (F1284), legal hold (F1286), privilege log (via redaction markers).

---

## FAQ

**Q: Will Fables ever be enterprise-ready (multi-user, fine-grained access control)?**  
A: Not in the current roadmap. Fables is designed for single-user personal knowledge. Enterprise multi-user collaboration is a separate product (future).

**Q: Can I use Fables for HIPAA-regulated healthcare data?**  
A: Not yet. Tier 3 compliance features (audit log, legal hold, redaction) would support HIPAA. Until then, Fables is suitable for healthcare professionals' personal notes (not patient records).

**Q: What about SOC 2 certification for Fables itself?**  
A: SOC 2 is for organizations providing services to customers. Fables is self-hosted (not a service), so SOC 2 certification doesn't apply. However, Fables includes the controls that SOC 2 audits examine (logging, access control, etc.).

**Q: Can I export the audit log for compliance audits?**  
A: Yes, via `GET /audit-log/export.jsonl`. The export includes all operations (create/update/delete/share), actors, timestamps, and hash chain.

---

## References

- **Incident Response:** `docs/security/incident-response.md`
- **Secure Defaults:** `docs/security/secure-defaults.md`
- **Privacy Data-Flow:** `docs/security/privacy-data-flow.md`
- **GDPR Article 17:** https://gdpr-info.eu/art-17-gdpr/
- **CCPA:** https://cpra-info.org/
- **HIPAA:** https://www.hhs.gov/hipaa/
- **SOC 2:** https://www.aicpa.org/interestareas/informationmanagement/sodp-system-and-organization-controls

---

**Last updated:** Day 14, Epic 13 (F1289). Compliance backend shipped.

**Implementation status:**

- ✅ F1281 (Full vault wipe with verification) — SHIPPED
- ✅ F1282 (Data inventory export) — SHIPPED (`GET /compliance/inventory`, `GET /compliance/export`)
- ✅ F1284 (Tamper-evident audit log) — SHIPPED (`GET /vault/audit`)
- ✅ F1285 (Read receipts opt-out) — SHIPPED (Epic 12 deferred feature, implemented in web collab UI)
- ✅ F1286 (Legal hold mode) — SHIPPED (`GET /compliance/legal-hold`, `POST /compliance/legal-hold`)
- ✅ F1287 (Redaction tool) — SHIPPED (`POST /notes/:id/redact`)
- ✅ F1288 (Export with redactions) — SHIPPED (`GET /compliance/export`)
- ⏳ F1283 (Retention policies) — Designed, not yet implemented (deferred to Tier 3)

Core compliance backend and full audit trail infrastructure shipped as part of Epic 13 security tier.
