/**
 * Claude actions for a note (Epic 14 note intelligence + transforms), surfaced as
 * a single "✨ Claude" button that opens a menu of actions. Each action calls the
 * server, shows the suggestion, and lets the user Apply (an ordinary, undoable
 * note edit) or Copy. The whole control only renders when an AI backend is
 * available, so it disappears cleanly when AI is off (F1309).
 */
import { useState, type ReactNode } from 'react';
import { Button, ClipboardCopy, Dialog, Sparkles, X, useToast } from '@fables/ui';
import { aiApi, type AiOutcome, type RewriteMode } from '../api/client.js';
import {
  applyLinks,
  applyOutline,
  applyStructure,
  applySummary,
  applyTags,
} from './applyHelpers.js';
import './ai.css';

export interface NoteAiMenuProps {
  noteId: string;
  /** Latest title/body — read lazily so Apply merges into current content. */
  getContent: () => { title: string; body: string };
  /** Apply a suggestion by editing the note (merged + autosaved upstream). */
  onApply: (next: { title?: string; body?: string }) => void;
}

interface DoneView {
  label: string;
  preview: ReactNode;
  copyText: string;
  apply?: { label: string; build: () => { title?: string; body?: string } } | undefined;
}

type View =
  | null
  | { kind: 'menu' }
  | { kind: 'running'; label: string }
  | { kind: 'unavailable'; label: string }
  | { kind: 'error'; label: string; message: string }
  | { kind: 'result'; done: DoneView };

const REWRITE_LABELS: { mode: RewriteMode; label: string }[] = [
  { mode: 'tighten', label: 'Tighten' },
  { mode: 'expand', label: 'Expand' },
  { mode: 'formal', label: 'More formal' },
  { mode: 'casual', label: 'More casual' },
  { mode: 'simplify', label: 'Simplify' },
];

/** Map a graceful AiOutcome into a dialog view. */
function outcomeView<T>(label: string, outcome: AiOutcome<T>, done: (data: T) => DoneView): View {
  if (!outcome.available) return { kind: 'unavailable', label };
  if (!outcome.ok) return { kind: 'error', label, message: outcome.error };
  return { kind: 'result', done: done(outcome as unknown as T) };
}

export function NoteAiMenu({ noteId, getContent, onApply }: NoteAiMenuProps) {
  const { toast } = useToast();
  const [view, setView] = useState<View>(null);

  const run = async (label: string, fn: () => Promise<View>) => {
    setView({ kind: 'running', label });
    try {
      setView(await fn());
    } catch (err) {
      setView({ kind: 'error', label, message: (err as Error).message });
    }
  };

  const actions: { label: string; run: () => void }[] = [
    {
      label: 'Summarize',
      run: () =>
        void run('Summary', async () =>
          outcomeView('Summary', await aiApi.summary(noteId), (d) => ({
            label: 'Summary',
            preview: <p className="ai-result__text">{d.summary}</p>,
            copyText: d.summary,
            apply: {
              label: 'Insert at top',
              build: () => ({ body: applySummary(getContent().body, d.summary) }),
            },
          })),
        ),
    },
    {
      label: 'Suggest title',
      run: () =>
        void run('Title', async () =>
          outcomeView('Title', await aiApi.title(noteId), (d) => ({
            label: 'Suggested title',
            preview: <p className="ai-result__text ai-result__title">{d.title}</p>,
            copyText: d.title,
            apply: { label: 'Use title', build: () => ({ title: d.title }) },
          })),
        ),
    },
    {
      label: 'Suggest tags',
      run: () =>
        void run('Tags', async () =>
          outcomeView('Tags', await aiApi.tags(noteId), (d) => ({
            label: 'Suggested tags',
            preview: (
              <div className="ai-result__chips">
                {d.tags.length === 0 ? (
                  <span className="ai-result__muted">No tags suggested.</span>
                ) : (
                  d.tags.map((t) => (
                    <span key={t} className="ai-chip">
                      #{t}
                    </span>
                  ))
                )}
              </div>
            ),
            copyText: d.tags.map((t) => `#${t}`).join(' '),
            apply: {
              label: 'Add tags',
              build: () => ({ body: applyTags(getContent().body, d.tags) }),
            },
          })),
        ),
    },
    {
      label: 'Outline',
      run: () =>
        void run('Outline', async () =>
          outcomeView('Outline', await aiApi.outline(noteId), (d) => ({
            label: 'Outline',
            preview: <pre className="ai-result__pre">{d.outline}</pre>,
            copyText: d.outline,
            apply: {
              label: 'Insert at top',
              build: () => ({ body: applyOutline(getContent().body, d.outline) }),
            },
          })),
        ),
    },
    {
      label: 'Structure meeting',
      run: () =>
        void run('Structure', async () =>
          outcomeView('Structure', await aiApi.structure(noteId), (d) => ({
            label: 'Meeting structure',
            preview: (
              <div className="ai-result__text">
                <p>
                  <strong>Summary:</strong> {d.summary}
                </p>
                {d.decisions.length > 0 && (
                  <>
                    <strong>Decisions</strong>
                    <ul>
                      {d.decisions.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </>
                )}
                {d.actions.length > 0 && (
                  <>
                    <strong>Action items</strong>
                    <ul>
                      {d.actions.map((a, i) => (
                        <li key={i}>
                          {a.task}
                          {a.owner ? ` — ${a.owner}` : ''}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ),
            copyText: `${d.summary}`,
            apply: {
              label: 'Insert at top',
              build: () => ({ body: applyStructure(getContent().body, d) }),
            },
          })),
        ),
    },
    {
      label: 'Suggest links',
      run: () =>
        void run('Links', async () =>
          outcomeView('Links', await aiApi.links(noteId), (d) => ({
            label: 'Suggested links',
            preview:
              d.links.length === 0 ? (
                <span className="ai-result__muted">No link suggestions for this note.</span>
              ) : (
                <ul className="ai-result__links">
                  {d.links.map((l, i) => (
                    <li key={i}>
                      <code>{l.phrase}</code> → [[{l.target}]]
                    </li>
                  ))}
                </ul>
              ),
            copyText: d.links.map((l) => `[[${l.target}]]`).join(' · '),
            apply:
              d.links.length === 0
                ? undefined
                : {
                    label: 'Append related links',
                    build: () => ({ body: applyLinks(getContent().body, d.links) }),
                  },
          })),
        ),
    },
  ];

  const applyDone = (done: DoneView) => {
    if (!done.apply) return;
    onApply(done.apply.build());
    toast('Applied — undo with ⌘Z');
    setView(null);
  };

  const copyDone = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast('Copied'),
      () => toast('Copy failed', 'error'),
    );
  };

  const headTitle =
    view === null || view.kind === 'menu'
      ? 'Ask Claude to…'
      : view.kind === 'result'
        ? view.done.label
        : view.label;

  return (
    <>
      <Button
        title="Claude AI actions"
        aria-label="Claude AI actions"
        className="ai-trigger"
        onClick={() => setView({ kind: 'menu' })}
      >
        <Sparkles size={14} /> Claude
      </Button>

      <Dialog open={view !== null} onClose={() => setView(null)}>
        <div className="ai-dialog">
          <div className="ai-dialog__head">
            <strong className="ai-dialog__title">
              <Sparkles size={15} /> {headTitle}
            </strong>
            <Button aria-label="Close" onClick={() => setView(null)}>
              <X size={14} />
            </Button>
          </div>

          {view?.kind === 'menu' && (
            <div className="ai-menu-grid">
              {actions.map((a) => (
                <button key={a.label} type="button" className="ai-menu-item" onClick={a.run}>
                  {a.label}
                </button>
              ))}
              <div className="ai-menu-sub">Rewrite</div>
              {REWRITE_LABELS.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  className="ai-menu-item ai-menu-item--rewrite"
                  onClick={() =>
                    void run(`Rewrite (${label})`, async () =>
                      outcomeView(`Rewrite (${label})`, await aiApi.rewrite(noteId, mode), (d) => ({
                        label: `Rewrite — ${label}`,
                        preview: <pre className="ai-result__pre">{d.text}</pre>,
                        copyText: d.text,
                        apply: { label: 'Replace note', build: () => ({ body: d.text }) },
                      })),
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {view?.kind === 'running' && (
            <p className="ai-dialog__status" role="status">
              <span className="ai-spinner" aria-hidden /> Asking Claude…
            </p>
          )}

          {view?.kind === 'unavailable' && (
            <p className="ai-dialog__status">No AI backend is available right now.</p>
          )}

          {view?.kind === 'error' && (
            <p className="ai-dialog__error">Couldn’t do that: {view.message}</p>
          )}

          {view?.kind === 'result' && (
            <>
              <div className="ai-result">{view.done.preview}</div>
              <div className="ai-dialog__actions">
                {view.done.apply && (
                  <Button variant="primary" onClick={() => applyDone(view.done)}>
                    {view.done.apply.label}
                  </Button>
                )}
                <Button onClick={() => copyDone(view.done.copyText)}>
                  <ClipboardCopy size={13} /> Copy
                </Button>
                <Button onClick={() => setView({ kind: 'menu' })}>Back</Button>
              </div>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
