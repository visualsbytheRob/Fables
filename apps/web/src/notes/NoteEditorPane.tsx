/**
 * Editor pane for a loaded note: title + markdown editor + live preview,
 * debounced autosave with rev tracking (F181), conflict prompt (F182),
 * revision history (F183–F185), draft recovery (F186), force-save (F189),
 * breadcrumbs (F148), status bar (F193), focus mode (F194), export/copy
 * (F195/F196), info panel (F197), pin (F178), attachment upload (F161/F127),
 * tag autocomplete (F153), and an image lightbox (F166).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  ClipboardCopy,
  Dialog,
  Download,
  History,
  Info,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  useToast,
} from '@fables/ui';
import { keymap, Prec } from '@uiw/react-codemirror';
import type { Extension } from '@uiw/react-codemirror';
import {
  attachmentsApi,
  attachmentUrl,
  type NotebookTreeNode,
  type NoteWithTags,
} from '../api/client.js';
import { useInvalidateNotes, usePatchNote, useTags } from '../api/hooks.js';
import { useRegisterCommands } from '../commands/registry.js';
import { MarkdownEditor } from '../editor/MarkdownEditor.js';
import { loadEditorSettings } from '../editor/settings.js';
import { MarkdownPreview } from '../preview/MarkdownPreview.js';
import { SplitView } from '../preview/SplitView.js';
import { toggleTaskAtLine } from '../preview/tasks.js';
import { ConflictDialog } from './ConflictDialog.js';
import { recoverableDraft, clearDraft, type Draft } from './drafts.js';
import { copyAsHtml, copyText, downloadMarkdown, noteToMarkdown } from './exporters.js';
import { HistoryPanel } from './HistoryPanel.js';
import { NoteInfoPanel } from './NoteInfoPanel.js';
import { breadcrumb } from './notebookTreeModel.js';
import { tagAutocomplete } from './tagAutocomplete.js';
import { readingTimeMinutes, wordCount } from './text.js';
import { useAutosave } from './useAutosave.js';

const STATUS_LABEL: Record<string, string> = {
  idle: '',
  dirty: 'Unsaved…',
  saving: 'Saving…',
  saved: 'Saved',
  conflict: 'Conflict!',
  error: 'Save failed — retrying on next edit',
};

export interface NoteEditorPaneProps {
  note: NoteWithTags;
  roots: NotebookTreeNode[];
  onSelectNotebook: (id: string) => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  /** Parent-held handle to flush pending edits before navigating away (F188). */
  flushRef: { current: (() => Promise<void>) | null };
}

export function NoteEditorPane({
  note,
  roots,
  onSelectNotebook,
  focusMode,
  onToggleFocusMode,
  flushRef,
}: NoteEditorPaneProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [draft, setDraft] = useState<Draft | null>(() =>
    recoverableDraft(note.id, { title: note.title, body: note.body }),
  );
  const [showHistory, setShowHistory] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [editorSettings] = useState(loadEditorSettings);
  const autosave = useAutosave(note);
  const patchNote = usePatchNote();
  const invalidate = useInvalidateNotes();
  const tags = useTags();

  // Latest content for callbacks/commands without re-binding.
  const contentRef = useRef({ title, body });
  contentRef.current = { title, body };

  const edit = useCallback(
    (next: { title?: string; body?: string }) => {
      const merged = { ...contentRef.current, ...next };
      if (next.title !== undefined) setTitle(next.title);
      if (next.body !== undefined) setBody(next.body);
      autosave.onEdit(merged);
    },
    [autosave],
  );

  // Force-save (F189): Mod-S anywhere in the pane + an editor keymap.
  const flush = autosave.flush;
  useEffect(() => {
    flushRef.current = flush;
    return () => {
      flushRef.current = null;
    };
  }, [flush, flushRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush]);

  // Unsaved-changes guard on tab close (F188).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (autosave.isDirty()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [autosave]);

  // Tag autocomplete (F153) over the live tag list.
  const tagNamesRef = useRef<string[]>([]);
  tagNamesRef.current = (tags.data ?? []).map((t) => t.name);
  const extraExtensions = useMemo<Extension[]>(
    () => [
      tagAutocomplete(() => tagNamesRef.current),
      Prec.high(
        keymap.of([
          {
            key: 'Mod-s',
            run: () => true, // window handler does the work; this stops CM's default
          },
        ]),
      ),
    ],
    [],
  );

  const onUpload = useCallback(
    async (file: File) => {
      const attachment = await attachmentsApi.upload(file, note.id);
      return { url: attachmentUrl(attachment.id) };
    },
    [note.id],
  );

  const onToggleTask = useCallback(
    (line: number) => {
      edit({ body: toggleTaskAtLine(contentRef.current.body, line) });
    },
    [edit],
  );

  const togglePin = () => {
    const base = autosave.serverNote ?? note;
    patchNote.mutate(
      { id: note.id, patch: { rev: base.rev, pinned: !base.pinned } },
      {
        onSuccess: (updated) => toast(updated.pinned ? 'Pinned' : 'Unpinned'),
        onError: (err) => toast(`Failed: ${err.message}`, 'error'),
      },
    );
  };

  const exportMd = () => {
    const { filename } = downloadMarkdown(contentRef.current);
    toast(`Downloaded ${filename}`);
  };
  const copyMd = () => {
    void copyText(noteToMarkdown(contentRef.current)).then(
      () => toast('Markdown copied'),
      () => toast('Copy failed', 'error'),
    );
  };
  const copyHtml = () => {
    void copyAsHtml(contentRef.current).then(
      () => toast('HTML copied'),
      () => toast('Copy failed', 'error'),
    );
  };

  // Palette commands for the open note (F199).
  useRegisterCommands([
    {
      id: 'note-save',
      label: `Save note now (${STATUS_LABEL[autosave.status] || 'saved'})`,
      keywords: 'force write',
      run: () => void flush(),
    },
    {
      id: 'note-pin',
      label: note.pinned ? 'Unpin note' : 'Pin note',
      keywords: 'favorite',
      run: togglePin,
    },
    {
      id: 'note-history',
      label: 'Toggle revision history',
      keywords: 'versions diff',
      run: () => setShowHistory((v) => !v),
    },
    {
      id: 'note-info',
      label: 'Note info',
      keywords: 'details stats',
      run: () => setShowInfo(true),
    },
    { id: 'note-export', label: 'Export note as Markdown', keywords: 'download md', run: exportMd },
    { id: 'note-copy-md', label: 'Copy note as Markdown', keywords: 'clipboard', run: copyMd },
    {
      id: 'note-copy-html',
      label: 'Copy note as HTML',
      keywords: 'clipboard rendered',
      run: copyHtml,
    },
    {
      id: 'focus-mode',
      label: focusMode ? 'Exit focus mode' : 'Enter focus mode',
      keywords: 'zen distraction',
      run: onToggleFocusMode,
    },
  ]);

  const crumbs = breadcrumb(roots, note.notebookId);
  const words = wordCount(body);

  return (
    <div className={`note-pane${showHistory ? ' note-pane--history' : ''}`}>
      <div className="note-pane__main">
        {!focusMode && (
          <div className="note-pane__top">
            <nav className="crumbs" aria-label="Notebook path">
              {crumbs.map((nb, i) => (
                <span key={nb.id}>
                  {i > 0 && <span className="crumbs__sep">/</span>}
                  <button
                    type="button"
                    className="crumbs__link"
                    onClick={() => onSelectNotebook(nb.id)}
                  >
                    {nb.name}
                  </button>
                </span>
              ))}
            </nav>
            <div className="ui-row" style={{ gap: 'var(--space-1)' }}>
              <Button
                title={note.pinned ? 'Unpin' : 'Pin'}
                aria-label="Pin note"
                onClick={togglePin}
              >
                {note.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              </Button>
              <Button
                title="History"
                aria-label="Revision history"
                onClick={() => setShowHistory((v) => !v)}
              >
                <History size={14} />
              </Button>
              <Button title="Note info" aria-label="Note info" onClick={() => setShowInfo(true)}>
                <Info size={14} />
              </Button>
              <Button title="Export .md" aria-label="Export markdown" onClick={exportMd}>
                <Download size={14} />
              </Button>
              <Button title="Copy as Markdown" aria-label="Copy markdown" onClick={copyMd}>
                <ClipboardCopy size={14} />
              </Button>
              <Button
                title={focusMode ? 'Exit focus mode' : 'Focus mode'}
                aria-label="Focus mode"
                onClick={onToggleFocusMode}
              >
                {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </Button>
            </div>
          </div>
        )}
        {focusMode && (
          <Button
            className="note-pane__unfocus"
            aria-label="Exit focus mode"
            onClick={onToggleFocusMode}
          >
            <Minimize2 size={14} />
          </Button>
        )}

        {draft && (
          <div className="draft-banner" role="alert">
            <span>
              Unsaved draft from {new Date(draft.savedAt).toLocaleString()} found for this note.
            </span>
            <Button
              variant="primary"
              onClick={() => {
                edit({ title: draft.title, body: draft.body });
                setDraft(null);
                toast('Draft recovered');
              }}
            >
              Recover
            </Button>
            <Button
              onClick={() => {
                clearDraft(note.id);
                setDraft(null);
              }}
            >
              Discard
            </Button>
          </div>
        )}

        <input
          className="note-pane__title"
          aria-label="Note title"
          placeholder="Untitled"
          value={title}
          onChange={(e) => edit({ title: e.target.value })}
        />

        <SplitView
          editor={
            <MarkdownEditor
              value={body}
              onChange={(value) => edit({ body: value })}
              settings={editorSettings}
              onUpload={onUpload}
              extraExtensions={extraExtensions}
              placeholder="Tell a fable…"
            />
          }
          preview={
            <MarkdownPreview
              source={body}
              onToggleTask={onToggleTask}
              richMedia
              onImageClick={(src, alt) => setLightbox({ src, alt })}
            />
          }
        />

        <div className="note-pane__status" role="status">
          <span>
            {words} word{words === 1 ? '' : 's'} · {readingTimeMinutes(body)} min read
          </span>
          <span
            className={`note-pane__save note-pane__save--${autosave.status}`}
            data-testid="save-status"
          >
            {STATUS_LABEL[autosave.status]}
          </span>
        </div>
      </div>

      {showHistory && (
        <HistoryPanel
          noteId={note.id}
          onClose={() => setShowHistory(false)}
          onRestored={(restored) => {
            // One-click restore (F185): adopt the restored content locally;
            // the refetched note brings the new rev into the autosave tracker.
            setTitle(restored.title);
            setBody(restored.body);
          }}
        />
      )}

      <ConflictDialog
        conflict={autosave.conflict}
        onTheirs={() => {
          const theirs = autosave.conflict;
          autosave.acceptTheirs();
          if (theirs) {
            setTitle(theirs.title);
            setBody(theirs.body);
            invalidate(note.id);
          }
        }}
        onMine={() => void autosave.keepMine()}
      />

      <NoteInfoPanel note={note} body={body} open={showInfo} onClose={() => setShowInfo(false)} />

      <Dialog open={lightbox !== null} onClose={() => setLightbox(null)}>
        {lightbox && (
          <div className="lightbox" onClick={() => setLightbox(null)}>
            <img src={lightbox.src} alt={lightbox.alt} />
            <p>{lightbox.alt}</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
