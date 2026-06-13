/**
 * F997 — Settings page: consolidated toggles for theme, offline, notifications,
 * analytics opt-out, AI/embedding, and accessibility preferences.
 *
 * This page unifies controls that previously lived scattered across multiple
 * panels and toasts.
 */
import { useEffect, useState } from 'react';
import { Button, Select, useTheme } from '@fables/ui';
import type { Theme } from '@fables/ui';
import { isOptedOut, setOptOut } from '../analytics/analyticsStore.js';
import { VaultSettingsSection } from '../vault/VaultSettingsSection.js';
import './settings.css';

// ──────────────────────────────────────────────
// Notification preference helpers (F872/F875)
// ──────────────────────────────────────────────

const NOTIF_KEY = 'fables.notifications.enabled';
function loadNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIF_KEY) !== 'false';
  } catch {
    return true;
  }
}
function saveNotificationsEnabled(v: boolean): void {
  try {
    localStorage.setItem(NOTIF_KEY, String(v));
  } catch {
    // ignore
  }
}

// ──────────────────────────────────────────────
// Reduced motion preference
// ──────────────────────────────────────────────

const MOTION_KEY = 'fables.reducedMotion';
function loadReducedMotion(): boolean {
  try {
    const stored = localStorage.getItem(MOTION_KEY);
    if (stored !== null) return stored === 'true';
    // honour system preference as default
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
function saveReducedMotion(v: boolean): void {
  try {
    localStorage.setItem(MOTION_KEY, String(v));
    document.documentElement.dataset.reducedMotion = String(v);
  } catch {
    // ignore
  }
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  id,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-row__text">
        <label htmlFor={id} className="settings-toggle-row__label">
          {label}
        </label>
        {description && <p className="settings-toggle-row__desc">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={`settings-toggle${checked ? ' settings-toggle--on' : ''}`}
        onClick={() => onChange(!checked)}
        aria-label={label}
      >
        <span className="settings-toggle__thumb" />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

function SettingsSection({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <section className="settings-section" aria-labelledby={id}>
      <h2 id={id} className="settings-section__title">
        {title}
      </h2>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [notifications, setNotifications] = useState(loadNotificationsEnabled);
  const [reducedMotion, setReducedMotion] = useState(loadReducedMotion);
  const [analyticsOptOut, setAnalyticsOptOut] = useState(isOptedOut);

  useEffect(() => {
    saveNotificationsEnabled(notifications);
  }, [notifications]);

  useEffect(() => {
    saveReducedMotion(reducedMotion);
  }, [reducedMotion]);

  function handleOptOut(v: boolean) {
    setAnalyticsOptOut(v);
    setOptOut(v);
  }

  return (
    <div className="settings-page" role="main" aria-label="Settings">
      <header className="settings-page__header">
        <h1 className="settings-page__title">Settings</h1>
        <p className="settings-page__subtitle">Customize how Fables looks and behaves.</p>
      </header>

      {/* Appearance */}
      <SettingsSection title="Appearance" id="settings-appearance">
        <div className="settings-field">
          <label htmlFor="settings-theme" className="settings-label">
            Theme
          </label>
          <Select
            id="settings-theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            aria-label="Color theme"
            style={{ width: 'auto' }}
          >
            <option value="system">System (auto)</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </Select>
        </div>
        <ToggleRow
          id="settings-reduced-motion"
          label="Reduce motion"
          description="Minimizes animations and transitions throughout the app."
          checked={reducedMotion}
          onChange={setReducedMotion}
        />
      </SettingsSection>

      {/* Notifications */}
      <SettingsSection title="Notifications" id="settings-notifications">
        <ToggleRow
          id="settings-notifications-toggle"
          label="Enable notifications"
          description="Journal reminders and sync alerts."
          checked={notifications}
          onChange={setNotifications}
        />
      </SettingsSection>

      {/* Offline & PWA */}
      <SettingsSection title="Offline & PWA" id="settings-offline">
        <p className="settings-desc">
          Fables caches notes and assets for offline use. The service worker updates automatically
          when a new version is available.
        </p>
        <Button onClick={() => window.location.assign('/install')} aria-label="PWA install guide">
          iPhone install guide →
        </Button>
      </SettingsSection>

      {/* AI & Embeddings */}
      <SettingsSection title="AI & Embeddings" id="settings-ai">
        <p className="settings-desc">
          Semantic search and related-notes use local embeddings built client-side. No data leaves
          your machine. Configure the embedding provider in the server config.
        </p>
        <p className="settings-desc settings-desc--dim">
          Embedding provider status and backfill controls are in the Search overlay footer (⌘⇧F).
        </p>
      </SettingsSection>

      {/* Analytics */}
      <SettingsSection title="Local Analytics" id="settings-analytics">
        <ToggleRow
          id="settings-analytics-optout"
          label="Opt out of local analytics"
          description="Disables all usage tracking and clears stored data. Nothing is ever sent externally."
          checked={analyticsOptOut}
          onChange={handleOptOut}
        />
        {!analyticsOptOut && (
          <p className="settings-desc settings-desc--dim">
            Analytics data (feature counters, hourly activity, slow ops, errors) is stored only in
            your browser's localStorage. It is never sent to any server or third party.{' '}
            <a href="/analytics" className="settings-link">
              View analytics dashboard →
            </a>
          </p>
        )}
      </SettingsSection>

      {/* Accessibility */}
      <SettingsSection title="Accessibility" id="settings-accessibility">
        <p className="settings-desc">
          Fables targets WCAG 2.1 AA. All interactive surfaces support keyboard navigation and
          screen readers. See the{' '}
          <a href="/accessibility-statement" className="settings-link">
            accessibility statement
          </a>{' '}
          for full details.
        </p>
        <p className="settings-desc settings-desc--dim">
          Focus styles, live regions, and reduced-motion support are always active. The
          &ldquo;Reduce motion&rdquo; toggle above overrides the system preference.
        </p>
      </SettingsSection>

      {/* Encrypted Vault (Epic 13) */}
      <SettingsSection title="Encrypted Vault" id="settings-vault">
        <p className="settings-desc">
          Optionally gate the whole app behind a passphrase. Note content is encrypted at rest; your
          passphrase is never stored. Forgetting it means the data is unrecoverable.
        </p>
        <VaultSettingsSection />
      </SettingsSection>
    </div>
  );
}
