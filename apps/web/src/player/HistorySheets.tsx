/**
 * History, bookmarks, transcript reader and playthrough comparison sheets
 * (F561–F566, F569). Rewind is replay-based and deterministic (seed + choice
 * indexes, forge-vm F464); the comparison reuses the scenario LCS differ.
 */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Download, Printer, Share2, useToast } from '@fables/ui';
import type { HistoryEntry, StorySaveState, TranscriptEntry } from '@fables/forge-vm';
import { notebooksApi, notesApi } from '../api/client.js';
import { diffTranscripts } from '../stories/playtest/scenarios.js';
import { savesApi } from './api.js';
import { downloadText, shareText, transcriptMarkdown, transcriptNoteTitle } from './exporters.js';
import {
  addBookmark,
  loadBookmarks,
  loadPlaythroughs,
  removeBookmark,
  type Bookmark,
} from './prefs.js';
import { Sheet } from './PlayerSheets.js';
import { slugify } from './tags.js';

/* ── choice history + rewind (F561/F562) ───────────────────────────────── */

export function HistoryPanel({
  history,
  onRewind,
  onClose,
}: {
  history: readonly HistoryEntry[];
  onRewind: (turn: number) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Choice history" onClose={onClose}>
      {history.length === 0 ? (
        <p style={{ color: 'var(--pl-dim)' }}>No choices made yet this playthrough.</p>
      ) : (
        history.map((entry, i) => (
          <div key={`${entry.turn}-${i}`} className="player-row">
            <div className="player-row-main">
              {entry.text}
              <small>turn {entry.turn}</small>
            </div>
            <Button onClick={() => onRewind(i)} aria-label={`Rewind to before “${entry.text}”`}>
              Rewind here
            </Button>
          </div>
        ))
      )}
    </Sheet>
  );
}

/* ── bookmarks (F563/F564) ─────────────────────────────────────────────── */

export function BookmarksPanel({
  storyId,
  canBookmark,
  turn,
  scene,
  saveNow,
  onRestore,
  onClose,
}: {
  storyId: string;
  canBookmark: boolean;
  turn: number;
  scene: string;
  saveNow: () => StorySaveState;
  onRestore: (saveId: string) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadBookmarks(storyId));

  const create = useMutation({
    mutationFn: async (text: string) => {
      // The full state rides in a named slot save; the note + pointer stay local.
      const slot = await savesApi.createSlot(storyId, `🔖 ${text}`, saveNow());
      return addBookmark(storyId, {
        id: `bm-${Date.now().toString(36)}`,
        saveId: slot.id,
        note: text,
        turn,
        scene,
        createdAt: new Date().toISOString(),
      });
    },
    onSuccess: (next) => {
      setBookmarks(next);
      setNote('');
      toast('Bookmarked');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'bookmark failed'),
  });

  return (
    <Sheet title="Bookmarks" onClose={onClose}>
      {canBookmark ? (
        <form
          style={{ display: 'flex', gap: 8, marginBottom: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim() !== '') create.mutate(note.trim());
          }}
        >
          <input
            type="text"
            aria-label="Bookmark note"
            placeholder="Note for this moment…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ flex: 1, font: 'inherit', fontSize: 14, padding: 10, borderRadius: 10 }}
          />
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Bookmark
          </Button>
        </form>
      ) : null}
      {bookmarks.length === 0 ? (
        <p style={{ color: 'var(--pl-dim)' }}>No bookmarks for this story yet.</p>
      ) : (
        bookmarks.map((bookmark) => (
          <div key={bookmark.id} className="player-row">
            <div className="player-row-main">
              {bookmark.note}
              <small>
                turn {bookmark.turn}
                {bookmark.scene !== '' ? ` · ${bookmark.scene}` : ''} ·{' '}
                {new Date(bookmark.createdAt).toLocaleString()}
              </small>
            </div>
            <Button onClick={() => onRestore(bookmark.saveId)}>Jump to</Button>
            <Button
              variant="danger"
              aria-label={`Delete bookmark ${bookmark.note}`}
              onClick={() => setBookmarks(removeBookmark(storyId, bookmark.id))}
            >
              ✕
            </Button>
          </div>
        ))
      )}
    </Sheet>
  );
}

/* ── transcript reader + export (F565/F566/F585/F587/F590) ─────────────── */

export function TranscriptPanel({
  storyTitle,
  entries,
  ending,
  onClose,
}: {
  storyTitle: string;
  entries: readonly TranscriptEntry[];
  ending: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const markdown = useMemo(
    () => transcriptMarkdown(entries, { title: storyTitle, ending }),
    [entries, storyTitle, ending],
  );
  const saveAsNote = useMutation({
    mutationFn: async () => {
      const notebooks = await notebooksApi.list();
      const notebookId = notebooks[0]?.id;
      if (notebookId === undefined) throw new Error('no notebook to save into');
      return notesApi.create({
        notebookId,
        title: transcriptNoteTitle(storyTitle),
        body: markdown,
      });
    },
    onSuccess: () => toast('Transcript saved to notes'),
    onError: (e) => toast(e instanceof Error ? e.message : 'could not save note'),
  });

  return (
    <Sheet title="Transcript" onClose={onClose}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Button
          onClick={() => downloadText(`${slugify(storyTitle)}-transcript.md`, markdown, 'text/markdown')}
        >
          <Download size={14} /> Markdown
        </Button>
        <Button onClick={() => saveAsNote.mutate()} disabled={saveAsNote.isPending}>
          Save as note
        </Button>
        <Button onClick={() => window.print()}>
          <Printer size={14} /> Print
        </Button>
        <Button
          onClick={() => {
            void shareText({ title: storyTitle, text: markdown }).then((how) => {
              if (how === 'copied') toast('Transcript copied');
            });
          }}
        >
          <Share2 size={14} /> Share
        </Button>
      </div>
      <div className="player-transcript player-print-area" data-testid="player-transcript">
        {entries
          .filter((e) => e.text.trim() !== '')
          .map((entry, i) =>
            entry.kind === 'choice' ? (
              <p key={i} style={{ fontStyle: 'italic', opacity: 0.75 }}>
                ➤ {entry.text}
              </p>
            ) : (
              <p key={i}>{entry.text}</p>
            ),
          )}
      </div>
    </Sheet>
  );
}

/* ── playthrough comparison (F569) ─────────────────────────────────────── */

export function ComparePanel({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const playthroughs = useMemo(() => loadPlaythroughs(storyId), [storyId]);
  const [leftId, setLeftId] = useState(playthroughs[0]?.id ?? '');
  const [rightId, setRightId] = useState(playthroughs[1]?.id ?? '');
  const left = playthroughs.find((p) => p.id === leftId);
  const right = playthroughs.find((p) => p.id === rightId);
  const diff = useMemo(
    () => (left !== undefined && right !== undefined ? diffTranscripts(left.transcript, right.transcript) : []),
    [left, right],
  );

  const label = (p: { endedAt: string; ending: string }) =>
    `${new Date(p.endedAt).toLocaleDateString()} · ${p.ending}`;

  return (
    <Sheet title="Compare playthroughs" onClose={onClose}>
      {playthroughs.length < 2 ? (
        <p style={{ color: 'var(--pl-dim)' }}>
          Finish the story at least twice to compare playthroughs.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select
              aria-label="Left playthrough"
              value={leftId}
              onChange={(e) => setLeftId(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            >
              {playthroughs.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
            </select>
            <select
              aria-label="Right playthrough"
              value={rightId}
              onChange={(e) => setRightId(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            >
              {playthroughs.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="player-compare" data-testid="player-compare">
            <div className="cmp-col">
              {diff.map((line, i) => (
                <div key={i} className={`cmp-line ${line.op === 'add' ? 'pad' : line.op}`}>
                  {line.text || ' '}
                </div>
              ))}
            </div>
            <div className="cmp-col">
              {diff.map((line, i) => (
                <div key={i} className={`cmp-line ${line.op === 'del' ? 'pad' : line.op}`}>
                  {line.text || ' '}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}
