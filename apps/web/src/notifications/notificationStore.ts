/**
 * In-app notification center (F871).
 * Stores notifications in memory + localStorage for persistence.
 * Provides daily journal reminder scheduling (F872).
 * Notification preferences + quiet hours (F873, F874).
 */

export type NotifKind = 'info' | 'success' | 'warning' | 'error' | 'reminder';

export interface AppNotification {
  id: string;
  kind: NotifKind;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  /** Route to navigate to on click */
  action?: string;
}

export interface NotificationPrefs {
  journalReminder: boolean;
  journalReminderTime: string; // HH:MM
  quietHoursStart: string; // HH:MM
  quietHoursEnd: string; // HH:MM
  quietHoursEnabled: boolean;
}

const STORAGE_KEY = 'fables:notifications';
const PREFS_KEY = 'fables:notification-prefs';
const MAX_NOTIFICATIONS = 50;

const DEFAULT_PREFS: NotificationPrefs = {
  journalReminder: false,
  journalReminderTime: '09:00',
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyListeners() {
  listeners.forEach((l) => l());
}

function loadNotifications(): AppNotification[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as AppNotification[];
  } catch {
    return [];
  }
}

function saveNotifications(notifications: AppNotification[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
  } catch {
    /* quota exceeded */
  }
}

export const notificationStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getAll(): AppNotification[] {
    return loadNotifications();
  },

  getUnreadCount(): number {
    return loadNotifications().filter((n) => !n.read).length;
  },

  add(notification: Omit<AppNotification, 'id' | 'createdAt' | 'read'>): AppNotification {
    const n: AppNotification = {
      ...notification,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      read: false,
    };
    const current = loadNotifications();
    saveNotifications([n, ...current]);
    notifyListeners();
    return n;
  },

  markRead(id: string): void {
    const current = loadNotifications();
    saveNotifications(current.map((n) => (n.id === id ? { ...n, read: true } : n)));
    notifyListeners();
  },

  markAllRead(): void {
    const current = loadNotifications();
    saveNotifications(current.map((n) => ({ ...n, read: true })));
    notifyListeners();
  },

  clear(): void {
    saveNotifications([]);
    notifyListeners();
  },
};

// ──────────────────────────────── PREFS ──────────────────────────────────────

export const notificationPrefs = {
  get(): NotificationPrefs {
    try {
      return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
    } catch {
      return DEFAULT_PREFS;
    }
  },

  set(prefs: Partial<NotificationPrefs>): void {
    const current = notificationPrefs.get();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...prefs }));
  },
};

// ──────────────────────────────── QUIET HOURS ────────────────────────────────

/** Minutes-since-midnight from an `HH:MM` string. */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Pure quiet-hours test: is `nowMins` (minutes since midnight) inside the
 * [start, end) window? Handles windows that span midnight (start > end), so a
 * 22:00–07:00 quiet period is honoured across the day boundary (F878).
 */
export function isWithinQuietHours(nowMins: number, startStr: string, endStr: string): boolean {
  const startMins = minutesOfDay(startStr);
  const endMins = minutesOfDay(endStr);
  if (startMins <= endMins) {
    return nowMins >= startMins && nowMins < endMins;
  }
  return nowMins >= startMins || nowMins < endMins;
}

/** Returns true if current time is within quiet hours. */
export function isQuietHours(now: Date = new Date()): boolean {
  const prefs = notificationPrefs.get();
  if (!prefs.quietHoursEnabled) return false;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return isWithinQuietHours(nowMins, prefs.quietHoursStart, prefs.quietHoursEnd);
}

/** Ms from `now` until the next daily `HH:MM` reminder (tomorrow if already past). */
export function nextReminderDelayMs(now: Date, reminderTime: string): number {
  const [h, m] = reminderTime.split(':').map(Number);
  const next = new Date(now);
  next.setHours(h ?? 9, m ?? 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

// ──────────────────────────────── JOURNAL REMINDER ───────────────────────────

let reminderTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule the next journal reminder. Call on app init and on prefs change. */
export function scheduleJournalReminder(): void {
  if (reminderTimer) {
    clearTimeout(reminderTimer);
    reminderTimer = null;
  }

  const prefs = notificationPrefs.get();
  if (!prefs.journalReminder) return;

  const msUntil = nextReminderDelayMs(new Date(), prefs.journalReminderTime);
  reminderTimer = setTimeout(() => {
    if (!isQuietHours()) {
      notificationStore.add({
        kind: 'reminder',
        title: 'Journal reminder',
        body: "Time to write today's entry.",
        action: '/today',
      });
    }
    scheduleJournalReminder(); // Schedule next day
  }, msUntil);
}
