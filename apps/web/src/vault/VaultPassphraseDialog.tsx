/**
 * VaultPassphraseDialog — change passphrase flow (F1223).
 *
 * Opens as a native <dialog>.  Calls POST /vault/passphrase with { current, next }.
 * 403 FORBIDDEN is mapped to a human-readable error message.
 */
import { useCallback, useState } from 'react';
import { Button, Dialog, Input, useToast } from '@fables/ui';
import { ApiRequestError } from '../api/client.js';
import { useVaultChangePassphrase } from './useVaultStatus.js';
import './vault.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function VaultPassphraseDialog({ open, onClose }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const change = useVaultChangePassphrase();
  const { toast } = useToast();

  const reset = useCallback(() => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError('');
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const submit = useCallback(async () => {
    setError('');
    if (next.trim() === '') {
      setError('New passphrase cannot be empty.');
      return;
    }
    if (next !== confirm) {
      setError('New passphrases do not match.');
      return;
    }
    try {
      await change.mutateAsync({ current, next });
      toast('Passphrase changed successfully.');
      handleClose();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'FORBIDDEN') {
        setError('Current passphrase is incorrect.');
      } else {
        setError('Could not change passphrase. Try again.');
      }
    }
  }, [current, next, confirm, change, toast, handleClose]);

  return (
    <Dialog open={open} onClose={handleClose}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>Change Passphrase</h2>
      <div className="vault-change-pp">
        <div className="vault-change-pp__field">
          <label htmlFor="cp-current" className="vault-change-pp__label">
            Current passphrase
          </label>
          <Input
            id="cp-current"
            type="password"
            placeholder="Current passphrase"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </div>

        <div className="vault-change-pp__field">
          <label htmlFor="cp-next" className="vault-change-pp__label">
            New passphrase
          </label>
          <Input
            id="cp-next"
            type="password"
            placeholder="New passphrase"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <div className="vault-change-pp__field">
          <label htmlFor="cp-confirm" className="vault-change-pp__label">
            Confirm new passphrase
          </label>
          <Input
            id="cp-confirm"
            type="password"
            placeholder="Confirm new passphrase"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            autoComplete="new-password"
          />
        </div>

        {error && (
          <p className="vault-gate__error" role="alert">
            {error}
          </p>
        )}

        <div className="vault-change-pp__actions">
          <Button onClick={handleClose} disabled={change.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={change.isPending || current.trim() === '' || next.trim() === ''}
            aria-busy={change.isPending}
          >
            {change.isPending ? 'Saving…' : 'Change passphrase'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
