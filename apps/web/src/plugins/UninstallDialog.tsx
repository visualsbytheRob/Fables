/**
 * F1098 — Uninstall dialog with data-cleanup choice.
 * Asks "also delete this plugin's data?" (purgeData toggle).
 */
import { useState } from 'react';
import { Button, Dialog } from '@fables/ui';
import './plugins.css';

export interface UninstallDialogProps {
  open: boolean;
  pluginName: string;
  onConfirm: (purgeData: boolean) => void;
  onCancel: () => void;
}

export function UninstallDialog({
  open,
  pluginName,
  onConfirm,
  onCancel,
}: UninstallDialogProps) {
  const [purgeData, setPurgeData] = useState(false);

  function handleConfirm() {
    onConfirm(purgeData);
    setPurgeData(false); // reset for next open
  }

  function handleCancel() {
    setPurgeData(false);
    onCancel();
  }

  return (
    <Dialog open={open} onClose={handleCancel}>
      <div className="uninstall-dialog">
        <h2 className="uninstall-dialog__title">Uninstall &ldquo;{pluginName}&rdquo;?</h2>
        <p className="uninstall-dialog__body">
          This will remove the plugin. Any contributions (commands, panels, routes) will stop
          working immediately.
        </p>

        <label className="uninstall-dialog__purge-label">
          <input
            type="checkbox"
            checked={purgeData}
            onChange={(e) => setPurgeData(e.target.checked)}
            aria-label="Also delete plugin data"
          />
          Also delete this plugin&rsquo;s stored data
        </label>
        {purgeData && (
          <p className="uninstall-dialog__purge-warning" role="alert">
            This will permanently erase all data saved by this plugin. This cannot be undone.
          </p>
        )}

        <div className="uninstall-dialog__actions">
          <Button
            variant="primary"
            onClick={handleConfirm}
            aria-label={purgeData ? 'Uninstall and delete data' : 'Uninstall plugin'}
          >
            {purgeData ? 'Uninstall & delete data' : 'Uninstall'}
          </Button>
          <Button onClick={handleCancel}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}
