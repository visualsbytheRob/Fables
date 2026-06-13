/**
 * Author workspace (F511–F520): file tree | multi-tab Forge editor | side
 * pane (live playtest / scene graph), with a compile status bar, cross-file
 * problems panel with quick fixes, story-wide search & replace, a snippet
 * palette and an editor split view. Compilation and playtesting are fully
 * client-side; the server only persists files (debounced PUT autosave).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import CodeMirror, { EditorSelection, EditorView } from '@uiw/react-codemirror';
import type { Extension, ViewUpdate } from '@uiw/react-codemirror';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Columns2,
  Dialog,
  FileCode2,
  FilePlus2,
  Input,
  Network,
  Play,
  Regex as RegexIcon,
  Search,
  Select,
  Wand2,
  useTheme,
  useToast,
} from '@fables/ui';
import { useNavigate, useParams } from 'react-router-dom';
import type { FileProvider } from '@fables/forge-dsl';
import { Skeleton } from '../components/Skeleton.js';
import { forge } from '../forge/index.js';
import { storiesApi } from './api.js';
import { buildProject, firstProblem, type ProjectBuild, type ProjectProblem } from './build.js';
import { quickFixesFor, type QuickFix } from './quickfix.js';
import { replaceInFiles, searchFiles, type SearchMatch } from './search.js';
import { insertSnippet, SNIPPETS } from './snippets.js';
import { WorkspaceStore } from './store.js';
import { PlaytestPane } from './playtest/PlaytestPane.js';
import { SceneGraphView } from './SceneGraphView.js';
import './stories.css';

export const AUTOSAVE_IDLE_MS = 800;
export const PROJECT_COMPILE_IDLE_MS = 350;

const DEFAULT_SOURCE = `# title: New story

-> start

=== start ===
Write your opening here.
-> END
`;

/** One CodeMirror pane bound to a store buffer (F512/F518). */
function EditorPane({
  store,
  path,
  registerView,
}: {
  store: WorkspaceStore;
  path: string;
  registerView: (path: string, view: EditorView | null) => void;
}) {
  const { resolved } = useTheme();
  const storeRef = useRef(store);
  storeRef.current = store;

  const extensions = useMemo<Extension[]>(() => {
    // Resolve INCLUDEs against the live buffers at compile time.
    const provider: FileProvider = {
      resolve(includePath) {
        const sources = storeRef.current.sources();
        const exact = sources.get(includePath);
        if (exact !== undefined) return { fileName: includePath, source: exact };
        const base = includePath.split('/').pop() ?? includePath;
        for (const [name, source] of sources) {
          if (name === base || name.split('/').pop() === base) return { fileName: name, source };
        }
        return null;
      },
    };
    return [
      forge({ compile: { fileName: path, files: provider } }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) storeRef.current.updateSource(path, update.state.doc.toString());
      }),
    ];
  }, [path]);

  useEffect(() => () => registerView(path, null), [path, registerView]);

  const source = store.file(path)?.source ?? '';
  return (
    <div className="story-editor-pane" data-testid={`editor-${path}`}>
      <CodeMirror
        value={source}
        theme={resolved}
        height="100%"
        extensions={extensions}
        indentWithTab={false}
        onCreateEditor={(view) => registerView(path, view)}
        basicSetup={{ lineNumbers: true, foldGutter: false }}
      />
    </div>
  );
}

export function StoryEditPage() {
  const { storyId = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const storeRef = useRef<WorkspaceStore | null>(null);
  if (storeRef.current === null) storeRef.current = new WorkspaceStore();
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.getState);

  const viewsRef = useRef(new Map<string, EditorView>());
  const registerView = useCallback((path: string, view: EditorView | null) => {
    if (view === null) viewsRef.current.delete(path);
    else viewsRef.current.set(path, view);
  }, []);

  const [sidePane, setSidePane] = useState<'playtest' | 'graph'>('playtest');
  const [showProblems, setShowProblems] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [offline, setOffline] = useState(false);

  // ── load project from the server (graceful offline fallback) ────────────
  const storyQuery = useQuery({
    queryKey: ['stories', storyId],
    queryFn: () => storiesApi.get(storyId),
    retry: false,
  });
  const filesQuery = useQuery({
    queryKey: ['stories', storyId, 'files'],
    queryFn: () => storiesApi.files(storyId),
    retry: false,
  });

  const entryPath = storyQuery.data?.entryFile ?? 'main.fable';
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    if (filesQuery.data !== undefined) {
      loadedRef.current = true;
      if (filesQuery.data.length === 0) {
        store.init([{ id: null, path: entryPath, source: DEFAULT_SOURCE }], entryPath);
      } else {
        store.init(
          filesQuery.data.map((f) => ({ id: f.id, path: f.path, source: f.source })),
          entryPath,
        );
      }
    } else if (filesQuery.isError) {
      // Server unreachable: the workspace still works fully client-side.
      loadedRef.current = true;
      setOffline(true);
      store.init([{ id: null, path: entryPath, source: DEFAULT_SOURCE }], entryPath);
    }
  }, [filesQuery.data, filesQuery.isError, entryPath, store]);

  // ── client-side project compile, debounced on edits (F513/F514) ─────────
  const [build, setBuild] = useState<ProjectBuild | null>(null);
  useEffect(() => {
    if (state.files.size === 0) return;
    const timer = setTimeout(
      () => setBuild(buildProject(store.sources(), entryPath)),
      build === null ? 0 : PROJECT_COMPILE_IDLE_MS,
    );
    return () => clearTimeout(timer);
  }, [state.version, entryPath]);

  // ── autosave: debounced PUT per dirty file (F519) ────────────────────────
  const saveErrorToastRef = useRef(false);
  useEffect(() => {
    if (offline || state.files.size === 0) return;
    const timer = setTimeout(() => {
      for (const path of store.dirtyPaths()) {
        const buf = store.file(path);
        if (buf === undefined) continue;
        const { source } = buf;
        store.setSaveState(path, 'saving');
        const request =
          buf.id === null
            ? storiesApi.createFile(storyId, { path, source })
            : storiesApi.saveFile(storyId, buf.id, source);
        request
          .then((saved) => store.markSaved(path, source, saved.id))
          .catch(() => {
            store.setSaveState(path, 'error');
            if (!saveErrorToastRef.current) {
              saveErrorToastRef.current = true;
              toast('autosave failed — changes are kept locally');
            }
          });
      }
    }, AUTOSAVE_IDLE_MS);
    return () => clearTimeout(timer);
  }, [state.version, offline, storyId]);

  // ── navigation helpers ───────────────────────────────────────────────────
  const pendingJumpRef = useRef<{ path: string; offset: number } | null>(null);
  const jumpTo = useCallback(
    (path: string, offset: number) => {
      store.openTab(path);
      const attempt = (): boolean => {
        const view = viewsRef.current.get(path);
        if (view === undefined) return false;
        const pos = Math.min(offset, view.state.doc.length);
        view.dispatch({
          selection: EditorSelection.cursor(pos),
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
        view.focus();
        return true;
      };
      if (!attempt()) {
        pendingJumpRef.current = { path, offset };
        setTimeout(() => {
          if (pendingJumpRef.current?.path === path) {
            attempt();
            pendingJumpRef.current = null;
          }
        }, 50);
      }
    },
    [store],
  );

  const jumpToLine = useCallback(
    (path: string, line: number) => {
      const source = store.file(path)?.source;
      if (source === undefined) return;
      const offsets = source.split('\n');
      let offset = 0;
      for (let i = 0; i < Math.min(line - 1, offsets.length); i++) {
        offset += (offsets[i] as string).length + 1;
      }
      jumpTo(path, offset);
    },
    [store, jumpTo],
  );

  const jumpToProblem = useCallback(
    (problem: ProjectProblem) => jumpTo(problem.file, problem.diagnostic.span.start.offset),
    [jumpTo],
  );

  const applyFix = useCallback(
    (problem: ProjectProblem, fix: QuickFix) => {
      const view = viewsRef.current.get(problem.file);
      if (view !== undefined && state.tabs.includes(problem.file)) {
        view.dispatch({ changes: { from: fix.from, to: fix.to, insert: fix.insert } });
      } else {
        store.applyEdit(problem.file, fix.from, fix.to, fix.insert);
      }
      toast(fix.title);
    },
    [store, state.tabs, toast],
  );

  const insertSnippetAtCursor = useCallback(
    (snippetId: string) => {
      const snippet = SNIPPETS.find((s) => s.id === snippetId);
      const active = store.getState().active;
      if (snippet === undefined || active === null) return;
      const view = viewsRef.current.get(active);
      if (view !== undefined) {
        const at = view.state.selection.main.head;
        view.dispatch({
          changes: { from: at, insert: snippet.body },
          selection: EditorSelection.cursor(at + snippet.caret),
        });
        view.focus();
      } else {
        const buf = store.file(active);
        if (buf === undefined) return;
        const { text } = insertSnippet(buf.source, buf.source.length, snippet);
        store.updateSource(active, text);
      }
      setSnippetsOpen(false);
    },
    [store],
  );

  // ── search state (F516) ──────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [regexMode, setRegexMode] = useState(false);
  const matches: SearchMatch[] = useMemo(
    () => (showSearch && query !== '' ? searchFiles(store.sources(), query, { regex: regexMode }) : []),
    [showSearch, query, regexMode, state.version],
  );

  if (storyQuery.isLoading || (filesQuery.isLoading && !offline)) {
    return <Skeleton height={400} />;
  }

  const title = storyQuery.data?.title ?? 'Story';
  const dirtyCount = store.dirtyPaths().length;
  const saving = [...state.saveStates.values()].some((s) => s === 'saving');
  const paths = [...state.files.keys()].sort();

  return (
    <div className="story-workspace">
      <div className="story-workspace-header">
        <h1>
          <button
            onClick={() => navigate('/stories')}
            style={{ background: 'none', border: 0, color: 'var(--text-dim)', cursor: 'pointer', font: 'inherit' }}
          >
            Stories /
          </button>{' '}
          {title}
        </h1>
        {offline ? <span className="story-status status-broken">offline — local only</span> : null}
        <Button onClick={() => setShowSearch((v) => !v)} title="Story-wide search & replace (F516)">
          <Search size={14} /> Search
        </Button>
        <Button onClick={() => setSnippetsOpen(true)} title="Insert snippet (F517)">
          <Wand2 size={14} /> Snippet
        </Button>
        <Button
          onClick={() => store.setSplit(state.split === null ? state.active : null)}
          title="Split editor (F518)"
          className={state.split !== null ? 'regex-toggle on' : ''}
        >
          <Columns2 size={14} /> Split
        </Button>
      </div>

      <div className="story-workspace-body">
        {/* file tree */}
        <aside className="story-pane story-filetree" aria-label="Project files">
          <div className="story-filetree-title">Files</div>
          {paths.map((path) => (
            <button
              key={path}
              className={`story-file${state.active === path ? ' active' : ''}`}
              onClick={() => store.openTab(path)}
            >
              <FileCode2 size={13} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{path}</span>
              {store.isDirty(path) ? <span className="dirty-dot" title="unsaved changes" /> : null}
              {path === entryPath ? <span className="entry-mark">entry</span> : null}
            </button>
          ))}
          <Button onClick={() => setNewFileOpen(true)} style={{ marginTop: 8, width: '100%' }}>
            <FilePlus2 size={13} /> New file
          </Button>
        </aside>

        {/* editor area */}
        <section className="story-editor-area">
          <div className="story-tabbar" role="tablist" aria-label="Open files">
            {state.tabs.map((path) => (
              <span
                key={path}
                className={`story-tab${state.active === path ? ' active' : ''}`}
                role="tab"
                aria-selected={state.active === path}
              >
                <button
                  style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}
                  onClick={() => store.setActive(path)}
                >
                  {path}
                  {store.isDirty(path) ? <span className="dirty-dot" title="unsaved changes" /> : null}
                </button>
                <button
                  className="tab-close"
                  aria-label={`Close ${path}`}
                  onClick={() => store.closeTab(path)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="story-editors">
            {state.active !== null ? (
              <EditorPane key={state.active} store={store} path={state.active} registerView={registerView} />
            ) : (
              <p style={{ padding: 16, color: 'var(--text-dim)' }}>Open a file to start writing.</p>
            )}
            {state.split !== null && state.files.has(state.split) ? (
              <div className="story-editor-pane" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="story-split-header">
                  <Select
                    value={state.split}
                    onChange={(e) => store.setSplit(e.target.value)}
                    aria-label="Split pane file"
                  >
                    {paths.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </div>
                <EditorPane
                  key={`split:${state.split}`}
                  store={store}
                  path={state.split}
                  registerView={(p, v) => registerView(`split:${p}`, v)}
                />
              </div>
            ) : null}
          </div>

          {/* status bar (F513) */}
          <div className="story-statusbar" data-testid="compile-status">
            <button
              onClick={() => {
                if (build === null) return;
                const problem = firstProblem(build);
                if (problem !== null) jumpToProblem(problem);
              }}
              title="Jump to first problem"
            >
              <span className={build !== null && build.errors > 0 ? 'has-errors' : ''}>
                {build?.errors ?? 0} errors
              </span>
              <span className={build !== null && build.warnings > 0 ? 'has-warnings' : ''}>
                {build?.warnings ?? 0} warnings
              </span>
            </button>
            <button onClick={() => setShowProblems((v) => !v)}>
              {showProblems ? 'hide' : 'show'} problems
            </button>
            <span style={{ flex: 1 }} />
            <span className={dirtyCount === 0 && !saving ? 'save-ok' : ''} data-testid="save-status">
              {offline
                ? 'local only'
                : saving
                  ? 'saving…'
                  : dirtyCount > 0
                    ? `${dirtyCount} unsaved`
                    : 'all changes saved'}
            </span>
          </div>

          {/* problems panel (F514/F515) */}
          {showProblems ? (
            <div className="story-pane story-problems" data-testid="problems-panel">
              {build === null || build.problems.length === 0 ? (
                <p style={{ margin: 4, fontSize: 12, color: 'var(--text-dim)' }}>
                  No problems — the compiler is content.
                </p>
              ) : (
                <ul>
                  {build.problems.map((problem, i) => {
                    const d = problem.diagnostic;
                    const source = store.file(problem.file)?.source ?? '';
                    const fixes = quickFixesFor(d, source);
                    return (
                      <li key={`${problem.file}-${d.code}-${d.span.start.offset}-${i}`} className={`story-problem severity-${d.severity}`}>
                        <button className="problem-row" onClick={() => jumpToProblem(problem)}>
                          <span className="problem-loc">
                            {problem.file}:{d.span.start.line}
                          </span>
                          <span className="problem-code">{d.code}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.message}</span>
                        </button>
                        {fixes.map((fix) => (
                          <Button key={fix.title} className="quickfix" onClick={() => applyFix(problem, fix)} title="Quick fix (F515)">
                            <Wand2 size={11} /> {fix.title}
                          </Button>
                        ))}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}

          {/* search & replace (F516) */}
          {showSearch ? (
            <div className="story-pane story-search" data-testid="search-panel">
              <div className="story-search-controls">
                <Input
                  placeholder="Search all files…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search query"
                />
                <Button
                  className={regexMode ? 'regex-toggle on' : ''}
                  onClick={() => setRegexMode((v) => !v)}
                  title="Regular expression"
                  aria-pressed={regexMode}
                >
                  <RegexIcon size={14} />
                </Button>
              </div>
              <div className="story-search-controls">
                <Input
                  placeholder="Replace with…"
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                  aria-label="Replacement"
                />
                <Button
                  onClick={() => {
                    const changed = replaceInFiles(store.sources(), query, replacement, { regex: regexMode });
                    store.applySources(changed);
                    toast(`replaced in ${changed.size} file${changed.size === 1 ? '' : 's'}`);
                  }}
                  disabled={query === '' || matches.length === 0}
                >
                  Replace all
                </Button>
              </div>
              <div className="story-search-results">
                {matches.map((match, i) => (
                  <button key={i} onClick={() => jumpTo(match.path, match.from)}>
                    <span className="match-loc">
                      {match.path}:{match.line}
                    </span>
                    {match.lineText.trim()}
                  </button>
                ))}
                {query !== '' && matches.length === 0 ? (
                  <p style={{ margin: 4, color: 'var(--text-dim)' }}>No matches.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {/* side pane: playtest / scene graph */}
        <aside className="story-pane story-sidepane" aria-label="Story tools">
          <div className="story-sidepane-tabs">
            <button className={sidePane === 'playtest' ? 'active' : ''} onClick={() => setSidePane('playtest')}>
              <Play size={13} /> Playtest
            </button>
            <button className={sidePane === 'graph' ? 'active' : ''} onClick={() => setSidePane('graph')}>
              <Network size={13} /> Graph
            </button>
          </div>
          <div className="story-sidepane-content">
            {sidePane === 'playtest' ? (
              <PlaytestPane
                storyId={storyId}
                sources={store.sources()}
                entryPath={entryPath}
                version={state.version}
                onJumpToSource={jumpToLine}
              />
            ) : (
              <SceneGraphView
                result={build?.entry ?? null}
                onOpenKnot={(file, offset) => jumpTo(file ?? entryPath, offset)}
              />
            )}
          </div>
        </aside>
      </div>

      {/* snippet palette (F517) */}
      <Dialog open={snippetsOpen} onClose={() => setSnippetsOpen(false)}>
        <div className="snippet-list">
          <h3 style={{ margin: '0 0 8px' }}>Insert snippet</h3>
          {SNIPPETS.map((snippet) => (
            <button key={snippet.id} onClick={() => insertSnippetAtCursor(snippet.id)}>
              <strong>{snippet.label}</strong>
              <span className="snippet-detail">{snippet.detail}</span>
            </button>
          ))}
        </div>
      </Dialog>

      {/* new file dialog */}
      <Dialog open={newFileOpen} onClose={() => setNewFileOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = newFileName.trim();
            if (name === '') return;
            const path = name.endsWith('.fable') ? name : `${name}.fable`;
            store.addFile(path, `=== ${path.replace(/\.fable$/, '').replace(/[^A-Za-z0-9_]/g, '_')} ===\n-> END\n`);
            setNewFileName('');
            setNewFileOpen(false);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 280 }}
        >
          <h3 style={{ margin: 0 }}>New file</h3>
          <Input
            autoFocus
            placeholder="chapter-two.fable"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            aria-label="File name"
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button type="button" onClick={() => setNewFileOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Create
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
