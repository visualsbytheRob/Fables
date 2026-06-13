# Fables Real-Time Collaboration — Conceptual Overview

This document describes real-time collaboration in Fables at a conceptual level for curious users and contributors. It covers what collaboration is, how CRDTs enable conflict-free editing, the sharing model over Tailscale, presence and awareness, comments and suggestions, and how this all fits Fables' local-first privacy promise.

**Status:** This is the design for Epic 12 (F1101–F1200). Real-time collaboration is shipping in Tier 2. APIs are still stabilizing — this describes the intended architecture, not final function signatures.

---

## What Is Collaboration in Fables?

**Fables is single-user by default.** Everything you build lives on your machine. But collaboration is **opt-in per document**: you can invite trusted people on your Tailscale network to co-edit a note, notebook, or story with you in real time.

When you enable collaboration on a document:

- **Multiple people can edit simultaneously** without conflicts merging or losing changes.
- **Live cursors and presence** show who's viewing/editing and where their cursor is.
- **Comments and suggestions** let reviewers annotate changes without editing directly.
- **Full edit history with attribution** shows who wrote what, when.
- **All peers stay in sync** — changes propagate within ~100ms.
- **Everything is private by default** — peers connect over your Tailscale network, not a cloud service.

Collaboration does not require the internet. If your Tailnet is local-only (home network, office), that's fine. Peers synchronize over your private network.

---

## The Privacy & Local-First Model

Fables keeps your data on your machine. Collaboration extends this privacy model:

- **You host the server.** The canonical state lives in your SQLite database, on your machine.
- **Peers connect via Tailscale.** They authenticate as trusted Tailnet members (or via scoped share links you generate).
- **No cloud backend.** No third-party service holds your data, ever.
- **Shared documents stored locally.** When you share a note with a collaborator, they get a copy. Edits merge via CRDT.
- **Graceful degradation.** If your server is unreachable, peers continue editing locally; changes sync when you're back online.

Example scenario: you're writing a story with a friend on the same home WiFi. You send them a Tailscale share link. They open the story in their browser. Both of you edit simultaneously. Changes propagate in real time. When one of you goes offline, edits queue locally and sync when reconnected. Your data never leaves your network.

---

## CRDTs: Conflict-Free Editing

The heart of collaboration is **CRDT** — a Conflict-free Replicated Data Type. Fables uses **Yjs**, a popular CRDT library that lets multiple people edit the same text or structured data without conflicts.

### How Traditional Sync Fails

Imagine two people editing a note body simultaneously:

```
Original: "The fox jumps over the lazy dog."

User A deletes "lazy"       → "The fox jumps over the dog."
User B inserts "red " before "fox" → "The fox jumps over the red dog."

Without CRDT:
- If A's edit applies first, then B's: "The fox jumps over the dog." (B's insertion is lost or misplaced)
- This is a **conflict**. Someone's work vanishes.
```

### How CRDTs Solve It

Yjs assigns a **unique ID** to every character position in the document. When you type or delete, you're operating on these IDs, not character positions.

```
Original: {C1:T} {C2:h} {C3:e} ... {C20:l} {C21:a} {C22:z} {C23:y} ...

User A: Delete C20 (l), C21 (a), C22 (z), C23 (y)
        → Marks those characters as tombstones
User B: Insert {C24:r}, {C25:e}, {C26:d}, {C27: } before C2
        → New insertions get their own IDs

When both edits apply (in any order):
- A's deletions remove the tombstones
- B's insertions add new characters
- Result: "The red fox jumps over the dog." ✓ No conflict!
```

All changes **commute** — the order doesn't matter. A then B gives the same result as B then A.

### Yjs in Fables

Fables uses **Y.Text** to wrap note bodies. Instead of storing plain markdown, collaborative notes store a CRDT text structure:

- Each character/block has a unique identity.
- Markdown syntax is preserved (we don't parse to AST; we edit at the character level).
- Offline edits merge seamlessly on reconnect.
- Remote edits appear in real time (< 100ms latency).
- The entire document history is preserved; you can revert to any point.

---

## The Op-Log Bridge

Fables has two sync systems:

1. **Op-log (Tier 1):** every mutation to notes, entities, stories is an immutable operation with a Lamport clock. This handles single-user and multi-device sync.
2. **CRDT (Tier 2):** for collaborative editing of note bodies and structure, Yjs provides conflict-free updates.

They coexist:

- **Non-collaborative data** (note metadata, tags, created date) → op-log. Last-writer-wins.
- **Collaborative data** (note body, shared entity fields) → CRDT. Conflict-free.

The **bridge** translates:

- When a collaborator edits a note body via WebSocket, the CRDT update lands in Yjs.
- That update is encoded as an op-log operation and persisted to the database.
- Other collaborators' clients decode it and apply it to their local Yjs state.
- Non-collaborators still see the note through op-log sync (eventual consistency).

This design keeps Tier 1 untouched while adding collaborative capabilities on top.

---

## WebSocket Rooms & Sync Server

Collaboration happens over **WebSocket** in **rooms**. One room per shared document.

### Room Lifecycle

1. **Creation:** First time someone views a shared note, a room is created on the server.
2. **Members:** Other collaborators connect to the same room.
3. **Updates:** Every keystroke, deletion, or structural change is broadcast to all members.
4. **Persistence:** Updates are batched and flushed to the database.
5. **Idle Timeout:** If a room is inactive (no members, no updates) for N minutes, it closes.

### Update Flow

```
Alice types in her editor
  ↓
Yjs generates a local update
  ↓
WebSocket sends update to server (room)
  ↓
Server broadcasts to all connected members (Bob, Carol)
  ↓
Bob's and Carol's Yjs instances apply the update (same state converges)
  ↓
Updates are persisted to database (op-log)
  ↓
Clients pull op-log to stay in sync with the server state
```

**Backpressure:** if updates arrive faster than the server can process, they queue. Clients respect flow control to avoid overwhelming the server.

**Reconnection:** if Alice's connection drops, she can reconnect. The server sends her a **state vector** (summary of updates she's missing) so she can catch up without re-syncing the entire document.

---

## Presence & Awareness

Collaboration isn't just about merging edits. It's about knowing **who's here**.

### Live Cursors & Selection

When Alice is editing, Bob sees:
- A colored cursor at Alice's position (updates as she types).
- A highlight of her selection (if she's selected text).
- Her user name or avatar above the cursor.

This is handled by a **Yjs Awareness protocol** — a lightweight side-channel that broadcasts "I'm here, my cursor is at position X, I'm typing" 60 times a second.

### Presence Sidebar

At the vault level (not per-document), a sidebar panel shows:
- "Who's in the vault right now?"
- Avatar stacks on documents (showing all active editors).
- "Idle for 5 min" / "Away" status.

### Follow Mode

In author mode (story editing), you can "follow" a collaborator — your view jumps to where they're editing. Useful for pair-authoring or teaching.

### Privacy Toggle

Users can hide their presence. If you don't want others to see your cursor, toggle "Presence: OFF" in settings. You'll still see theirs (asymmetric awareness).

---

## Sharing: Scoped Access & Permissions

To invite someone to collaborate:

### 1. Generate a Share Link

You choose:
- **Document:** which note, notebook, or story.
- **Permission level:** read-only or edit.
- **Duration:** expires after 7 days, 30 days, never.
- **Guest identity:** do they log in with a name, or anonymously?

The app generates a **scoped share token** encoded into a Tailscale link:

```
https://mymachine.mytailnet.ts.net/collab?share=TOKEN&doc=NOTE_ID
```

The token includes:
- Which document (note ID).
- Permission level (read/edit).
- Expiry time (encoded, not stored on server).
- HMAC signature (prevents tampering).

### 2. Share the Link

You send the link (via Signal, email, whatever). They open it.

### 3. They Join

If they're already on your Tailnet, they authenticate automatically (Tailscale identity). If not, they enter a guest name and color.

### 4. Permissions Enforced

- **Read-only:** they can see all edits in real time, but cannot type. Comments and suggestions are allowed.
- **Edit:** they can edit the document fully.

The server checks the token on every write. Invalid or expired tokens → writes rejected.

### 5. Revoke Anytime

You can revoke a link's expiry immediately (making it invalid). Or wait for it to expire.

---

## Comments & Suggestions

Collaboration isn't just live editing. Reviewers can annotate without touching the text.

### Anchored Comments

You select a range of text and leave a comment:

```
"The fox jumps over the lazy dog."
               ↑ comment: "Is the fox really lazy here? Should be brave?"
```

The comment is **anchored** to those specific characters. If the text shifts (someone edits nearby), the anchor adjusts. If the text is deleted, the comment becomes "stale" (you can still read it, but it's orphaned).

Comments have:
- Author, timestamp.
- Threaded replies.
- Resolved/unresolved state.
- Emoji reactions.

### Suggestion Mode

Instead of editing directly, you can enter **suggestion mode**. Any text you type or delete is marked as a suggestion (strikethrough for deletions, underline for insertions). The document owner can accept/reject suggestions one by one.

---

## Edit History & Attribution

Because CRDT tracks every character's insertion and deletion, Fables can show:

### Per-Character Attribution

Hover over any word in a shared document: "This was written by Alice at 2:30 PM on June 10."

### Version Snapshots

Named checkpoints: "Story Draft v3" captures the document state at a moment. Later you can compare two versions, revert to one, or view the diff.

### Time-Slider Playback

Scrub through the document's history in real time. Watch the text appear and disappear as you slide backward and forward through time.

### Forensic Recovery

If a document is corrupted or accidentally deleted, a forensic tool can extract content from the CRDT update log.

---

## Collaborative Stories

Sharing a story is like sharing a note, but with extra coordination:

### Shared Editing

Both authors edit the `.fable` source in real time. Yjs handles character-level conflicts.

### Shared Compilation

Compilation is single-threaded: when there's a burst of edits, the compiler waits a moment, then runs once. Both authors see live diagnostics in their editors.

### Shared Playtesting

Enter "playtest mode" with collaborators. You're all in the same story playthrough:
- One person makes choices.
- All see the output in real time.
- Can switch control between players.

### Vote-on-Choice Mode

Multiple players vote on the next choice. Majority wins. (Fun for group reading sessions.)

### Spectator Mode

Invite someone to watch a playtest without editing the story. They see all choices and output but can't make decisions.

### Session Recording

The entire playtest is recorded to a transcript (with all participants listed). Useful for playtesting feedback loops.

---

## Conflict-Free Structures

Beyond note bodies, collaboration extends to structured data:

### Entity Fields

Entity fields (character health, location, etc.) are CRDT maps. Multiple people can edit different fields concurrently:

```
Alice: hero.health = 80
Bob:   hero.location = "forest"
→ Both changes converge instantly, no conflict.
```

If both edit the same field, last-writer-wins (with timestamp to break ties).

### Notebook Tree

The notebook hierarchy is a CRDT. Multiple people can reorganize folders, move notes, rename notebooks concurrently. Moves never create cycles or lost nodes.

### Tags

Tag operations are commutative. Adding/removing tags from a note works with CRDT semantics. Concurrent adds converge; concurrent add/remove = remove wins (delete takes precedence).

### Canvas Objects

If you're using canvas mode (spatial view of notes), objects' positions are CRDT-backed. Multiple people can drag cards around; positions merge.

---

## Offline & Resilience

Collaboration gracefully handles network issues:

### Offline Edits

Your editor is offline-first. If your connection drops, you keep typing. Changes queue locally.

### Reconnection

When you reconnect:
1. The app requests the server's state vector.
2. Server sends only the updates you're missing.
3. Your offline edits and server edits merge via CRDT.
4. No data loss; full convergence.

### Server Unreachable

If the server is down (your machine's network went out), you edit locally for as long as you want. When the server is reachable again, sync catches up.

### Bandwidth-Efficient

CRDT updates are tiny (often < 100 bytes per keystroke). On mobile, this is a fraction of a regular op-log sync.

---

## Mental Model

Think of collaboration in Fables like **Google Docs, but on your machine**:

- **Single source of truth:** your machine's database.
- **Peers are invited guests:** they connect via Tailscale, not a cloud.
- **No locks:** everyone edits simultaneously; changes merge.
- **History preserved:** every edit is logged with attribution.
- **Offline-first:** edits work even if peers go away.
- **Comments & suggestions:** non-destructive collaboration.

The key difference: **you own the server.** There's no Google, no Dropbox, no startup holding your collaborative data. Just you and your trusted network.

---

## Example Workflows

### Pair Writing a Story

1. You and a friend are co-authoring a story.
2. You generate a share link (edit permission, 7 days).
3. They open the link from their machine on your Tailnet.
4. You both edit the `.fable` file in real-time.
5. You compile; diagnostics appear in both editors.
6. You playtested together (vote-on-choice mode).
7. You save a named version "v1 Draft".
8. They suggest a rewrite on chapter 2 (suggestion mode).
9. You review their suggestions, accept some, reject others.
10. They see the changes in real-time.

### Collaborative Research Note

1. You create a research notebook and enable collaboration.
2. Two colleagues have edit access.
3. All three of you add notes simultaneously (no conflicts, CRDT merges).
4. You each leave comments on each other's notes.
5. One person creates a summary note, transcluding the others'.
6. When someone goes offline, their edits queue. On reconnect, everything syncs.

### Group Playtesting

1. You host a story.
2. Five friends join a shared playtest session.
3. You rotate who makes choices (or vote).
4. You discuss in a chat sidebar.
5. The session is recorded.
6. You export a transcript with timestamps and participant names.

---

## Shipping in Tier 2

Real-time collaboration ships in Epic 12 (F1101–F1200):

- **CRDT core** (Yjs integration, op-log bridge, offline merging).
- **Collaborative editor** (CodeMirror + Yjs binding, live cursors, presence).
- **Sync server** (WebSocket rooms, update broadcasting, persistence).
- **Presence & awareness** (avatars, follow mode, idle detection).
- **Sharing & invites** (scoped tokens, permission levels, expiry).
- **Collaborative stories** (shared editing, shared playtesting, recordings).
- **Comments & suggestions** (anchored annotations, suggestion mode, threads).
- **Edit history** (per-character attribution, version snapshots, time-slider).
- **Conflict-free structures** (CRDT maps for entities, tags, notebooks, canvas).
- **Hardening** (three-device chaos tests, security review, performance tuning).

The APIs are stabilizing during implementation. Expect:

- `document.enableCollaboration(docId)` — opt-in collab for a note/story.
- `collab.createShareLink(docId, permission, expiry)` — generate a share token.
- `awareness.set({ cursor, selection })` — publish your presence.
- `doc.on("remote-update", ...)` — listen for peers' edits.
- `comment.create({ range, text })` — leave a comment.

---

## Further Reading

- **[Architecture](../architecture.md)** — understand the op-log foundation.
- **[Security & Privacy](../security.md)** — how collaboration respects your privacy.
- **[Tailscale Integration](../tailscale.md)** — network setup for sharing.
- **[Troubleshooting](../troubleshooting.md)** — debug sync and collaboration issues.

---

**Collaboration in Fables keeps your data private while enabling powerful, real-time teamwork. Whether you're writing with a friend or researching with colleagues, changes merge seamlessly without leaving your network.**
