/**
 * VaultSettingsSection — vault controls inside the Settings page (F1223–F1227, F1225).
 *
 * Exposes:
 *   - Key fingerprint display (F1227)
 *   - Unlock session duration setting (F1225)
 *   - Change passphrase button → VaultPassphraseDialog (F1223)
 *   - Manual lock button
 *   - WebAuthn/passkey unlock stub (F1224 — deferred, see notes in report)
 */
import { useEffect, useState } from 'react';
import { Button, Select } from '@fables/ui';
import { deriveFingerprint } from './recoveryCodes.js';
import { VaultPassphraseDialog } from './VaultPassphraseDialog.js';
import { useVaultLock, useVaultStatus } from './useVaultStatus.js';
import { saveSessionMinutes, vaultStore } from './vaultStore.js';
import { useVaultSession } from './useVaultSession.js';
import './vault.css';

/** Session duration options (minutes; 0 = never auto-lock). */
const DURATION_OPTIONS: { label: string; value: number }[] = [
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '4 hours', value: 240 },
  { label: 'Never', value: 0 },
];

export function VaultSettingsSection() {
  const { data: statusData } = useVaultStatus();
  const { sessionMinutes, setSessionMinutes } = useVaultSession();
  const lockMutation = useVaultLock();
  const [changePpOpen, setChangePpOpen] = useState(false);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  // F1227 — derive fingerprint from vault status (server doesn't yet return a
  // key-material value, so we derive from the status string + origin as a
  // placeholder).  See report deferral notes.
  useEffect(() => {
    const raw = statusData
      ? `${statusData.status}::${typeof window !== 'undefined' ? window.location.origin : ''}`
      : undefined;
    void deriveFingerprint(raw).then(setFingerprint);
  }, [statusData]);

  const isUnlocked = statusData?.status === 'unlocked';

  const handleLock = async () => {
    await lockMutation.mutateAsync();
    vaultStore.markLocked();
  };

  return (
    <div className="vault-change-pp" style={{ gap: '1.25rem' }}>
      {/* Status */}
      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-dim)' }}>
        Vault status:{' '}
        <strong style={{ color: isUnlocked ? 'var(--accent)' : 'var(--color-warning, #e09a22)' }}>
          {statusData?.status ?? '…'}
        </strong>
      </p>

      {/* F1227 — Key fingerprint */}
      {fingerprint && (
        <div>
          <p style={{ margin: '0 0 0.375rem', fontSize: '0.875rem', color: 'var(--text-dim)' }}>
            Device fingerprint (for verification only):
          </p>
          <span className="vault-fingerprint" aria-label="Key fingerprint">
            {fingerprint}
          </span>
          <p style={{ margin: '0.375rem 0 0', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            Note: A real cryptographic fingerprint requires the server to expose key-material in
            /vault/status. This placeholder derives from the vault status + origin.
          </p>
        </div>
      )}

      {/* F1225 — Session duration */}
      <div className="vault-session-row">
        <label htmlFor="vault-session-duration" className="vault-session-row__label">
          Auto-lock after
        </label>
        <Select
          id="vault-session-duration"
          value={sessionMinutes}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setSessionMinutes(v);
            saveSessionMinutes(v);
          }}
          style={{ width: 'auto' }}
        >
          {DURATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      {/* Change passphrase */}
      {isUnlocked && <Button onClick={() => setChangePpOpen(true)}>Change passphrase…</Button>}

      {/* Manual lock */}
      {isUnlocked && (
        <Button
          variant="danger"
          onClick={() => void handleLock()}
          disabled={lockMutation.isPending}
          aria-busy={lockMutation.isPending}
        >
          {lockMutation.isPending ? 'Locking…' : 'Lock vault now'}
        </Button>
      )}

      {/* F1224 — WebAuthn/passkey stub (deferred — requires platform API not available in jsdom) */}
      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-dim)' }}>
        Passkey / Touch ID unlock (F1224) is not yet implemented — it requires platform WebAuthn
        support that cannot be meaningfully tested in jsdom.
      </p>

      <VaultPassphraseDialog open={changePpOpen} onClose={() => setChangePpOpen(false)} />
    </div>
  );
}
