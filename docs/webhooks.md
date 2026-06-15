# Webhooks & Integrations

Fables talks to the rest of your world over plain HTTP — outbound when something
changes, inbound when you want to capture from anywhere. Everything is built for
a local/tailnet deployment: targets are your own machines, and every payload can
be signed.

## Outbound webhooks (F1931)

Register a subscription with a URL and an event filter (`*` for everything):

```
POST /api/v1/webhooks/subscriptions
{ "name": "CI", "url": "https://nas.tailnet/hook", "event": "note.created" }
```

Known events: `note.created`, `note.updated`, `note.deleted`, `note.tagged`,
`note.untagged`, `notebook.created`, `notebook.updated`, `notebook.deleted`,
`custom`. When an event is emitted (`POST /webhooks/emit`), a delivery is queued
for every enabled, matching subscription.

### Payload templates (F1933)

A subscription may carry a body template rendered with `{{ dotted.path }}` and
`{{json key}}` from the event context (`event`, `noteId`, `notebookId`,
`timestamp`, `data`). Without a template the body is the default JSON envelope.

### Signing (F1938)

Set a `secret` on a subscription and each delivery is signed with HMAC-SHA256;
the signature ships as `X-Fables-Signature: sha256=<hex>`. Receivers verify with
the same secret — this is how you prove a request really came from your vault.

### Retries & dead-letter (F1934)

Deliveries record their outcome. A `2xx` is `ok`; `408`/`429`/`5xx` retry with
deterministic exponential backoff; other `4xx` are dead immediately. Once
attempts are exhausted the delivery is **dead-lettered** and surfaced at
`GET /webhooks/dead-letter` for inspection and replay.

## Inbound capture (F1932)

Create a token-authenticated endpoint that drops new notes into a notebook:

```
POST /api/v1/webhooks/inbound
{ "name": "iOS Shortcut", "notebookId": "nb_..." }
→ { "token": "…" }
```

Then capture from anywhere:

```
POST /api/v1/webhooks/inbound/<token>/capture
{ "title": "Idea", "body": "captured from my phone" }
```

The token is checked in constant time. A bad or disabled token is rejected
without revealing whether the endpoint exists.

### iOS Shortcuts recipe (F1935)

1. **Shortcuts → New Shortcut → Add Action → Get Contents of URL.**
2. Method `POST`, URL `https://<your-host>/api/v1/webhooks/inbound/<token>/capture`.
3. Request Body `JSON`: `title` = Shortcut Input (or a text field), `body` =
   clipboard / dictation.
4. Add the standard Fables auth header (`Authorization: Bearer <FABLES_TOKEN>`)
   alongside the capture token in the path.
5. Add to the Share Sheet — now "Send to Fables" captures any selection straight
   into your capture notebook.

## RSS output (F1937)

Turn any saved query into a feed your reader can subscribe to:

```
GET /api/v1/webhooks/feed?q=tag:published%20sort:created%20desc
```

Returns RSS 2.0 with every text field XML-escaped. Point your RSS reader (or a
home-automation flow) at it to watch a query over time.

## Scope notes

- **Email-in (F1936)** — a local SMTP catcher that turns inbound mail into notes
  is an optional ops component (a small SMTP listener feeding the same capture
  path); not bundled with the server. The capture endpoint above is the seam it
  plugs into.
