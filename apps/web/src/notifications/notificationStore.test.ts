// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  notificationStore,
  notificationPrefs,
  isQuietHours,
  isWithinQuietHours,
  minutesOfDay,
  nextReminderDelayMs,
} from './notificationStore.js';

beforeEach(() => {
  // Clear storage before each test
  localStorage.clear();
  notificationStore.clear();
});

describe('notificationStore', () => {
  it('starts empty', () => {
    expect(notificationStore.getAll()).toHaveLength(0);
    expect(notificationStore.getUnreadCount()).toBe(0);
  });

  it('adds a notification and retrieves it', () => {
    const n = notificationStore.add({
      kind: 'info',
      title: 'Test',
      body: 'Test notification',
    });

    expect(n.id).toBeDefined();
    expect(n.read).toBe(false);
    const all = notificationStore.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe('Test');
  });

  it('marks a single notification as read', () => {
    const n = notificationStore.add({ kind: 'info', title: 'A', body: 'B' });
    notificationStore.markRead(n.id);
    expect(notificationStore.getUnreadCount()).toBe(0);
    expect(notificationStore.getAll()[0]?.read).toBe(true);
  });

  it('marks all as read', () => {
    notificationStore.add({ kind: 'info', title: 'A', body: 'A body' });
    notificationStore.add({ kind: 'warning', title: 'B', body: 'B body' });
    notificationStore.markAllRead();
    expect(notificationStore.getUnreadCount()).toBe(0);
    notificationStore.getAll().forEach((n) => expect(n.read).toBe(true));
  });

  it('clears all notifications', () => {
    notificationStore.add({ kind: 'info', title: 'X', body: 'Y' });
    notificationStore.clear();
    expect(notificationStore.getAll()).toHaveLength(0);
  });

  it('notifies subscribers on add', () => {
    let callCount = 0;
    const unsubscribe = notificationStore.subscribe(() => callCount++);
    notificationStore.add({ kind: 'reminder', title: 'Remind', body: 'Body' });
    expect(callCount).toBe(1);
    unsubscribe();
    notificationStore.add({ kind: 'info', title: 'After', body: 'unsubscribed' });
    expect(callCount).toBe(1); // no more calls after unsubscribe
  });

  it('prepends new notifications (newest first)', () => {
    notificationStore.add({ kind: 'info', title: 'First', body: '' });
    notificationStore.add({ kind: 'info', title: 'Second', body: '' });
    const all = notificationStore.getAll();
    expect(all[0]?.title).toBe('Second');
    expect(all[1]?.title).toBe('First');
  });
});

describe('notificationPrefs', () => {
  it('returns defaults when nothing is set', () => {
    const prefs = notificationPrefs.get();
    expect(prefs.journalReminder).toBe(false);
    expect(prefs.quietHoursEnabled).toBe(false);
    expect(prefs.journalReminderTime).toBe('09:00');
  });

  it('persists partial updates', () => {
    notificationPrefs.set({ journalReminder: true, journalReminderTime: '08:30' });
    const prefs = notificationPrefs.get();
    expect(prefs.journalReminder).toBe(true);
    expect(prefs.journalReminderTime).toBe('08:30');
    // Other prefs unchanged
    expect(prefs.quietHoursEnabled).toBe(false);
  });
});

describe('isQuietHours', () => {
  it('returns false when quiet hours disabled', () => {
    notificationPrefs.set({ quietHoursEnabled: false });
    expect(isQuietHours()).toBe(false);
  });

  it('returns true when current time is within quiet hours (same-day range)', () => {
    // Set quiet hours to 00:00–23:59 (always quiet)
    notificationPrefs.set({
      quietHoursEnabled: true,
      quietHoursStart: '00:00',
      quietHoursEnd: '23:59',
    });
    expect(isQuietHours()).toBe(true);
  });

  it('returns false when outside quiet hours', () => {
    // Set quiet hours to a very narrow window unlikely to match now
    notificationPrefs.set({
      quietHoursEnabled: true,
      quietHoursStart: '00:00',
      quietHoursEnd: '00:01',
    });
    const now = new Date();
    const isInWindow = now.getHours() === 0 && now.getMinutes() === 0;
    // Unless we're exactly at midnight, this should be false
    if (!isInWindow) {
      expect(isQuietHours()).toBe(false);
    }
  });
});

describe('quiet-hours + reminder timing (F878/F872/F880)', () => {
  it('parses HH:MM to minutes-since-midnight', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('07:30')).toBe(450);
    expect(minutesOfDay('22:00')).toBe(1320);
  });

  it('honours a same-day quiet window [09:00, 17:00)', () => {
    expect(isWithinQuietHours(minutesOfDay('08:59'), '09:00', '17:00')).toBe(false);
    expect(isWithinQuietHours(minutesOfDay('09:00'), '09:00', '17:00')).toBe(true);
    expect(isWithinQuietHours(minutesOfDay('16:59'), '09:00', '17:00')).toBe(true);
    expect(isWithinQuietHours(minutesOfDay('17:00'), '09:00', '17:00')).toBe(false);
  });

  it('honours an overnight quiet window [22:00, 07:00) across midnight', () => {
    expect(isWithinQuietHours(minutesOfDay('23:30'), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(minutesOfDay('03:00'), '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(minutesOfDay('07:00'), '22:00', '07:00')).toBe(false);
    expect(isWithinQuietHours(minutesOfDay('12:00'), '22:00', '07:00')).toBe(false);
  });

  it('isQuietHours respects the enabled flag and an injected time', () => {
    notificationPrefs.set({
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    });
    expect(isQuietHours(new Date(2026, 5, 15, 23, 0))).toBe(false);
    notificationPrefs.set({ quietHoursEnabled: true });
    expect(isQuietHours(new Date(2026, 5, 15, 23, 0))).toBe(true);
    expect(isQuietHours(new Date(2026, 5, 15, 12, 0))).toBe(false);
  });

  it('schedules the daily reminder for today when still ahead, tomorrow when past', () => {
    const morning = new Date(2026, 5, 15, 8, 0, 0, 0);
    // 09:00 is one hour ahead → ~3,600,000 ms.
    expect(nextReminderDelayMs(morning, '09:00')).toBe(60 * 60 * 1000);
    // 07:00 already passed → rolls to tomorrow (23 hours away).
    expect(nextReminderDelayMs(morning, '07:00')).toBe(23 * 60 * 60 * 1000);
  });
});
