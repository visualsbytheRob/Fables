/**
 * F1065 — Plugin detail page: permissions, resource use, audit trail.
 * F1064 — Permission revocation without uninstall.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { Button, useToast } from '@fables/ui';
import { usePlugin, useRevokePermission, useUpdatePluginSettings } from './hooks.js';
import { PluginSettingsForm } from './PluginSettingsForm.js';
import type { PluginPermission } from './types.js';
import './plugins.css';

function AuditLog({
  entries,
}: {
  entries: Array<{ id: string; event: string; detail: string | null; createdAt: string }>;
}) {
  if (entries.length === 0) {
    return <p className="plugin-detail__empty">No audit events yet.</p>;
  }
  return (
    <ul className="plugin-audit-log" role="list" aria-label="Audit log">
      {entries.map((e) => (
        <li key={e.id} className="plugin-audit-log__entry">
          <span className="plugin-audit-log__time">
            {new Date(e.createdAt).toLocaleString()}
          </span>
          <span className="plugin-audit-log__event">{e.event}</span>
          {e.detail && <span className="plugin-audit-log__detail">{e.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

export function PluginDetailPage() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const detail = usePlugin(pluginId!);
  const revokePermission = useRevokePermission();
  const updateSettings = useUpdatePluginSettings();

  if (detail.isLoading) {
    return <div className="plugin-detail plugin-detail--loading">Loading plugin details…</div>;
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="plugin-detail plugin-detail--error">
        <p>Could not load plugin details.</p>
        <Button onClick={() => navigate('/plugins')}>Back to Plugins</Button>
      </div>
    );
  }

  const plugin = detail.data;

  const allFields = (plugin.contributes.settingsSections ?? []).flatMap((s) => s.fields);

  return (
    <div className="plugin-detail" role="main" aria-label={`Plugin: ${plugin.name}`}>
      <header className="plugin-detail__header">
        <button type="button" className="plugin-detail__back" onClick={() => navigate('/plugins')}>
          ← Plugins
        </button>
        <div className="plugin-detail__title-row">
          {plugin.iconUrl && (
            <img
              src={plugin.iconUrl}
              alt=""
              className="plugin-detail__icon"
              aria-hidden="true"
            />
          )}
          <div>
            <h1 className="plugin-detail__name">{plugin.name}</h1>
            <p className="plugin-detail__meta">
              v{plugin.version}
              {plugin.author && ` · by ${plugin.author}`}
            </p>
          </div>
        </div>
        {plugin.description && (
          <p className="plugin-detail__description">{plugin.description}</p>
        )}
        <div
          className={`plugin-detail__status plugin-detail__status--${plugin.status}`}
          aria-label={`Status: ${plugin.status}`}
        >
          {plugin.status}
        </div>
      </header>

      {/* Permissions section (F1064 — revocation) */}
      <section className="plugin-detail__section" aria-labelledby="section-perms">
        <h2 id="section-perms" className="plugin-detail__section-title">
          Permissions
        </h2>
        {plugin.permissions.length === 0 ? (
          <p className="plugin-detail__empty">No special permissions required.</p>
        ) : (
          <ul className="plugin-perm-list" role="list">
            {plugin.permissions.map((perm: PluginPermission) => (
              <li key={perm} className="plugin-perm-list__item">
                <span className="plugin-perm-list__name">{perm}</span>
                <Button
                  aria-label={`Revoke ${perm} permission`}
                  onClick={() => {
                    revokePermission.mutate(
                      { id: plugin.id, permission: perm },
                      {
                        onSuccess: () => toast(`Permission "${perm}" revoked`),
                        onError: (err) => toast(`Failed: ${err.message}`, 'error'),
                      },
                    );
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Resource use */}
      {plugin.resourceUse && (
        <section className="plugin-detail__section" aria-labelledby="section-resources">
          <h2 id="section-resources" className="plugin-detail__section-title">
            Resource Usage
          </h2>
          <dl className="plugin-resources">
            {plugin.resourceUse.cpuMs !== undefined && (
              <>
                <dt>CPU time</dt>
                <dd>{plugin.resourceUse.cpuMs.toFixed(1)} ms</dd>
              </>
            )}
            {plugin.resourceUse.memoryBytes !== undefined && (
              <>
                <dt>Memory</dt>
                <dd>{(plugin.resourceUse.memoryBytes / 1024).toFixed(1)} KB</dd>
              </>
            )}
            {plugin.resourceUse.rpcCalls !== undefined && (
              <>
                <dt>RPC calls</dt>
                <dd>{plugin.resourceUse.rpcCalls}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* Settings (F1063) */}
      {allFields.length > 0 && (
        <section className="plugin-detail__section" aria-labelledby="section-settings">
          <h2 id="section-settings" className="plugin-detail__section-title">
            Settings
          </h2>
          <PluginSettingsForm
            fields={allFields}
            values={{}}
            onSave={(settings) => {
              updateSettings.mutate(
                { id: plugin.id, settings },
                {
                  onSuccess: () => toast('Settings saved'),
                  onError: (err) => toast(`Failed: ${err.message}`, 'error'),
                },
              );
            }}
          />
        </section>
      )}

      {/* Audit trail */}
      <section className="plugin-detail__section" aria-labelledby="section-audit">
        <h2 id="section-audit" className="plugin-detail__section-title">
          Audit Trail
        </h2>
        <AuditLog entries={plugin.audit ?? []} />
      </section>
    </div>
  );
}
