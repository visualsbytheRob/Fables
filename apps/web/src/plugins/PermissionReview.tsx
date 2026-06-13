/**
 * F1061 — Install-time permission review screen.
 * F1062 — Runtime permission prompts for escalations.
 * F1065 — Privacy labels (shown per permission).
 *
 * PermissionReviewDialog: shown before enabling/installing a plugin.
 * RuntimePermissionPrompt:  shown when a plugin requests a permission
 *                           it didn't originally declare (escalation).
 */
import { Button, Dialog } from '@fables/ui';
import type { PluginPermission, PluginRecord } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Permission metadata (F1065 privacy labels)
// ────────────────────────────────────────────────────────────────────────────

const PERMISSION_META: Record<
  PluginPermission,
  { label: string; description: string; risk: 'low' | 'medium' | 'high' }
> = {
  'notes:read': {
    label: 'Read notes',
    description: 'The plugin can read the content of your notes.',
    risk: 'medium',
  },
  'notes:write': {
    label: 'Modify notes',
    description: 'The plugin can create, edit, and delete notes.',
    risk: 'high',
  },
  'notebooks:read': {
    label: 'Read notebooks',
    description: 'The plugin can see your notebook names and structure.',
    risk: 'low',
  },
  'notebooks:write': {
    label: 'Modify notebooks',
    description: 'The plugin can create, rename, and delete notebooks.',
    risk: 'high',
  },
  'stories:read': {
    label: 'Read stories',
    description: 'The plugin can read your story scripts.',
    risk: 'medium',
  },
  'stories:write': {
    label: 'Modify stories',
    description: 'The plugin can create and edit story scripts.',
    risk: 'high',
  },
  network: {
    label: 'Network access',
    description: 'The plugin can make outbound HTTP requests.',
    risk: 'high',
  },
  clipboard: {
    label: 'Clipboard',
    description: 'The plugin can read from and write to your clipboard.',
    risk: 'medium',
  },
  notifications: {
    label: 'Notifications',
    description: 'The plugin can send system notifications.',
    risk: 'low',
  },
  'storage:local': {
    label: 'Local storage',
    description: 'The plugin can store data in your browser.',
    risk: 'low',
  },
};

const RISK_LABELS: Record<'low' | 'medium' | 'high', string> = {
  low: 'Low risk',
  medium: 'Moderate risk',
  high: 'High risk',
};

function PermissionRow({ permission }: { permission: PluginPermission }) {
  const meta = PERMISSION_META[permission] ?? {
    label: permission,
    description: 'Unknown permission.',
    risk: 'medium' as const,
  };
  return (
    <li className="perm-row">
      <div className={`perm-row__risk perm-row__risk--${meta.risk}`} aria-label={RISK_LABELS[meta.risk]} />
      <div className="perm-row__body">
        <span className="perm-row__label">{meta.label}</span>
        <span className="perm-row__desc">{meta.description}</span>
      </div>
      <span className={`perm-row__badge perm-row__badge--${meta.risk}`}>{RISK_LABELS[meta.risk]}</span>
    </li>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Install-time review dialog (F1061)
// ────────────────────────────────────────────────────────────────────────────

export interface PermissionReviewDialogProps {
  plugin: PluginRecord;
  open: boolean;
  onAllow: () => void;
  onDeny: () => void;
}

export function PermissionReviewDialog({
  plugin,
  open,
  onAllow,
  onDeny,
}: PermissionReviewDialogProps) {
  const hasPermissions = plugin.permissions.length > 0;

  return (
    <Dialog
      open={open}
      onClose={onDeny}
    >
      <div className="perm-review">
        <h2 className="perm-review__title">Enable &ldquo;{plugin.name}&rdquo;?</h2>
        <p className="perm-review__intro">
          <strong>{plugin.name}</strong> (v{plugin.version}) is requesting the following
          permissions. Review carefully before allowing.
        </p>

        {hasPermissions ? (
          <ul className="perm-list" role="list" aria-label="Requested permissions">
            {plugin.permissions.map((p) => (
              <PermissionRow key={p} permission={p} />
            ))}
          </ul>
        ) : (
          <p className="perm-review__none">This plugin requires no special permissions.</p>
        )}

        {plugin.author && (
          <p className="perm-review__author">
            Published by: <strong>{plugin.author}</strong>
          </p>
        )}

        <div className="perm-review__actions">
          <Button variant="primary" onClick={onAllow}>
            Allow &amp; Enable
          </Button>
          <Button onClick={onDeny}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Runtime escalation prompt (F1062)
// ────────────────────────────────────────────────────────────────────────────

export interface RuntimePermissionPromptProps {
  pluginId: string;
  pluginName: string;
  permission: PluginPermission;
  open: boolean;
  onAllow: () => void;
  onDeny: () => void;
}

export function RuntimePermissionPrompt({
  pluginId: _pluginId,
  pluginName,
  permission,
  open,
  onAllow,
  onDeny,
}: RuntimePermissionPromptProps) {
  const meta = PERMISSION_META[permission] ?? {
    label: permission,
    description: 'Unknown permission.',
    risk: 'medium' as const,
  };

  return (
    <Dialog
      open={open}
      onClose={onDeny}
    >
      <div className="perm-prompt">
        <h2 className="perm-review__title">Permission request</h2>
        <p className="perm-prompt__text">
          <strong>{pluginName}</strong> is requesting additional access:
        </p>
        <ul className="perm-list" role="list" aria-label="Requested permission">
          <PermissionRow permission={permission} />
        </ul>
        <p className="perm-prompt__risk-note">
          This is a <strong>{meta.risk}-risk</strong> permission. Granting it allows the plugin to{' '}
          {meta.description.toLowerCase()}
        </p>
        <div className="perm-review__actions">
          <Button variant="primary" onClick={onAllow}>
            Allow once
          </Button>
          <Button onClick={onDeny}>Deny</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: human-readable summary of permission list
// ────────────────────────────────────────────────────────────────────────────

export function permissionsSummary(permissions: PluginPermission[]): string {
  if (permissions.length === 0) return 'No special permissions';
  return permissions.map((p) => PERMISSION_META[p]?.label ?? p).join(', ');
}
