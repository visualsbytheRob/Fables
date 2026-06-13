/**
 * World-state inspector (Day 7, F681–F688).
 *
 * A single page with sections for:
 *   - Dashboard (F681): every entity, story-mutated fields highlighted with
 *     provenance (count + which stories).
 *   - Mutation history (F682): expand an entity to read its audit trail.
 *   - Revert (F683): per-field and per-entity restore from the audit.
 *   - Snapshots (F684) + diff (F685): named captures, pick two to compare.
 *   - Conflicts (F687): fields written by 2+ stories.
 *   - Export / Import (F688): download/upload the world as JSON.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bookmark,
  Button,
  Download,
  GitCompare,
  History,
  Input,
  RotateCcw,
  Upload,
  useToast,
} from '@fables/ui';
import { useEntityConflicts } from '../offline/useConflicts.js';
import '../offline/conflict.css';
import { Skeleton } from '../components/Skeleton.js';
import {
  worldApi,
  type EntityMutation,
  type MutationConflict,
  type SnapshotDiff,
  type WorldEntityView,
  type WorldSnapshotMeta,
} from './api.js';
import {
  assertWorldExport,
  diffRowClass,
  diffStatusGlyph,
  exportBlob,
  exportFilename,
  formatFieldValue,
  summarizeMutations,
} from './pure.js';
import './world.css';

type Tab = 'dashboard' | 'snapshots' | 'conflicts' | 'io';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'conflicts', label: 'Conflicts' },
  { id: 'io', label: 'Export / Import' },
];

export function WorldPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  return (
    <div className="world-page">
      <div className="world-head">
        <h1>
          <History size={20} /> World State
        </h1>
      </div>
      <div className="world-tabs" role="tablist" aria-label="World inspector">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === tab}
            className={t.id === tab ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' ? <DashboardTab /> : null}
      {tab === 'snapshots' ? <SnapshotsTab /> : null}
      {tab === 'conflicts' ? <ConflictsTab /> : null}
      {tab === 'io' ? <ExportImportTab /> : null}
    </div>
  );
}

/* ===== Dashboard + mutation history + revert (F681/F682/F683) ===== */

function DashboardTab() {
  const dashboardQuery = useQuery({
    queryKey: ['world', 'dashboard'],
    queryFn: () => worldApi.dashboard(),
  });

  if (dashboardQuery.isLoading) return <Skeleton height={240} />;
  if (dashboardQuery.isError || dashboardQuery.data === undefined) {
    return <p className="world-empty">Could not load the world dashboard.</p>;
  }
  const entities = dashboardQuery.data;
  if (entities.length === 0) {
    return <p className="world-empty">No entities yet. Create some to populate your world.</p>;
  }

  // Mutated entities first, then alphabetical.
  const sorted = [...entities].sort((a, b) => {
    const am = Object.keys(a.mutatedFields).length > 0 ? 0 : 1;
    const bm = Object.keys(b.mutatedFields).length > 0 ? 0 : 1;
    return am - bm || a.name.localeCompare(b.name);
  });

  return (
    <section className="world-section">
      <h2>Entities</h2>
      <div className="world-entities">
        {sorted.map((view) => (
          <EntityRow key={view.id} view={view} />
        ))}
      </div>
    </section>
  );
}

function EntityRow({ view }: { view: WorldEntityView }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => summarizeMutations(view), [view]);
  // F845: sync conflict badge
  const { hasConflict, conflictFields } = useEntityConflicts(view.id);

  return (
    <div className={`world-entity${summary.hasMutations ? ' mutated' : ''}${hasConflict ? ' has-sync-conflict' : ''}`}>
      <button
        className="world-entity-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="world-entity-name">{view.name}</span>
        <span className="world-entity-type">{view.type}</span>
        {summary.hasMutations ? (
          <span className="world-badge">
            {summary.fields.length} mutated · {summary.totalCount}×
          </span>
        ) : null}
        {hasConflict ? (
          <span
            className="world-field-conflict-badge"
            title={`Sync conflict on: ${conflictFields.join(', ')}`}
            aria-label="Sync conflict pending review"
          >
            <AlertTriangle size={10} />
            sync conflict
          </span>
        ) : null}
      </button>
      {open ? <EntityDetail view={view} summary={summary} conflictFields={conflictFields} /> : null}
    </div>
  );
}

function EntityDetail({
  view,
  summary,
  conflictFields = [],
}: {
  view: WorldEntityView;
  summary: ReturnType<typeof summarizeMutations>;
  conflictFields?: string[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutationsQuery = useQuery({
    queryKey: ['world', 'mutations', view.id],
    queryFn: () => worldApi.entityMutations(view.id),
    enabled: summary.hasMutations,
  });

  const revertMutation = useMutation({
    mutationFn: (field?: string) =>
      worldApi.revert(view.id, field !== undefined ? { field } : {}),
    onSuccess: (result) => {
      toast(`Reverted ${result.reverted.length} field${result.reverted.length === 1 ? '' : 's'}`);
      void queryClient.invalidateQueries({ queryKey: ['world'] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'revert failed', 'error'),
  });

  const fieldNames = [...new Set([...Object.keys(view.fields), ...summary.fields])].sort();
  const conflictFieldSet = new Set(conflictFields);

  const revert = (field?: string) => {
    const label = field === undefined ? `all mutated fields of ${view.name}` : `${view.name}.${field}`;
    if (!window.confirm(`Revert ${label} to the pre-mutation value? This is audited.`)) return;
    revertMutation.mutate(field);
  };

  return (
    <div className="world-entity-body">
      <div className="world-fields">
        {fieldNames.map((field) => {
          const info = view.mutatedFields[field];
          const isMutated = info !== undefined;
          const hasSyncConflict = conflictFieldSet.has(field);
          return (
            <FieldLine
              key={field}
              field={field}
              value={view.fields[field]}
              mutated={isMutated}
              hasSyncConflict={hasSyncConflict}
              meta={
                info !== undefined
                  ? `${info.count}× · ${info.storyIds.length} stor${info.storyIds.length === 1 ? 'y' : 'ies'}`
                  : ''
              }
              {...(isMutated ? { onRevert: () => revert(field) } : {})}
              disabled={revertMutation.isPending}
            />
          );
        })}
      </div>

      {summary.hasMutations ? (
        <>
          <MutationHistory
            isLoading={mutationsQuery.isLoading}
            mutations={mutationsQuery.data ?? []}
          />
          <div className="world-actions">
            <Button
              variant="danger"
              disabled={revertMutation.isPending}
              onClick={() => revert(undefined)}
            >
              <RotateCcw size={14} /> Revert all
            </Button>
            <span className="world-hint">
              Stories: {summary.storyIds.join(', ')}
            </span>
          </div>
        </>
      ) : (
        <p className="world-hint">No story has mutated this entity.</p>
      )}
    </div>
  );
}

function FieldLine({
  field,
  value,
  mutated,
  hasSyncConflict = false,
  meta,
  onRevert,
  disabled,
}: {
  field: string;
  value: unknown;
  mutated: boolean;
  hasSyncConflict?: boolean;
  meta: string;
  onRevert?: () => void;
  disabled: boolean;
}) {
  return (
    <>
      <span className="world-field-name">
        {field}
        {hasSyncConflict && (
          <span
            className="world-field-conflict-badge"
            title="This field has a pending sync conflict — review in Settings"
            aria-label="Sync conflict"
          >
            <AlertTriangle size={10} /> conflict
          </span>
        )}
      </span>
      <span className={`world-field-value${mutated ? ' mutated' : ''}${hasSyncConflict ? ' sync-conflict' : ''}`}>
        {formatFieldValue(value)}
      </span>
      {onRevert !== undefined ? (
        <button
          type="button"
          className="world-snap-pick"
          aria-label={`Revert ${field}`}
          title={`Revert ${field}`}
          disabled={disabled}
          onClick={onRevert}
          style={{ background: 'none', border: 0, color: 'var(--text-dim)', cursor: 'pointer' }}
        >
          <RotateCcw size={12} /> <span className="world-field-meta">{meta}</span>
        </button>
      ) : (
        <span className="world-field-meta">{meta}</span>
      )}
    </>
  );
}

function MutationHistory({
  isLoading,
  mutations,
}: {
  isLoading: boolean;
  mutations: EntityMutation[];
}) {
  if (isLoading) return <Skeleton height={80} />;
  if (mutations.length === 0) return <p className="world-hint">No mutation history.</p>;
  return (
    <div className="world-muts">
      {mutations.map((m) => (
        <div key={m.id} className="world-mut">
          <span className={`world-mut-kind${m.kind === 'revert' ? ' revert' : ''}`}>{m.kind}</span>
          <span className="world-mut-field">{m.field}</span>
          <span className="world-mut-change">
            {formatFieldValue(m.oldValue)} → {formatFieldValue(m.newValue)}
          </span>
          <span className="world-mut-at">{new Date(m.at).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

/* ===== Snapshots + diff (F684/F685) ===== */

function SnapshotsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [pick, setPick] = useState<{ a?: string; b?: string }>({});

  const snapshotsQuery = useQuery({
    queryKey: ['world', 'snapshots'],
    queryFn: () => worldApi.snapshots(),
  });

  const createMutation = useMutation({
    mutationFn: (snapshotName: string) => worldApi.createSnapshot(snapshotName),
    onSuccess: () => {
      setName('');
      toast('Snapshot captured');
      void queryClient.invalidateQueries({ queryKey: ['world', 'snapshots'] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'snapshot failed', 'error'),
  });

  const diffQuery = useQuery({
    queryKey: ['world', 'diff', pick.a, pick.b],
    queryFn: () => worldApi.diff(pick.a as string, pick.b as string),
    enabled: pick.a !== undefined && pick.b !== undefined && pick.a !== pick.b,
  });

  const togglePick = (slot: 'a' | 'b', id: string) =>
    setPick((prev) => ({ ...prev, [slot]: prev[slot] === id ? undefined : id }));

  const snapshots = snapshotsQuery.data ?? [];

  return (
    <section className="world-section">
      <h2>Snapshots</h2>
      <div className="world-snap-create">
        <Input
          placeholder="Snapshot name"
          aria-label="Snapshot name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() !== '') createMutation.mutate(name.trim());
          }}
        />
        <Button
          variant="primary"
          disabled={name.trim() === '' || createMutation.isPending}
          onClick={() => createMutation.mutate(name.trim())}
        >
          <Bookmark size={14} /> Capture
        </Button>
      </div>

      {snapshotsQuery.isLoading ? <Skeleton height={120} /> : null}
      {snapshots.length === 0 && !snapshotsQuery.isLoading ? (
        <p className="world-empty">No snapshots yet. Capture one to track world drift.</p>
      ) : (
        <div className="world-snaps">
          {snapshots.map((snap) => (
            <SnapshotRow
              key={snap.id}
              snap={snap}
              pickedA={pick.a === snap.id}
              pickedB={pick.b === snap.id}
              onPick={togglePick}
            />
          ))}
        </div>
      )}

      {pick.a !== undefined && pick.b !== undefined && pick.a === pick.b ? (
        <p className="world-hint">Pick two different snapshots to diff.</p>
      ) : null}
      {diffQuery.isLoading ? <Skeleton height={80} /> : null}
      {diffQuery.data !== undefined ? <DiffView diff={diffQuery.data} /> : null}
    </section>
  );
}

function SnapshotRow({
  snap,
  pickedA,
  pickedB,
  onPick,
}: {
  snap: WorldSnapshotMeta;
  pickedA: boolean;
  pickedB: boolean;
  onPick: (slot: 'a' | 'b', id: string) => void;
}) {
  return (
    <div className="world-snap">
      <span className="world-snap-name">{snap.name}</span>
      <span className="world-snap-meta">
        {snap.entityCount} entities · {new Date(snap.createdAt).toLocaleString()}
      </span>
      <span className="world-snap-pick">
        <button className={pickedA ? 'active' : ''} onClick={() => onPick('a', snap.id)}>
          A
        </button>
        <button className={pickedB ? 'active' : ''} onClick={() => onPick('b', snap.id)}>
          B
        </button>
      </span>
    </div>
  );
}

function DiffView({ diff }: { diff: SnapshotDiff }) {
  if (diff.fields.length === 0) {
    return (
      <p className="world-hint">
        <GitCompare size={12} /> {diff.a.name} and {diff.b.name} are identical.
      </p>
    );
  }
  return (
    <div className="world-diff">
      {diff.fields.map((row) => (
        <div key={`${row.entityId}:${row.field}`} className={diffRowClass(row.status)}>
          <span>{diffStatusGlyph(row.status)}</span>
          <span className="world-diff-entity">
            {row.entityName}.{row.field}
          </span>
          <span className="world-diff-a">{formatFieldValue(row.a)}</span>
          <span>→</span>
          <span className="world-diff-b">{formatFieldValue(row.b)}</span>
        </div>
      ))}
    </div>
  );
}

/* ===== Conflicts (F687) ===== */

function ConflictsTab() {
  const conflictsQuery = useQuery({
    queryKey: ['world', 'conflicts'],
    queryFn: () => worldApi.conflicts(),
  });

  if (conflictsQuery.isLoading) return <Skeleton height={160} />;
  if (conflictsQuery.isError || conflictsQuery.data === undefined) {
    return <p className="world-empty">Could not load conflicts.</p>;
  }
  const conflicts = conflictsQuery.data;

  return (
    <section className="world-section">
      <h2>Multi-story conflicts</h2>
      {conflicts.length === 0 ? (
        <p className="world-empty">No fields are written by two or more stories.</p>
      ) : (
        conflicts.map((c) => <ConflictRow key={`${c.entityId}:${c.field}`} conflict={c} />)
      )}
    </section>
  );
}

function ConflictRow({ conflict }: { conflict: MutationConflict }) {
  return (
    <div className="world-conflict">
      <div className="world-conflict-head">
        <AlertTriangle size={14} style={{ color: 'var(--danger)' }} />
        <span className="world-conflict-field">{conflict.field}</span>
        <span className="world-snap-meta">on {conflict.entityId}</span>
      </div>
      <div className="world-conflict-stories">
        {conflict.stories.map((s) => (
          <span key={s.storyId}>
            {s.storyId} ({s.count}×)
          </span>
        ))}
      </div>
    </div>
  );
}

/* ===== Export / Import (F688) ===== */

function ExportImportTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<string | null>(null);

  const exportMutation = useMutation({
    mutationFn: () => worldApi.exportWorld(),
    onSuccess: (payload) => {
      const url = URL.createObjectURL(exportBlob(payload));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exportFilename();
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast(`Exported ${payload.entities.length} entities`);
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'export failed', 'error'),
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      assertWorldExport(parsed);
      return worldApi.importWorld(parsed);
    },
    onSuccess: (res) => {
      setResult(`Imported ${res.imported}, skipped ${res.skipped}.`);
      toast('Import complete');
      void queryClient.invalidateQueries({ queryKey: ['world'] });
    },
    onError: (e) => {
      setResult(null);
      toast(e instanceof Error ? e.message : 'import failed', 'error');
    },
  });

  return (
    <section className="world-section">
      <h2>Export / Import</h2>
      <div className="world-io">
        <Button
          variant="primary"
          disabled={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          <Download size={14} /> Export JSON
        </Button>
        <label
          className={`ui-btn${importMutation.isPending ? ' is-disabled' : ''}`}
          style={{ cursor: importMutation.isPending ? 'default' : 'pointer' }}
        >
          <Upload size={14} /> Import JSON
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Import world JSON"
            disabled={importMutation.isPending}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) importMutation.mutate(file);
              e.target.value = '';
            }}
          />
        </label>
        {result !== null ? <span className="world-io-result">{result}</span> : null}
      </div>
      <p className="world-hint">
        Import upserts fields for entities whose id already exists; unknown ids are skipped.
      </p>
    </section>
  );
}
