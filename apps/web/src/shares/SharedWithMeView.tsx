/**
 * F1147 — Shared-With-Me View
 *
 * Lists items shared with this device by others.
 *
 * Server contract (consume, do not change):
 *   GET /shared-with-me → { data: SharedWithMeItem[] }
 *
 * If the endpoint returns an empty array or an unexpected shape the component
 * renders an appropriate empty state and does not crash.
 */
import { useSharedWithMe } from '../api/hooks.js';
import type { SharedWithMeItem } from '../api/client.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function accessLevelLabel(level: string): string {
  switch (level) {
    case 'view':
      return 'View only';
    case 'comment':
      return 'Can comment';
    case 'edit':
      return 'Can edit';
    default:
      return level;
  }
}

// ─── Single item row ─────────────────────────────────────────────────────────

function SharedItemRow({ item }: { item: SharedWithMeItem }) {
  const expired = item.expiresAt !== null && new Date(item.expiresAt) < new Date();

  return (
    <li
      className={`shared-with-me-row${expired ? ' shared-with-me-row--expired' : ''}`}
      aria-label={`"${item.docTitle}" shared with you`}
    >
      <div className="shared-with-me-row__info">
        <a
          href={`/notes/${item.docId}`}
          className="shared-with-me-row__title"
          aria-label={`Open "${item.docTitle}"`}
        >
          {item.docTitle}
        </a>
        <span className="shared-with-me-row__meta">
          {accessLevelLabel(item.accessLevel)} · Shared {formatDate(item.sharedAt)}
          {item.expiresAt && (
            <>
              {' '}
              · {expired ? 'Expired' : 'Expires'} {formatDate(item.expiresAt)}
            </>
          )}
        </span>
      </div>
      {expired && (
        <span className="shared-with-me-row__expired-badge" aria-label="Expired">
          Expired
        </span>
      )}
    </li>
  );
}

// ─── View ────────────────────────────────────────────────────────────────────

export function SharedWithMeView() {
  const { data, isPending, isError, refetch } = useSharedWithMe();

  if (isPending) {
    return (
      <section className="shared-with-me" aria-label="Shared with me">
        <p className="shared-with-me__loading">Loading shared items…</p>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="shared-with-me" aria-label="Shared with me">
        <p className="shared-with-me__error" role="alert">
          Could not load shared items.{' '}
          <button type="button" onClick={() => void refetch()} className="shared-with-me__retry">
            Try again
          </button>
        </p>
      </section>
    );
  }

  // Gracefully handle unexpected shapes: ensure data is an array.
  const items: SharedWithMeItem[] = Array.isArray(data) ? data : [];

  return (
    <section className="shared-with-me" aria-label="Shared with me">
      <h2 className="shared-with-me__title">Shared with me</h2>
      {items.length === 0 ? (
        <p className="shared-with-me__empty">Nothing has been shared with you yet.</p>
      ) : (
        <ul className="shared-with-me__list" aria-label="Shared items">
          {items.map((item) => (
            <SharedItemRow key={item.shareId} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
