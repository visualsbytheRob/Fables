/**
 * Editor pane for a loaded note: title + markdown editor + live preview,
 * debounced autosave with rev tracking (F181), conflict prompt (F182),
 * revision history (F183–F185), draft recovery (F186), force-save (F189),
 * breadcrumbs (F148), status bar (F193), focus mode (F194), export/copy
 * (F195/F196), info panel (F197), pin (F178), attachment upload (F161/F127),
 * tag autocomplete (F153), and an image lightbox (F166).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button,
  ClipboardCopy,
  Dialog,
  Download,
  History,
  Info,
  Link2,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  useToast,
} from '@fables/ui';
import { EditorView, keymap, Prec } from '@uiw/react-codemirror';
import type { Extension } from '@uiw/react-codemirror';
import {
  attachmentsApi,
  attachmentUrl,
  type NotebookTreeNode,
  type NoteWithTags,
} from '../api/client.js';
import {
  useCreateNote,
  useInvalidateNotes,
  useNoteIndex,
  usePatchNote,
  useTags,
} from '../api/hooks.js';
import { useRegisterCommands } from '../commands/registry.js';
import { MarkdownEditor } from '../editor/MarkdownEditor.js';
import { loadEditorSettings } from '../editor/settings.js';
import { wikilinkAutocomplete } from '../editor/wikilinkAutocomplete.js';
import { wikilinkClickExtension } from '../editor/wikilinkClick.js';
import { buildTitleIndex, resolveTitle } from '../links/wikilinks.js';
import { MarkdownPreview, type WikilinkHandlers } from '../preview/MarkdownPreview.js';
import { SplitView } from '../preview/SplitView.js';
import { toggleTaskAtLine } from '../preview/tasks.js';
import { BacklinksPanel } from './BacklinksPanel.js';
import { ConflictDialog } from './ConflictDialog.js';
import { recoverableDraft, clearDraft, type Draft } from './drafts.js';
import { copyAsHtml, copyText, downloadMarkdown, noteToMarkdown } from './exporters.js';
import { HistoryPanel } from './HistoryPanel.js';
import { NoteInfoPanel } from './NoteInfoPanel.js';
import { breadcrumb } from './notebookTreeModel.js';
import { loadBacklinksPanel, saveBacklinksPanel } from './prefs.js';
import { tagAutocomplete } from './tagAutocomplete.js';
import { TemplatePicker } from './TemplatePicker.js';
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [draft, setDraft] = useState<Draft | null>(() =>
    recoverableDraft(note.id, { title: note.title, body: note.body }),
  );
  const [showHistory, setShowHistory] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showBacklinks, setShowBacklinks] = useState(() => loadBacklinksPanel().open);
  const [showInsertTemplate, setShowInsertTemplate] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [editorSettings] = useState(loadEditorSettings);
  const autosave = useAutosave(note);
  const patchNote = usePatchNote();
  const createNote = useCreateNote();
  const invalidate = useInvalidateNotes();
  const tags = useTags();
  const noteIndex = useNoteIndex();
  const viewRef = useRef<EditorView | null>(null);

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

  /* ===== Wikilinks (F203/F204/F206) ===== */

  const titleIndex = useMemo(() => buildTitleIndex(noteIndex.data ?? []), [noteIndex.data]);

  // Navigate to a note title: open it when it exists, create-then-open when
  // broken (F206). Pending edits flush first so links in them resolve.
  const openTarget = useCallback(
    (target: string) => {
      const go = (id: string) => navigate(`/notes/${id}`);
      const existing = resolveTitle(titleIndex, target);
      if (existing !== null) {
        void flush().finally(() => go(existing));
        return;
      }
      createNote.mutate(
        { notebookId: note.notebookId, title: target, body: '' },
        {
          onSuccess: (created) => {
            toast(`Created “${target}”`);
            void flush().finally(() => go(created.id));
          },
          onError: (err) => toast(`Create failed: ${err.message}`, 'error'),
        },
      );
    },
    [titleIndex, createNote, note.notebookId, navigate, toast, flush],
  );

  const wikilinkHandlers = useMemo<WikilinkHandlers>(
    () => ({
      resolve: (target) => resolveTitle(titleIndex, target),
      onNavigate: (noteId) => {
        void flush().finally(() => navigate(`/notes/${noteId}`));
      },
      onCreate: openTarget,
    }),
    [titleIndex, navigate, openTarget, flush],
  );

  // Open-at-position (F215): /notes/:id?pos=N scrolls the editor to the
  // offset once CodeMirror has mounted, then strips the param.
  useEffect(() => {
    const raw = searchParams.get('pos');
    if (raw === null) return;
    const pos = Number(raw);
    let cancelled = false;
    let tries = 0;
    const attempt = () => {
      if (cancelled) return;
      const view = viewRef.current;
      if (!view) {
        if ((tries += 1) < 40) setTimeout(attempt, 50);
        return;
      }
      const clamped = Math.max(0, Math.min(pos, view.state.doc.length));
      view.dispatch({
        selection: { anchor: clamped },
        effects: EditorView.scrollIntoView(clamped, { y: 'center' }),
      });
      view.focus();
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('pos');
          return next;
        },
        { replace: true },
      );
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams]);

  const toggleBacklinks = useCallback(() => {
    setShowBacklinks((open) => {
      const next = !open;
      saveBacklinksPanel({ ...loadBacklinksPanel(), open: next });
      return next;
    });
  }, []);

  // Insert a rendered template at the cursor (F264).
  const insertAtCursor = useCallback(
    (text: string, cursorOffset: number | null) => {
      const view = viewRef.current;
      if (!view) return;
      const at = view.state.selection.main.from;
      const caret = at + (cursorOffset ?? text.length);
      view.dispatch({
        changes: { from: at, to: view.state.selection.main.to, insert: text },
        selection: { anchor: caret },
        userEvent: 'input',
        scrollIntoView: true,
      });
      view.focus();
      edit({ body: view.state.doc.toString() });
    },
    [edit],
  );

  // Tag autocomplete (F153) over the live tag list + wikilink completion on
  // `[[` (F203) + Cmd/Ctrl-click wikilink navigation (F204).
  const tagNamesRef = useRef<string[]>([]);
  tagNamesRef.current = (tags.data ?? []).map((t) => t.name);
  const noteTitlesRef = useRef<string[]>([]);
  noteTitlesRef.current = (noteIndex.data ?? []).map((n) => n.title);
  const openTargetRef = useRef(openTarget);
  openTargetRef.current = openTarget;
  const extraExtensions = useMemo<Extension[]>(
    () => [
      tagAutocomplete(() => tagNamesRef.current),
      wikilinkAutocomplete(() => noteTitlesRef.current),
      wikilinkClickExtension((link) => openTargetRef.current(link.target)),
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
      id: 'note-backlinks',
      label: 'Toggle backlinks panel',
      keywords: 'connections links mentions graph',
      run: toggleBacklinks,
    },
    {
      id: 'note-insert-template',
      label: 'Insert template at cursor…',
      keywords: 'snippet template insert',
      run: () => setShowInsertTemplate(true),
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
    <div
      className={`note-pane${showHistory ? ' note-pane--history' : ''}${
        showBacklinks ? ' note-pane--connections' : ''
      }`}
    >
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
              <Button
                title="Backlinks & connections"
                aria-label="Backlinks"
                aria-pressed={showBacklinks}
                onClick={toggleBacklinks}
              >
                <Link2 size={14} />
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
              viewRef={viewRef}
              placeholder="Tell a fable…"
            />
          }
          preview={
            <MarkdownPreview
              source={body}
              onToggleTask={onToggleTask}
              richMedia
              onImageClick={(src, alt) => setLightbox({ src, alt })}
              wikilinks={wikilinkHandlers}
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

      {showBacklinks && (
        <BacklinksPanel
          noteId={note.id}
          onOpenAt={(sourceId, position) => {
            void flush().finally(() => navigate(`/notes/${sourceId}?pos=${position}`));
          }}
          onClose={toggleBacklinks}
        />
      )}

      <TemplatePicker
        open={showInsertTemplate}
        roots={roots}
        targetNotebookId={note.notebookId}
        mode="insert"
        noteTitle={title}
        onInsert={insertAtCursor}
        onClose={() => setShowInsertTemplate(false)}
      />

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
