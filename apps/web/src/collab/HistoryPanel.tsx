/**
 * HistoryPanel (F1171–F1180): collab document history panel.
 *
 * F1171 — named checkpoints list + create
 * F1172 — attribution view (color-coded per author)
 * F1173 — time-slider playback
 * F1174 — restore checkpoint with confirmation Dialog
 * F1175 — diff view between two checkpoints
 * F1176 — forensic recovery export
 */

import { useState } from 'react';
import { Button, Dialog, Input, useToast } from '@fables/ui';
import type * as Y from 'yjs';
import type { CheckpointMeta, AttributionSegment, DiffOp } from './history.js';
import type { HistoryStore } from './history.js';
import './comments.css';

// ─── Attribution View (F1172) ────────────────────────────────────────────────

function AttributionView({ segments }: { segments: AttributionSegment[] }) {
  if (segments.length === 0) {
    return <p style={{ color: 'var(--text-dim)', padding: 8 }}>No content to attribute.</p>;
  }
  return (
    <div className="attribution-view" aria-label="Attribution view">
      {segments.map((seg, i) => (
        <span
          key={i}
          className="attr-segment"
          style={{ backgroundColor: `${seg.color}22` }}
          title={seg.authorName}
        >
          {seg.text}
        </span>
      ))}
    </div>
  );
}

// ─── Diff View (F1175) ───────────────────────────────────────────────────────

function DiffView({ ops }: { ops: DiffOp[] }) {
  if (ops.length === 0) return <p style={{ color: 'var(--text-dim)' }}>No differences.</p>;
  return (
    <div className="history-diff" aria-label="Diff view">
      {ops.map((op, i) => (
        <div key={i} className={`diff-${op.op}`}>
          {op.op === 'add' ? '+ ' : op.op === 'del' ? '- ' : '  '}
          {op.text}
        </div>
      ))}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export interface CollabHistoryPanelProps {
  store: HistoryStore;
  yDoc: Y.Doc;
  yText: Y.Text;
  clientId: number;
  authorName: string;
  userColors: Map<number, { name: string; color: string }>;
  onClose: () => void;
  /** Called when the user restores a checkpoint (after confirmation). */
  onRestored: (text: string) => void;
}

type TabKey = 'checkpoints' | 'attribution' | 'slider';

export function CollabHistoryPanel({
  store,
  yDoc,
  yText,
  clientId,
  authorName,
  userColors,
  onClose,
  onRestored,
}: CollabHistoryPanelProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<TabKey>('checkpoints');
  const [checkpointName, setCheckpointName] = useState('');
  const [checkpoints, setCheckpoints] = useState<CheckpointMeta[]>(() => store.listCheckpoints());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diffBaseId, setDiffBaseId] = useState<string | null>(null);
  const [diffTargetId, setDiffTargetId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<CheckpointMeta | null>(null);
  const [sliderIdx, setSliderIdx] = useState(0);
  const [sliderText, setSliderText] = useState<string | null>(null);

  const refresh = () => setCheckpoints(store.listCheckpoints());

  const createCheckpoint = () => {
    const name = checkpointName.trim() || `Checkpoint ${checkpoints.length + 1}`;
    store.createCheckpoint(yDoc, name, clientId, authorName);
    setCheckpointName('');
    refresh();
    toast(`Checkpoint "${name}" saved`);
  };

  const handleRestore = (cp: CheckpointMeta) => {
    setConfirmRestore(cp);
  };

  const doRestore = () => {
    if (!confirmRestore) return;
    const text = store.snapshotText(confirmRestore);
    store.restoreCheckpoint(confirmRestore, yDoc);
    onRestored(text);
    setConfirmRestore(null);
    toast(`Restored to "${confirmRestore.name}"`);
  };

  const handleDelete = (id: string) => {
    store.deleteCheckpoint(id);
    refresh();
    if (selectedId === id) setSelectedId(null);
  };

  const handleExportForRecovery = () => {
    const json = store.exportForRecovery();
    void navigator.clipboard.writeText(json).then(
      () => toast('Recovery data copied to clipboard (F1176)'),
      () => toast('Copy failed', 'error'),
    );
  };

  // Attribution segments
  const segments = tab === 'attribution' ? store.buildAttribution(yText, userColors) : [];

  // Diff ops (F1175)
  const diffOps =
    showDiff && diffBaseId && diffTargetId
      ? (() => {
          const base = store.getCheckpoint(diffBaseId);
          const target = diffTargetId === '__current__' ? null : store.getCheckpoint(diffTargetId);
          return base ? store.diffCheckpoints(base, target, yDoc) : [];
        })()
      : [];

  // Slider preview (F1173)
  const allCheckpoints = [...store.listCheckpoints()].reverse(); // oldest first
  const onSliderChange = (idx: number) => {
    setSliderIdx(idx);
    const text = store.getTextAtCheckpointIndex(idx);
    setSliderText(text);
  };

  return (
    <aside className="collab-history-panel" aria-label="Document history">
      <div className="collab-history-header">
        <span>History</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button onClick={handleExportForRecovery} title="Forensic recovery export (F1176)">
            Export
          </Button>
          <Button onClick={onClose} aria-label="Close history">
            ×
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
        {(['checkpoints', 'attribution', 'slider'] as TabKey[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '6px 0',
              background: 'none',
              border: 'none',
              borderBottom:
                tab === t ? '2px solid var(--accent, #5c7ce0)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: tab === t ? 600 : 400,
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {/* ── Checkpoints tab ── */}
        {tab === 'checkpoints' && (
          <>
            {/* Create checkpoint */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <Input
                placeholder="Checkpoint name…"
                value={checkpointName}
                onChange={(e) => setCheckpointName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createCheckpoint();
                }}
                aria-label="Checkpoint name"
              />
              <Button variant="primary" onClick={createCheckpoint}>
                Save
              </Button>
            </div>

            {checkpoints.length === 0 && (
              <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                No checkpoints yet. Save one to start tracking history.
              </p>
            )}

            <div className="checkpoint-list">
              {checkpoints.map((cp) => (
                <div
                  key={cp.id}
                  className={`checkpoint-item${selectedId === cp.id ? ' active' : ''}`}
                  onClick={() => setSelectedId(selectedId === cp.id ? null : cp.id)}
                >
                  <span className="checkpoint-name" title={cp.name}>
                    {cp.name}
                  </span>
                  <span className="checkpoint-ts">{new Date(cp.ts).toLocaleString()}</span>
                  <div className="checkpoint-actions" onClick={(e) => e.stopPropagation()}>
                    <Button
                      onClick={() => handleRestore(cp)}
                      title="Restore this checkpoint (F1174)"
                      aria-label={`Restore checkpoint ${cp.name}`}
                    >
                      Restore
                    </Button>
                    <Button
                      onClick={() => handleDelete(cp.id)}
                      aria-label={`Delete checkpoint ${cp.name}`}
                    >
                      ×
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Diff controls (F1175) */}
            {checkpoints.length >= 2 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Diff view (F1175)</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    className="ui-select"
                    value={diffBaseId ?? ''}
                    onChange={(e) => setDiffBaseId(e.target.value || null)}
                    aria-label="Diff from"
                    style={{ flex: 1 }}
                  >
                    <option value="">From…</option>
                    {checkpoints.map((cp) => (
                      <option key={cp.id} value={cp.id}>
                        {cp.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="ui-select"
                    value={diffTargetId ?? ''}
                    onChange={(e) => setDiffTargetId(e.target.value || null)}
                    aria-label="Diff to"
                    style={{ flex: 1 }}
                  >
                    <option value="">To…</option>
                    {checkpoints.map((cp) => (
                      <option key={cp.id} value={cp.id}>
                        {cp.name}
                      </option>
                    ))}
                    <option value="__current__">Current</option>
                  </select>
                  <Button onClick={() => setShowDiff(true)} disabled={!diffBaseId || !diffTargetId}>
                    Diff
                  </Button>
                </div>
                {showDiff && <DiffView ops={diffOps} />}
              </div>
            )}
          </>
        )}

        {/* ── Attribution tab (F1172) ── */}
        {tab === 'attribution' && (
          <div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
              Per-character authorship. Hover a segment to see the author name.
            </p>
            <AttributionView segments={segments} />
          </div>
        )}

        {/* ── Time-slider tab (F1173) ── */}
        {tab === 'slider' && (
          <div className="history-slider">
            {allCheckpoints.length < 2 ? (
              <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                Need at least 2 checkpoints to use the time slider.
              </p>
            ) : (
              <>
                <input
                  type="range"
                  min={0}
                  max={allCheckpoints.length - 1}
                  value={sliderIdx}
                  onChange={(e) => onSliderChange(Number(e.target.value))}
                  aria-label="Time slider"
                />
                <div className="history-slider-ts">
                  {allCheckpoints[sliderIdx]
                    ? `${allCheckpoints[sliderIdx]!.name} — ${new Date(
                        allCheckpoints[sliderIdx]!.ts,
                      ).toLocaleString()}`
                    : ''}
                </div>
                {sliderText !== null && (
                  <pre
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      maxHeight: 300,
                      overflow: 'auto',
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      padding: 8,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {sliderText}
                  </pre>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Restore confirmation dialog (F1174) */}
      <Dialog open={confirmRestore !== null} onClose={() => setConfirmRestore(null)}>
        {confirmRestore && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 280 }}>
            <h3 style={{ margin: 0 }}>Restore checkpoint?</h3>
            <p style={{ margin: 0, fontSize: 13 }}>
              Restore &ldquo;<strong>{confirmRestore.name}</strong>&rdquo; from{' '}
              {new Date(confirmRestore.ts).toLocaleString()}?<br />
              This will overwrite the current content.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button onClick={() => setConfirmRestore(null)}>Cancel</Button>
              <Button variant="primary" onClick={doRestore} aria-label="Confirm restore">
                Restore
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </aside>
  );
}
