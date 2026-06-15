/**
 * Webhooks repository (Epic 20, F1931–F1938).
 *
 * Owns outbound subscriptions, the delivery log / dead-letter queue and inbound
 * capture endpoints. Delivery itself (the network POST) runs through the pure
 * `webhooks/delivery` core with an injected fetch; this repo enqueues events,
 * records their outcomes (advancing attempts + backoff or dead-lettering), and
 * authenticates inbound captures with a constant-time token check.
 */

import { nowIso, validation, type NotebookId } from '@fables/core';
import type { Db } from '../connection.js';
import { notesRepo } from './notes.js';
import {
  buildPayload,
  classifyResponse,
  nextRetry,
  verifyInboundToken,
  type WebhookEvent,
  type WebhookEventType,
} from '../../webhooks/delivery.js';

export type DeliveryStatus = 'pending' | 'ok' | 'retrying' | 'dead';

export interface Subscription {
  id: string;
  name: string;
  url: string;
  event: string;
  template: string | null;
  secret: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SubRow {
  id: string;
  name: string;
  url: string;
  event: string;
  template: string | null;
  secret: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const toSub = (r: SubRow): Subscription => ({
  id: r.id,
  name: r.name,
  url: r.url,
  event: r.event,
  template: r.template,
  secret: r.secret,
  enabled: r.enabled === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface Delivery {
  id: string;
  subscriptionId: string;
  event: string;
  payload: string;
  status: DeliveryStatus;
  attempts: number;
  lastStatus: number | null;
  outcome: string | null;
  error: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DeliveryRow {
  id: string;
  subscription_id: string;
  event: string;
  payload: string;
  status: string;
  attempts: number;
  last_status: number | null;
  outcome: string | null;
  error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

const toDelivery = (r: DeliveryRow): Delivery => ({
  id: r.id,
  subscriptionId: r.subscription_id,
  event: r.event,
  payload: r.payload,
  status: r.status as DeliveryStatus,
  attempts: r.attempts,
  lastStatus: r.last_status,
  outcome: r.outcome,
  error: r.error,
  nextAttemptAt: r.next_attempt_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface InboundEndpoint {
  id: string;
  name: string;
  token: string;
  notebookId: string;
  enabled: boolean;
  captureCount: number;
  createdAt: string;
  updatedAt: string;
}

interface InboundRow {
  id: string;
  name: string;
  token: string;
  notebook_id: string;
  enabled: number;
  capture_count: number;
  created_at: string;
  updated_at: string;
}

const toInbound = (r: InboundRow): InboundEndpoint => ({
  id: r.id,
  name: r.name,
  token: r.token,
  notebookId: r.notebook_id,
  enabled: r.enabled === 1,
  captureCount: r.capture_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface SubscriptionInput {
  name: string;
  url: string;
  event?: string;
  template?: string | null;
  secret?: string | null;
  enabled?: boolean;
}

export function webhooksRepo(db: Db) {
  const notes = notesRepo(db);

  const repo = {
    // ---- Outbound subscriptions ----
    createSubscription(input: SubscriptionInput): Subscription {
      const now = nowIso();
      const sub: Subscription = {
        id: `whk_${crypto.randomUUID()}`,
        name: input.name,
        url: input.url,
        event: input.event ?? '*',
        template: input.template ?? null,
        secret: input.secret ?? null,
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO webhook_subscriptions (id, name, url, event, template, secret, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        sub.id,
        sub.name,
        sub.url,
        sub.event,
        sub.template,
        sub.secret,
        sub.enabled ? 1 : 0,
        now,
        now,
      );
      return sub;
    },

    getSubscription(id: string): Subscription | null {
      const row = db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(id) as
        | SubRow
        | undefined;
      return row ? toSub(row) : null;
    },

    listSubscriptions(): Subscription[] {
      return (
        db.prepare('SELECT * FROM webhook_subscriptions ORDER BY name').all() as SubRow[]
      ).map(toSub);
    },

    updateSubscription(
      id: string,
      patch: {
        name?: string | undefined;
        url?: string | undefined;
        event?: string | undefined;
        template?: string | null | undefined;
        secret?: string | null | undefined;
        enabled?: boolean | undefined;
      },
    ): Subscription | null {
      const cur = this.getSubscription(id);
      if (!cur) return null;
      const now = nowIso();
      db.prepare(
        `UPDATE webhook_subscriptions SET name = ?, url = ?, event = ?, template = ?, secret = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      ).run(
        patch.name ?? cur.name,
        patch.url ?? cur.url,
        patch.event ?? cur.event,
        patch.template !== undefined ? patch.template : cur.template,
        patch.secret !== undefined ? patch.secret : cur.secret,
        (patch.enabled ?? cur.enabled) ? 1 : 0,
        now,
        id,
      );
      return this.getSubscription(id);
    },

    removeSubscription(id: string): boolean {
      return db.prepare('DELETE FROM webhook_subscriptions WHERE id = ?').run(id).changes > 0;
    },

    // ---- Delivery log / dead-letter ----
    /** Fan an event out to matching enabled subscriptions, queueing a delivery each. */
    enqueue(event: WebhookEvent): Delivery[] {
      const subs = this.listSubscriptions().filter(
        (s) => s.enabled && (s.event === '*' || s.event === event.type),
      );
      const now = nowIso();
      const created: Delivery[] = [];
      for (const sub of subs) {
        const payload = buildPayload(event, sub.template ?? undefined);
        const id = `dlv_${crypto.randomUUID()}`;
        db.prepare(
          `INSERT INTO webhook_deliveries (id, subscription_id, event, payload, status, attempts, next_attempt_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
        ).run(id, sub.id, event.type, payload.body, now, now, now);
        const row = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(id) as
          | DeliveryRow
          | undefined;
        if (row) created.push(toDelivery(row));
      }
      return created;
    },

    getDelivery(id: string): Delivery | null {
      const row = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(id) as
        | DeliveryRow
        | undefined;
      return row ? toDelivery(row) : null;
    },

    listDeliveries(subscriptionId?: string, limit = 100): Delivery[] {
      const rows = (
        subscriptionId !== undefined
          ? db
              .prepare(
                'SELECT * FROM webhook_deliveries WHERE subscription_id = ? ORDER BY created_at DESC LIMIT ?',
              )
              .all(subscriptionId, limit)
          : db
              .prepare('SELECT * FROM webhook_deliveries ORDER BY created_at DESC LIMIT ?')
              .all(limit)
      ) as DeliveryRow[];
      return rows.map(toDelivery);
    },

    /**
     * Record the result of a delivery attempt. An HTTP status maps through the
     * pure classifier; a 'retry' arms the next backoff attempt or dead-letters
     * once attempts are exhausted (F1934).
     */
    recordResult(
      id: string,
      httpStatus: number,
      opts?: { maxAttempts?: number; baseDelayMs?: number; error?: string },
    ): Delivery | null {
      const cur = this.getDelivery(id);
      if (!cur) return null;
      const attempts = cur.attempts + 1;
      const outcome = classifyResponse(httpStatus);
      const now = nowIso();
      let status: DeliveryStatus;
      let nextAttemptAt: string | null = null;

      if (outcome === 'ok') {
        status = 'ok';
      } else if (outcome === 'dead') {
        status = 'dead';
      } else {
        // retry — back off, or dead-letter if exhausted.
        const decision = nextRetry(attempts - 1, {
          ...(opts?.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
          ...(opts?.baseDelayMs !== undefined ? { baseDelayMs: opts.baseDelayMs } : {}),
        });
        if (decision.retry) {
          status = 'retrying';
          nextAttemptAt = new Date(Date.now() + decision.delayMs).toISOString();
        } else {
          status = 'dead';
        }
      }

      db.prepare(
        `UPDATE webhook_deliveries SET status = ?, attempts = ?, last_status = ?, outcome = ?, error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?`,
      ).run(status, attempts, httpStatus, outcome, opts?.error ?? null, nextAttemptAt, now, id);
      return this.getDelivery(id);
    },

    deadLetters(limit = 100): Delivery[] {
      return (
        db
          .prepare(
            "SELECT * FROM webhook_deliveries WHERE status = 'dead' ORDER BY updated_at DESC LIMIT ?",
          )
          .all(limit) as DeliveryRow[]
      ).map(toDelivery);
    },

    // ---- Inbound capture ----
    createInbound(input: { name: string; notebookId: string; token?: string }): InboundEndpoint {
      const now = nowIso();
      const endpoint: InboundEndpoint = {
        id: `inb_${crypto.randomUUID()}`,
        name: input.name,
        token: input.token ?? crypto.randomUUID().replace(/-/g, ''),
        notebookId: input.notebookId,
        enabled: true,
        captureCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO inbound_webhooks (id, name, token, notebook_id, enabled, capture_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 0, ?, ?)`,
      ).run(endpoint.id, endpoint.name, endpoint.token, endpoint.notebookId, now, now);
      return endpoint;
    },

    listInbound(): InboundEndpoint[] {
      return (db.prepare('SELECT * FROM inbound_webhooks ORDER BY name').all() as InboundRow[]).map(
        toInbound,
      );
    },

    removeInbound(id: string): boolean {
      return db.prepare('DELETE FROM inbound_webhooks WHERE id = ?').run(id).changes > 0;
    },

    /**
     * Authenticate an inbound capture by token (constant-time, F1932) and drop a
     * new note into the endpoint's notebook. Returns the created note id, or null
     * if no enabled endpoint matches the token.
     */
    capture(token: string, input: { title: string; body: string }): { noteId: string } | null {
      const match = this.listInbound().find((e) => e.enabled && verifyInboundToken(token, e.token));
      if (!match) return null;
      const note = notes.create({
        notebookId: match.notebookId as NotebookId,
        title: input.title,
        body: input.body,
      });
      db.prepare(
        'UPDATE inbound_webhooks SET capture_count = capture_count + 1, updated_at = ? WHERE id = ?',
      ).run(nowIso(), match.id);
      return { noteId: note.id };
    },
  };

  return repo;
}

export type WebhooksRepo = ReturnType<typeof webhooksRepo>;
export type { WebhookEventType };

/** Validate an event type string against the known set (route guard). */
export const WEBHOOK_EVENTS: WebhookEventType[] = [
  'note.created',
  'note.updated',
  'note.deleted',
  'note.tagged',
  'note.untagged',
  'notebook.created',
  'notebook.updated',
  'notebook.deleted',
  'custom',
];

export function assertKnownEvent(event: string): void {
  if (event !== '*' && !WEBHOOK_EVENTS.includes(event as WebhookEventType)) {
    throw validation(`unknown webhook event: ${event}`);
  }
}
