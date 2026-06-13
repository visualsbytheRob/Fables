# Sharing & Permissions in Fables

This guide covers how sharing works in Fables collaboration. It explains how to grant access to notes, notebooks, and stories; the permission levels; and how sharing stays private within your Tailscale network.

For an overview of real-time collaboration, see [Concepts](./concepts.md).

---

## Overview

Sharing in Fables is **per-document, opt-in, and Tailnet-scoped**:

- **Per-document:** you decide which note, notebook, or story to share.
- **Opt-in:** sharing is off by default; you enable it explicitly.
- **Tailnet-scoped:** share links work only on your Tailscale network. Peers authenticate as trusted Tailnet members or via scoped guest tokens.

When you share a document, collaborators can view (read-only or edit) and see live updates in real time. All access is audited and can be revoked immediately.

---

## Share Links

To invite someone to collaborate, you generate a **share link** from the share menu on a note, notebook, or story.

### Creating a Share Link

1. Open the document you want to share.
2. Tap the share icon (or ⌘⇧S).
3. Select **Create Share Link**.
4. Choose:
   - **Permission level:** Read-only or Edit.
   - **Expiry:** 7 days, 30 days, or Never.
   - **Guest identity:** They log in as a named guest, or anonymously.
5. Copy the link and share it (via Signal, email, etc.).

Example link:
```
https://mymachine.mytailnet.ts.net/collab?share=TOKEN&doc=NOTE_ID
```

The token encodes:
- Which document (note, notebook, or story ID).
- Permission level (read-only or edit).
- Expiry time (in the token itself, not stored on the server).
- HMAC signature (prevents tampering).

### How They Open It

1. They receive your share link.
2. They open it in their browser.
3. If they're on your Tailnet, they authenticate automatically.
4. If they're a guest, they enter a name and see a color assigned to them.
5. They land in the document with live sync active.

---

## Permission Levels

### Read-Only

Collaborators can:
- See the document and all edits in real time.
- Leave comments and suggestions.
- Export or print.

They cannot:
- Edit the document directly.
- Delete content.
- Change permissions.

### Edit

Collaborators can:
- Edit the document fully (same as the owner).
- Make or reject suggestions from others.
- Change the document title, tags, and metadata (for notes).

They cannot:
- Change sharing permissions or revoke access.
- Delete the document.
- Change who is allowed to access it.

**In Tier 2:** permissions are enforced at the server level. Invalid or expired tokens are rejected on write.

---

## Link Expiry & Revocation

### Expiry

When you create a share link, you set an expiry time:
- **7 days:** useful for time-limited collaboration (review cycle).
- **30 days:** longer-term projects.
- **Never:** permanent access (rarely used; consider revoking instead).

After expiry, the token no longer works. Collaborators trying to open the link see an expired message.

### Revocation

You can revoke a link anytime without deleting it:

1. Open the document's Share panel.
2. Find the share link in the list.
3. Tap **Revoke** (or change expiry to "Just now").
4. The link is immediately invalid.

Collaborators already in the document stay connected until they close their tab. If they refresh, they're kicked out.

---

## Guest Identity

When a guest (someone not on your Tailnet) opens a share link, they enter a name:

- **Name:** used in presence indicators and comments (e.g., "Alice").
- **Color:** auto-assigned (used for cursor colors, comment highlights).

This identity is valid only for that session. If they close and reopen the link, they pick a new name.

**Tier 2 note:** guest identity is local to the share session and is not persistent across devices.

---

## Who Has Access

The **Access** panel on a shared document shows:

- List of all share links (active, expired, revoked).
- For each link:
  - Permission level (read/edit).
  - Expiry time (countdown or "Never").
  - Created by, created at.
  - Guest name (if a guest is currently using it).

---

## Access Audit Log

Every access event is logged:

- Who opened the document (device name or guest name).
- When they joined and left.
- Every edit they made (timestamp, character range, content).
- Every comment/suggestion.

Access the audit log from the **Info** panel:

1. Open the document.
2. Tap **Info** (ℹ) in the top bar.
3. Scroll to **Access Log**.
4. View by date or filter by person.

This log is local to your database and is never synced to collaborators (only the document content is synced).

---

## Shared Notebooks

When you share a notebook, collaborators access it as a folder:

- They can view and edit all notes inside.
- They see the notebook tree and can reorganize it (via CRDT).
- New notes created in the shared notebook are also shared.

If a note inside the notebook has a **different** share link (more restrictive), that note's permission takes precedence. For example:

- You share a notebook with edit access.
- But note X inside it has a read-only link.
- Collaborators using the notebook link get edit access to other notes, but read-only on note X.

---

## Collaborative Stories

Sharing a story works like sharing a note, but applies to the entire story project:

- All `.fable` files are shared.
- Both authors can edit the source simultaneously (CRDT handles conflicts).
- Compilation runs once per burst of edits.
- Both see live diagnostics.

Read-only access on a story allows:
- Reading the author-side source (no editing).
- Playing the story (if it's compiled).
- Leaving comments on knots in the editor.

---

## Privacy & Tailnet Model

All sharing happens **over your Tailscale network**. Key points:

- **No cloud service:** your data never leaves your machine or your Tailnet. Fables doesn't have a central server; you are the server.
- **Encrypted in transit:** Tailscale encrypts all traffic by default.
- **Encrypted between machines:** if you set up encrypted vault mode (Tier 2), document content is encrypted; the server can never read it.
- **Peers are invited members:** anyone with a share link is someone you've invited to your Tailnet or given a scoped guest token. Unlike Dropbox or Google Docs, you're not sharing with a public cloud service.
- **No analytics or logging external to your machine:** Fables never sends access data or usage stats to anyone.

Example scenario: you're writing a story with a friend on your home WiFi. You generate a share link (edit, 7 days). They open it from their laptop. You both see each other's cursors. Changes sync in real time. When the week is up, the link expires and stops working. Your data never left your home network.

---

## Shared-With-Me View

In the sidebar, a **Shared With Me** section lists:

- Notebooks others have shared with you.
- Notes shared directly.
- Stories you're collaborating on.

Each entry shows:
- Who shared it and when.
- Permission level.
- Last activity timestamp.

You can accept or decline shared access (if it's a per-user grant) or simply close the tab to stop collaborating.

---

## Known Limitations (Tier 2)

As of now:

- **Sharing is document-level, not field-level.** You can't share "only the health field" of an entity. You share the whole note.
- **Permission revocation is immediate for new edits, not retroactive.** If someone had edit access and wrote 100 words, revoking their access doesn't delete those words. Their contributions stay (but they can't add more).
- **Guest identity is session-local.** Guests don't have persistent profiles across devices.
- **Comments are thread-local.** If you resolve a comment and then the collaborator edits nearby, the comment context may shift.
- **Share links don't support granular per-field permissions or role-based access control.** Future versions may add user accounts and group-based sharing.

---

## Shipping in Tier 2

Sharing and permissions are part of Epic 12 (F1141–F1150) and are shipping in the real-time collaboration release. APIs and UI are still being finalized, but the core model is stable:

- `document.share({ permission, expiry, guestIdentity })` — create a share link.
- `share.revoke()` — revoke a link.
- Access logs are queryable and audited.

See [Concepts: Sharing](./concepts.md#sharing-scoped-access--permissions) for the complete technical overview.

---

## Cross-links

- **[Collaboration Concepts](./concepts.md)** — the full design including CRDTs, the op-log bridge, and architecture.
- **[Architecture](../architecture.md)** — how sharing integrates with sync and the database.
- **[Tailscale Setup](../tailscale.md)** — network configuration for sharing over Tailnet.
- **[Privacy & Security](../security.md)** — how sharing respects your privacy model.

---

**Sharing in Fables keeps your collaborative data private while enabling real-time teamwork. Everything stays on your network, under your control.**
