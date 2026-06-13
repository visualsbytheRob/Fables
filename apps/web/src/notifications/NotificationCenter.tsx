/**
 * In-app notification center panel (F871).
 * Bell icon with unread badge; slides open a panel with notification list.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationStore, type AppNotification } from './notificationStore.js';
import './notifications.css';

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    notificationStore.getAll(),
  );

  useEffect(() => {
    // Sync initial state and subscribe to updates
    setNotifications(notificationStore.getAll());
    return notificationStore.subscribe(() => {
      setNotifications(notificationStore.getAll());
    });
  }, []);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  function handleNotifClick(n: AppNotification) {
    notificationStore.markRead(n.id);
    if (n.action) {
      navigate(n.action);
      setOpen(false);
    }
  }

  return (
    <div className="notif-center">
      <button
        type="button"
        className="notif-bell"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {unreadCount > 0 && (
          <span className="notif-badge" aria-hidden>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} aria-hidden />
          <div className="notif-panel" role="dialog" aria-label="Notifications" aria-modal>
            <div className="notif-panel__header">
              <h2>Notifications</h2>
              <div className="notif-panel__actions">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => notificationStore.markAllRead()}
                    className="notif-action-btn"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => notificationStore.clear()}
                  className="notif-action-btn notif-action-btn--danger"
                >
                  Clear all
                </button>
              </div>
            </div>

            {notifications.length === 0 ? (
              <p className="notif-empty">No notifications.</p>
            ) : (
              <ul className="notif-list">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`notif-item${!n.read ? ' notif-item--unread' : ''} notif-item--${n.kind}`}
                    onClick={() => handleNotifClick(n)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleNotifClick(n)}
                  >
                    <div className="notif-item__title">{n.title}</div>
                    <div className="notif-item__body">{n.body}</div>
                    <div className="notif-item__time">
                      {new Date(n.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
