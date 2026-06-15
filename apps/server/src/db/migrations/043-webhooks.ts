import type { Migration } from './index.js';

/**
 * Webhooks & integrations (Epic 20, F1931–F1938).
 *
 *   webhook_subscriptions  outbound targets: a URL + event filter + optional
 *                          body template and signing secret.
 *   webhook_deliveries     the delivery log + dead-letter queue: one row per
 *                          enqueued event, with attempt/outcome bookkeeping.
 *   inbound_webhooks       token-authenticated capture endpoints that drop a new
 *                          note into a target notebook.
 */
export const migration043Webhooks: Migration = {
  id: 43,
  name: 'webhooks',
  sql: /* sql */ `
    CREATE TABLE webhook_subscriptions (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      url        TEXT NOT NULL,
      event      TEXT NOT NULL DEFAULT '*',
      template   TEXT,
      secret     TEXT,
      enabled    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE webhook_deliveries (
      id              TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
      event           TEXT NOT NULL,
      payload         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      attempts        INTEGER NOT NULL DEFAULT 0,
      last_status     INTEGER,
      outcome         TEXT,
      error           TEXT,
      next_attempt_at TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX idx_webhook_deliveries_sub ON webhook_deliveries (subscription_id, created_at);
    CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries (status);

    CREATE TABLE inbound_webhooks (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      token       TEXT NOT NULL,
      notebook_id TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      capture_count INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `,
};
