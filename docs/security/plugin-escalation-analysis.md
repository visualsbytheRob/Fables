# Plugin Permission-Escalation Analysis & Self-Audit (F1273, F1274)

A review of whether a malicious or compromised plugin can do more than its
declared permissions allow, plus the self-audit checklist run that produced (and
fixed) the findings below.

## The plugin permission model

- Plugins run in a **sandboxed `worker_threads` worker** (`sandbox.ts`), isolated
  from the host process; they reach the app only through an explicit RPC
  capability channel.
- Every capability call is **gated against the plugin's declared permissions**
  before dispatch (`sandbox.ts → checkPermission`). The capability→permission map
  is explicit:

  | capability                                               | required permission |
  | -------------------------------------------------------- | ------------------- |
  | `notes.query` / `notes.get` / `notes.tags` / `tags.list` | `notes:read`        |
  | `notes.create` / `notes.update`                          | `notes:write`       |
  | `search.extend`                                          | `search:extend`     |
  | `storage.{get,set,delete}`                               | `storage`           |
  | `event.{subscribe,unsubscribe}`                          | `notes:watch`       |
  | `vm.registerFunction` / `vm.registerEffect`              | `stories:execute`   |
  | `vm.readState`                                           | `stories:read`      |
  | `http.fetch`                                             | `network`           |

- **Fail-closed:** an unknown capability (one not in the map) is denied, so adding
  a host capability without a permission rule cannot accidentally expose it.
- **Rate-limited:** read/write capability calls are capped per minute
  (`capability-handler.ts`), bounding abuse from a granted-but-hostile plugin.
- **Install-time review:** plugin distribution is https-only, and an upgrade that
  requests new permissions surfaces a warning diff (`distribution.ts`).

## Escalation paths examined

1. **Calling a capability without the permission** → blocked by `checkPermission`.
2. **Calling an unmapped/host-internal capability** → denied (fail-closed).
3. **Reaching the host filesystem or process** → not exposed; no `fs`/`process`
   capability exists, and the worker is isolated.
4. **Network SSRF via `http.fetch`** → **FINDING (fixed below).**
5. **Reading encrypted/secret content** → the capability handler reads through the
   ordinary notes repo; secret/encrypted note content is not handed to plugins
   (F1249), and there is no `vault`/key capability.
6. **Escaping the sandbox** → the worker boundary + RPC-only surface; no `eval`
   of host code from plugin input on the host side.

## Findings & fixes

### F1: SSRF through the plugin network capability — FIXED

`http.fetch` previously called raw `fetch(url)`, so a plugin holding the
`network` permission could reach `http://169.254.169.254/` (cloud metadata),
loopback, or other internal addresses — an escalation beyond "make outbound web
requests." **Fixed:** `http.fetch` now routes through the same `safeFetch`/SSRF
guard as the clipper (scheme allow-list + DNS-resolved private/reserved/metadata
blocking). Regression-tested in `capability-ssrf.test.ts`.

### Observations (no action required)

- The permission gate is correctly applied **before** dispatch, not after.
- Rate limits are per-plugin-per-minute and fail-closed at the cap.
- The capability map is the single source of truth; keep new host capabilities
  out of the handler until a permission rule exists for them.

## Self-audit checklist (run)

- ✅ Capability gate enforced before every dispatch
- ✅ Unknown/unmapped capabilities denied (fail-closed)
- ✅ No filesystem/process/key capability exposed to plugins
- ✅ Network capability SSRF-guarded (fixed this pass)
- ✅ Read/write rate limiting in place
- ✅ Install/upgrade permission diff surfaced; https-only distribution
- ✅ Secret/encrypted content not exposed to plugins (F1249)

## Residual risk

A plugin granted broad permissions (e.g. `notes:read` + `notes:write` + `network`)
is, by design, trusted with that data — the model limits _escalation beyond
granted scope_, not the consequences of granting scope. Users should review the
permission list before installing, which the distribution flow surfaces.
