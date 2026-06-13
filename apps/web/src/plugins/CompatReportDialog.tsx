/**
 * F1094 — Compatibility report shown before confirming a plugin update.
 * Lists added permissions and breaking changes, requires explicit confirmation.
 */
import { Button, Dialog } from '@fables/ui';
import type { CompatReport } from './client.js';
import './plugins.css';

export interface CompatReportDialogProps {
  open: boolean;
  pluginName: string;
  fromVersion: string;
  toVersion: string;
  report: CompatReport | null;
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CompatReportDialog({
  open,
  pluginName,
  fromVersion,
  toVersion,
  report,
  isLoading,
  onConfirm,
  onCancel,
}: CompatReportDialogProps) {
  const hasBreaking = (report?.breaking?.length ?? 0) > 0;
  const hasNewPerms = (report?.addedPermissions?.length ?? 0) > 0;

  return (
    <Dialog open={open} onClose={onCancel}>
      <div className="compat-report">
        <h2 className="compat-report__title">
          Update {pluginName} to v{toVersion}?
        </h2>
        <p className="compat-report__subtitle">
          Current version: v{fromVersion}
        </p>

        {isLoading ? (
          <p className="compat-report__loading">Checking compatibility…</p>
        ) : report === null ? (
          <p className="compat-report__loading">Could not load compatibility report.</p>
        ) : (
          <>
            {hasNewPerms && (
              <section className="compat-report__section" aria-labelledby="compat-perms-title">
                <h3 id="compat-perms-title" className="compat-report__section-title compat-report__section-title--warn">
                  New permissions requested
                </h3>
                <ul className="compat-report__list" role="list">
                  {report.addedPermissions.map((p) => (
                    <li key={p} className="compat-report__item compat-report__item--warn">
                      {p}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {hasBreaking && (
              <section className="compat-report__section" aria-labelledby="compat-breaking-title">
                <h3 id="compat-breaking-title" className="compat-report__section-title compat-report__section-title--danger">
                  Breaking changes
                </h3>
                <ul className="compat-report__list" role="list">
                  {report.breaking.map((b, i) => (
                    <li key={i} className="compat-report__item compat-report__item--danger">
                      {b}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!hasBreaking && !hasNewPerms && (
              <p className="compat-report__safe">
                No breaking changes or new permission requests — safe to update.
              </p>
            )}
          </>
        )}

        <div className="compat-report__actions">
          <Button
            variant="primary"
            disabled={isLoading || report === null}
            onClick={onConfirm}
            aria-label="Confirm plugin update"
          >
            Update
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}
