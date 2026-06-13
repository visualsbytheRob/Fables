# Fables Analytics — Privacy Statement (F979)

## What Fables collects

Fables optionally collects **local-only usage telemetry** to help you understand
how you use your own knowledge base. This includes:

- Feature usage counters (e.g., "notes created today: 3")
- Slow operation logs (e.g., "search took 850ms — that's above the 200ms budget")
- Error aggregations (e.g., "sync push failed 2 times in the last hour")
- Knowledge growth metrics (note/link/word counts over time)
- Story play and completion statistics

## What Fables does NOT do

- **No network egress.** Analytics data never leaves your machine. The analytics
  service contains no `fetch()`, HTTP, or WebSocket calls. This is verified by
  automated tests that scan `services/analytics.ts` at every CI run.
- **No third-party tracking.** There is no Google Analytics, Mixpanel, Segment,
  Sentry, Amplitude, or any equivalent SDK.
- **No device fingerprinting.** No IP addresses, user agents, or unique identifiers
  are transmitted anywhere.

## Where data lives

All analytics events are stored in the `analytics_events` table in your local
SQLite database at `~/.fables/fables.sqlite`. You own this file completely.

## Opt-out

You can disable all analytics collection at any time:

```bash
# Via the API (while the server is running):
curl -X PATCH http://localhost:4870/api/v1/analytics/settings \
  -H 'Content-Type: application/json' \
  -d '{"enabled": false}'
```

Or in the Settings page → Analytics → toggle off.

When disabled, no new events are written. Existing events remain until the
retention period expires or you manually purge them.

## Retention

By default, analytics events are kept for **90 days** and then automatically
purged. You can change this:

```bash
curl -X PATCH http://localhost:4870/api/v1/analytics/settings \
  -d '{"retentionDays": 30}'
```

Or purge immediately:

```bash
curl -X POST http://localhost:4870/api/v1/analytics/purge
```

## Deleting everything

Delete the entire database: `rm ~/.fables/fables.sqlite` (this deletes *all*
your notes and stories too — use the export feature first).

Or delete just the analytics table:

```bash
sqlite3 ~/.fables/fables.sqlite "DELETE FROM analytics_events;"
```
