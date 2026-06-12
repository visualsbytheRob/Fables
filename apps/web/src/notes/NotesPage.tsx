/**
 * The real Notes experience (F171/F179): three-pane layout — notebook tree +
 * tags | note list | editor + preview — wired to the live API, collapsing to
 * a single pane on phone widths. Deep links: /notes/:noteId (F180).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, FilePlus2, useToast } from '@fables/ui';
import type { Note, SavedQuery } from '../api/client.js';
import {
  useAttachments,
  useCreateNote,
  useDeleteNote,
  useDuplicateNote,
  useFqlQuery,
  useNote,
  useNotesInfinite,
  usePatchNote,
  useNotebookTree,
  useSavedQueries,
} from '../api/hooks.js';
import { useRegisterCommands } from '../commands/registry.js';
import { Skeleton } from '../components/Skeleton.js';
import { QueryBar } from '../query/QueryBar.js';
import { QueryResultsList } from '../query/QueryResultsList.js';
import { SavedQueriesSection } from '../query/SavedQueriesSection.js';
import { NoteList } from './NoteList.js';
import { NotebookTree } from './NotebookTree.js';
import { allNodes } from './notebookTreeModel.js';
import {
  loadDefaultNotebook,
  loadExpanded,
  loadRecents,
  loadSort,
  pushRecent,
  saveDefaultNotebook,
  saveExpanded,
  saveSort,
} from './prefs.js';
import { QuickSwitcher } from './QuickSwitcher.js';
import { TagSection, type TagFilter } from './TagSection.js';
import { TemplatePicker } from './TemplatePicker.js';
import { extractHashtags } from './text.js';
import './notes.css';

// The editor pane drags in CodeMirror + the markdown pipeline; load it only
// when a note is actually open (350KB gzip budget).
const NoteEditorPane = lazy(() =>
  import('./NoteEditorPane.js').then((m) => ({ default: m.NoteEditorPane })),
);

export function NotesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { noteId: routeNoteId } = useParams<{ noteId: string }>();
  const selectedNoteId = routeNoteId ?? null;

  const [notebookId, setNotebookId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [defaultNotebookId, setDefaultNotebookId] = useState<string | null>(loadDefaultNotebook);
  const [sort, setSort] = useState(loadSort);
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<TagFilter>({ names: [], mode: 'or' });
  const [attachmentsOnly, setAttachmentsOnly] = useState(false);
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const [focusMode, setFocusMode] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  // FQL query bar (F278): a non-empty active query swaps the note list for
  // query results; saved queries (F282) run through the same path.
  const [fqlDraft, setFqlDraft] = useState('');
  const [activeFql, setActiveFql] = useState<string | null>(null);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);

  const tree = useNotebookTree();
  const roots = useMemo(() => tree.data ?? [], [tree.data]);
  const notesQuery = useNotesInfinite({
    ...(notebookId !== null ? { notebookId } : {}),
    sort,
  });
  const note = useNote(selectedNoteId);
  const attachments = useAttachments();
  const fqlResults = useFqlQuery(activeFql);
  const savedQueries = useSavedQueries();
  const createNote = useCreateNote();
  const patchNote = usePatchNote();
  const deleteNote = useDeleteNote();
  const duplicateNote = useDuplicateNote();

  const notes = useMemo(
    () => (notesQuery.data?.pages ?? []).flatMap((p) => p.data),
    [notesQuery.data],
  );

  const fqlNotes = useMemo(
    () => (fqlResults.data?.pages ?? []).flatMap((p) => p.data),
    [fqlResults.data],
  );
  const fqlWarnings = fqlResults.data?.pages[0]?.warnings ?? [];
  const fqlError = fqlResults.isError ? fqlResults.error.message : null;

  const runFql = useCallback((q: string, savedId: string | null = null) => {
    setActiveFql(q === '' ? null : q);
    setActiveSavedId(q === '' ? null : savedId);
  }, []);

  const runSavedQuery = useCallback(
    (saved: SavedQuery) => {
      setFqlDraft(saved.fql);
      runFql(saved.fql, saved.id);
    },
    [runFql],
  );

  const pinnedSaved = useMemo(
    () => (savedQueries.data ?? []).filter((s) => s.pinned),
    [savedQueries.data],
  );

  // Tag filter (F155): AND/OR over body hashtags.
  const filteredNotes = useMemo(() => {
    if (tagFilter.names.length === 0) return notes;
    return notes.filter((n: Note) => {
      const tags = new Set(extractHashtags(n.body));
      return tagFilter.mode === 'and'
        ? tagFilter.names.every((name) => tags.has(name))
        : tagFilter.names.some((name) => tags.has(name));
    });
  }, [notes, tagFilter]);

  const attachmentNoteIds = useMemo(
    () =>
      new Set(
        (attachments.data?.data ?? [])
          .map((a) => a.noteId)
          .filter((id): id is string => id !== null),
      ),
    [attachments.data],
  );

  // Focus mode hides the app chrome via a body class (F194).
  useEffect(() => {
    document.body.classList.toggle('focus-mode', focusMode);
    return () => document.body.classList.remove('focus-mode');
  }, [focusMode]);

  const openNote = useCallback(
    (id: string) => {
      const go = () => {
        setRecents(pushRecent(id));
        navigate(`/notes/${id}`);
      };
      // Flush pending edits before switching notes (F188).
      const flush = flushRef.current;
      if (flush) void flush().finally(go);
      else go();
    },
    [navigate],
  );

  const captureNotebook =
    notebookId ??
    (defaultNotebookId && allNodes(roots).some((n) => n.id === defaultNotebookId)
      ? defaultNotebookId
      : (allNodes(roots)[0]?.id ?? null));

  const newNote = useCallback(
    (targetNotebookId?: string) => {
      const target = targetNotebookId ?? captureNotebook;
      if (!target) {
        toast('Create a notebook first', 'error');
        return;
      }
      createNote.mutate(
        { notebookId: target, title: '', body: '' },
        {
          onSuccess: (created) => openNote(created.id),
          onError: (err) => toast(`Create failed: ${err.message}`, 'error'),
        },
      );
    },
    [captureNotebook, createNote, openNote, toast],
  );

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveExpanded(next);
      return next;
    });
  };

  // Palette commands for note operations (F143/F199).
  const currentNote = note.data ?? null;
  useRegisterCommands([
    { id: 'new-note', label: 'New note', keywords: 'create write', run: () => newNote() },
    {
      id: 'new-from-template',
      label: 'New note from template',
      keywords: 'template create',
      run: () => setShowTemplates(true),
    },
    ...(currentNote
      ? [
          {
            id: 'duplicate-note',
            label: 'Duplicate current note',
            keywords: 'copy clone',
            run: () =>
              duplicateNote.mutate(currentNote.id, {
                onSuccess: (copy) => openNote(copy.id),
              }),
          },
          {
            id: 'trash-note',
            label: 'Move current note to trash',
            keywords: 'delete remove',
            run: () =>
              deleteNote.mutate(currentNote.id, {
                onSuccess: () => {
                  toast('Note moved to trash');
                  navigate('/');
                },
              }),
          },
          ...allNodes(roots)
            .filter((nb) => nb.id !== currentNote.notebookId)
            .slice(0, 15)
            .map((nb) => ({
              id: `move-note-${nb.id}`,
              label: `Move note to: ${nb.name}`,
              keywords: 'notebook move',
              run: () =>
                patchNote.mutate(
                  { id: currentNote.id, patch: { rev: currentNote.rev, notebookId: nb.id } },
                  { onSuccess: () => toast(`Moved to ${nb.name}`) },
                ),
            })),
        ]
      : []),
  ]);

  return (
    <div className={`notes-page${selectedNoteId ? ' notes-page--note-open' : ''}`}>
      {!focusMode && (
        <aside className="notes-page__nav">
          <div
            className="ui-row"
            style={{ justifyContent: 'space-between', padding: '0 var(--space-2)' }}
          >
            <strong style={{ fontSize: 'var(--text-sm)' }}>Notebooks</strong>
            <Button aria-label="New note" title="New note" onClick={() => newNote()}>
              <FilePlus2 size={14} />
            </Button>
          </div>
          <NotebookTree
            roots={roots}
            selectedId={notebookId}
            onSelect={(id) => setNotebookId(id)}
            expanded={expanded}
            onToggleExpanded={toggleExpanded}
            defaultNotebookId={defaultNotebookId}
            onSetDefault={(id) => {
              setDefaultNotebookId(id);
              saveDefaultNotebook(id);
              toast('Default capture notebook set');
            }}
            onNewNote={(id) => newNote(id)}
          />
          <TagSection filter={tagFilter} onFilterChange={setTagFilter} />
          <SavedQueriesSection
            onRun={runSavedQuery}
            activeId={activeSavedId}
            currentFql={fqlDraft}
          />
        </aside>
      )}

      {!focusMode && (
        <section className="notes-page__list" aria-label="Notes">
          {pinnedSaved.length > 0 && (
            <div className="fql-pinned" role="toolbar" aria-label="Pinned queries">
              {pinnedSaved.map((saved) => (
                <button
                  key={saved.id}
                  type="button"
                  className={`fql-pinned__chip${
                    saved.id === activeSavedId ? ' fql-pinned__chip--active' : ''
                  }`}
                  title={saved.fql}
                  onClick={() => runSavedQuery(saved)}
                >
                  <span aria-hidden>{saved.icon ?? '🔍'}</span>
                  {saved.name}
                </button>
              ))}
            </div>
          )}
          <QueryBar
            value={fqlDraft}
            onChange={setFqlDraft}
            onRun={(q) => runFql(q)}
            activeQuery={activeFql}
            warnings={fqlWarnings}
            error={fqlError}
          />
          {activeFql !== null && (
            <QueryResultsList
              notes={fqlNotes}
              selectedNoteId={selectedNoteId}
              onOpen={openNote}
              isLoading={fqlResults.isLoading}
              hasMore={fqlResults.hasNextPage ?? false}
              onLoadMore={() => void fqlResults.fetchNextPage()}
            />
          )}
          {activeFql === null && (
            <NoteList
              notes={filteredNotes}
              roots={roots}
              selectedNoteId={selectedNoteId}
              onOpen={openNote}
              recents={recents}
              sort={sort}
              onSortChange={(s) => {
                setSort(s);
                saveSort(s);
              }}
              query={query}
              onQueryChange={setQuery}
              attachmentNoteIds={attachmentNoteIds}
              attachmentsOnly={attachmentsOnly}
              onAttachmentsOnlyChange={setAttachmentsOnly}
              hasMore={notesQuery.hasNextPage ?? false}
              onLoadMore={() => void notesQuery.fetchNextPage()}
            />
          )}
        </section>
      )}

      <section className="notes-page__editor" aria-label="Editor">
        {selectedNoteId && (
          <button type="button" className="notes-page__back" onClick={() => navigate('/')}>
            ← Notes
          </button>
        )}
        {!selectedNoteId && (
          <div className="notes-page__empty">
            <p>Select a note, or create one.</p>
            <div className="ui-row" style={{ justifyContent: 'center' }}>
              <Button variant="primary" onClick={() => newNote()}>
                New note
              </Button>
              <Button onClick={() => setShowTemplates(true)}>From template…</Button>
            </div>
          </div>
        )}
        {selectedNoteId && note.isError && (
          <div className="notes-page__empty">
            <p>Could not load that note — it may have been deleted.</p>
          </div>
        )}
        {currentNote && (
          <Suspense fallback={<Skeleton height={320} />}>
            <NoteEditorPane
              key={currentNote.id}
              note={currentNote}
              roots={roots}
              onSelectNotebook={(id) => setNotebookId(id)}
              focusMode={focusMode}
              onToggleFocusMode={() => setFocusMode((v) => !v)}
              flushRef={flushRef}
            />
          </Suspense>
        )}
      </section>

      <QuickSwitcher onOpen={openNote} />
      <TemplatePicker
        open={showTemplates}
        roots={roots}
        targetNotebookId={captureNotebook ?? ''}
        onCreated={openNote}
        onClose={() => setShowTemplates(false)}
      />
    </div>
  );
}
