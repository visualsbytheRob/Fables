/**
 * VaultGate — full-screen overlay that blocks the app when the vault is
 * absent or locked (F1221, F1222, F1226, F1229, F1233).
 *
 * States handled:
 *   absent  → offer to create a new vault (with recovery code generation F1222)
 *   locked  → offer to unlock with exponential backoff on wrong passphrase F1226
 *   unlocked → renders nothing (gate is transparent)
 *
 * The component renders NOTHING sensitive in the DOM behind it when locked
 * (the children prop is simply not rendered — F1233).
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input } from '@fables/ui';
import { ApiRequestError } from '../api/client.js';
import {
  INITIAL_BACKOFF,
  isLockedOut,
  recordFailure,
  recordSuccess,
  secondsRemaining,
} from './backoff.js';
import type { BackoffState } from './backoff.js';
import { generateRecoveryCodes } from './recoveryCodes.js';
import { useVaultCreate, useVaultStatus, useVaultUnlock } from './useVaultStatus.js';
import { vaultStore } from './vaultStore.js';
import { useVaultSession } from './useVaultSession.js';
import './vault.css';

// Lock icon as inline SVG (avoids importing lucide bundle here)
function LockIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// ─── Sub-views ──────────────────────────────────────────────────────────────

interface UnlockViewProps {
  onSuccess: () => void;
  onSwitchToCreate?: () => void;
}

function UnlockView({ onSuccess, onSwitchToCreate }: UnlockViewProps) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [backoff, setBackoff] = useState<BackoffState>(INITIAL_BACKOFF);
  const [countdown, setCountdown] = useState(0);
  const unlock = useVaultUnlock();

  // Countdown ticker
  useEffect(() => {
    if (!isLockedOut(backoff)) {
      setCountdown(0);
      return;
    }
    setCountdown(secondsRemaining(backoff));
    const interval = setInterval(() => {
      const rem = secondsRemaining(backoff);
      setCountdown(rem);
      if (rem <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [backoff]);

  const submit = useCallback(async () => {
    if (isLockedOut(backoff)) return;
    setError('');
    try {
      await unlock.mutateAsync(passphrase);
      setBackoff(recordSuccess(backoff));
      vaultStore.markUnlocked();
      onSuccess();
    } catch (err) {
      const next = recordFailure(backoff);
      setBackoff(next);
      if (err instanceof ApiRequestError && err.code === 'FORBIDDEN') {
        setError('Wrong passphrase. Please try again.');
      } else {
        setError('Could not unlock. Check your connection and try again.');
      }
      setPassphrase('');
    }
  }, [passphrase, backoff, unlock, onSuccess]);

  const locked = isLockedOut(backoff);

  return (
    <>
      <div className="vault-gate__icon">
        <LockIcon />
      </div>
      <h1 className="vault-gate__title">Vault Locked</h1>
      <p className="vault-gate__subtitle">Enter your passphrase to access your notes.</p>

      {locked && (
        <div className="vault-gate__backoff" role="alert">
          Too many failed attempts. Try again in {countdown}s.
        </div>
      )}

      <div className="vault-gate__field">
        <label htmlFor="vault-passphrase" className="vault-gate__label">
          Passphrase
        </label>
        <Input
          id="vault-passphrase"
          type="password"
          placeholder="Enter passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !locked) void submit();
          }}
          disabled={locked || unlock.isPending}
          autoFocus
          autoComplete="current-password"
        />
      </div>

      {error && (
        <p className="vault-gate__error" role="alert">
          {error}
        </p>
      )}

      <div className="vault-gate__actions">
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={locked || unlock.isPending || passphrase.trim() === ''}
          aria-busy={unlock.isPending}
        >
          {unlock.isPending ? 'Unlocking…' : 'Unlock'}
        </Button>
      </div>

      {onSwitchToCreate && (
        <p className="vault-gate__secondary">
          <button type="button" onClick={onSwitchToCreate}>
            No vault yet? Create one
          </button>
        </p>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface CreateViewProps {
  onSuccess: () => void;
  onSwitchToUnlock: () => void;
}

type CreateStep = 'passphrase' | 'recovery';

function CreateView({ onSuccess, onSwitchToUnlock }: CreateViewProps) {
  const [step, setStep] = useState<CreateStep>('passphrase');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const create = useVaultCreate();

  const proceedToRecovery = useCallback(() => {
    if (passphrase.trim() === '') {
      setError('Please enter a passphrase.');
      return;
    }
    if (passphrase !== confirm) {
      setError('Passphrases do not match.');
      return;
    }
    setError('');
    setCodes(generateRecoveryCodes());
    setStep('recovery');
  }, [passphrase, confirm]);

  const finish = useCallback(async () => {
    if (!acknowledged) return;
    try {
      await create.mutateAsync({ passphrase });
      vaultStore.markUnlocked();
      onSuccess();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
        setError('A vault already exists. Please unlock instead.');
        setStep('passphrase');
      } else {
        setError('Could not create vault. Try again.');
        setStep('passphrase');
      }
    }
  }, [acknowledged, passphrase, create, onSuccess]);

  const copyAll = useCallback(() => {
    void navigator.clipboard.writeText(codes.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [codes]);

  if (step === 'recovery') {
    return (
      <>
        <div className="vault-gate__icon">
          <LockIcon />
        </div>
        <h1 className="vault-gate__title">Save Recovery Codes</h1>
        <p className="vault-gate__subtitle">
          Store these codes somewhere safe — you'll need them if you forget your passphrase.
        </p>

        {/* F1229 — permanent data loss warning */}
        <div className="vault-recovery__warning" role="alert">
          <strong>Warning:</strong> If you forget your passphrase AND lose these recovery codes,
          your encrypted data will be permanently unrecoverable. There is no reset mechanism.
        </div>

        <div className="vault-recovery__codes" aria-label="Recovery codes">
          {codes.map((c) => (
            <div key={c} className="vault-recovery__code">
              {c}
            </div>
          ))}
        </div>

        <Button className="vault-recovery__copy-btn" onClick={copyAll}>
          {copied ? 'Copied!' : 'Copy all codes'}
        </Button>

        <div className="vault-gate__field" style={{ marginTop: '1rem' }}>
          <label
            style={{
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'flex-start',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              aria-label="I have saved my recovery codes"
            />
            I have saved my recovery codes in a secure location and understand that losing them is
            permanent.
          </label>
        </div>

        {error && (
          <p className="vault-gate__error" role="alert">
            {error}
          </p>
        )}

        <div className="vault-gate__actions">
          <Button
            variant="primary"
            onClick={() => void finish()}
            disabled={!acknowledged || create.isPending}
            aria-busy={create.isPending}
          >
            {create.isPending ? 'Creating vault…' : 'Create vault & unlock'}
          </Button>
          <Button onClick={() => setStep('passphrase')}>Back</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="vault-gate__icon">
        <LockIcon />
      </div>
      <h1 className="vault-gate__title">Create Vault</h1>
      <p className="vault-gate__subtitle">Choose a strong passphrase to protect your notes.</p>

      <div className="vault-gate__field">
        <label htmlFor="vault-create-pp" className="vault-gate__label">
          Passphrase
        </label>
        <Input
          id="vault-create-pp"
          type="password"
          placeholder="Choose a passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoFocus
          autoComplete="new-password"
        />
      </div>

      <div className="vault-gate__field">
        <label htmlFor="vault-create-confirm" className="vault-gate__label">
          Confirm
        </label>
        <Input
          id="vault-create-confirm"
          type="password"
          placeholder="Confirm passphrase"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') proceedToRecovery();
          }}
          autoComplete="new-password"
        />
      </div>

      {error && (
        <p className="vault-gate__error" role="alert">
          {error}
        </p>
      )}

      <div className="vault-gate__actions">
        <Button
          variant="primary"
          onClick={proceedToRecovery}
          disabled={passphrase.trim() === '' || confirm.trim() === ''}
        >
          Next: Save recovery codes
        </Button>
      </div>

      <p className="vault-gate__secondary">
        <button type="button" onClick={onSwitchToUnlock}>
          Already have a vault? Unlock
        </button>
      </p>
    </>
  );
}

// ─── Gate wrapper ────────────────────────────────────────────────────────────

type GateMode = 'unlock' | 'create';

export function VaultGate({ children }: { children: ReactNode }) {
  const { data: statusData, isLoading } = useVaultStatus();
  const { sessionStatus } = useVaultSession();
  const [mode, setMode] = useState<GateMode>('unlock');
  const prevServerStatusRef = useRef<string | undefined>(undefined);

  // When the server says absent, switch to create mode
  useEffect(() => {
    if (statusData?.status === 'absent') setMode('create');
  }, [statusData?.status]);

  // Sync server "unlocked" status into the in-memory store (tab refresh)
  useEffect(() => {
    if (statusData?.status === 'unlocked' && prevServerStatusRef.current !== 'unlocked') {
      vaultStore.markUnlocked();
    }
    prevServerStatusRef.current = statusData?.status;
  }, [statusData?.status]);

  // App is accessible when server says unlocked AND local session is unlocked
  const isUnlocked = statusData?.status === 'unlocked' && sessionStatus === 'unlocked';

  if (isLoading) {
    return (
      <div className="vault-gate" aria-label="Loading vault status" role="status">
        <div className="vault-gate__card">
          <div className="vault-gate__icon">
            <LockIcon />
          </div>
          <p className="vault-gate__subtitle">Checking vault…</p>
        </div>
      </div>
    );
  }

  if (isUnlocked) {
    return <>{children}</>;
  }

  return (
    <>
      {/* F1233 — the children (sensitive app content) are NOT rendered when locked */}
      <div className="vault-gate" role="dialog" aria-modal="true" aria-label="Vault locked">
        <div className="vault-gate__card">
          {mode === 'unlock' ? (
            <UnlockView
              onSuccess={() => {
                /* vaultStore.markUnlocked already called in UnlockView */
              }}
              onSwitchToCreate={() => setMode('create')}
            />
          ) : (
            <CreateView
              onSuccess={() => {
                /* vaultStore.markUnlocked already called in CreateView */
              }}
              onSwitchToUnlock={() => setMode('unlock')}
            />
          )}
        </div>
      </div>
    </>
  );
}
