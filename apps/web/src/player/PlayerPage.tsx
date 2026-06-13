/**
 * The story player (F541–F550): a distraction-free, phone-first reading flow
 * over the forge-vm. Stories compile client-side from the server's files;
 * rendering is a pure function of the VM transcript, so continue, restore,
 * rewind and replay all share one path. Reading position autosaves to the
 * server's ring buffer on every choice (F549).
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Menu as MenuIcon, Square, Volume2, useToast } from '@fables/ui';
import { useNavigate, useParams } from 'react-router-dom';
import type { Story } from '@fables/forge-vm';
import { Skeleton } from '../components/Skeleton.js';
import { storiesApi } from '../stories/api.js';
import type { StoryFile, StoryProject } from '../stories/api.js';
import { buildProject } from '../stories/build.js';
import { buildSceneGraph } from '../stories/sceneGraph.js';
import { savesApi } from './api.js';
import {
  SaveError,
  blocksFrom,
  chooseAndContinue,
  compileForPlay,
  currentScene,
  endingOf,
  knotProgress,
  pickSeed,
  plainTranscript,
  resumeSession,
  rewindTo,
  startSession,
  statValues,
} from './engine.js';
import type { PlayerBlock } from './engine.js';
import { EndScreen } from './EndScreen.js';
import {
  BookmarksPanel,
  ComparePanel,
  HistoryPanel,
  TranscriptPanel,
} from './HistorySheets.js';
import {
  InfoPanel,
  MenuSheet,
  SavesPanel,
  SettingsPanel,
  type PlayerPanel,
} from './PlayerSheets.js';
import {
  PACING_MS,
  PLAYER_THEMES,
  bumpStats,
  loadEndings,
  loadLibraryMeta,
  loadPrefs,
  recordEnding,
  recordPlaythrough,
  recordRecent,
  savePrefs,
  type PlayerTheme,
  type ReaderPrefs,
} from './prefs.js';
import { parseStatTags, sceneHue } from './tags.js';
import { speakParagraphs } from './tts.js';
import type { TtsHandle } from './tts.js';
import './player.css';

/** Render-error fence so a broken story never takes the app down (F548). */
class PlayerBoundary extends Component<
  { onExit: () => void; children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error !== null) {
      return (
        <div className="player-gate">
          <h1>This story hit a snag</h1>
          <p className="player-gate-sub">
            The player could not continue. The story may have a bug — your reading position is
            autosaved.
          </p>
          <div className="player-error">
            <code>{this.state.error.message}</code>
          </div>
          <div className="player-gate-actions">
            <Button onClick={() => this.setState({ error: null })}>Try again</Button>
            <Button onClick={this.props.onExit}>Back to library</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PlayerPage() {
  const { storyId = '' } = useParams();

  const storyQuery = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => storiesApi.get(storyId),
  });
  const filesQuery = useQuery({
    queryKey: ['story-files', storyId],
    queryFn: () => storiesApi.files(storyId),
  });
  const autosavesQuery = useQuery({
    queryKey: ['story-saves', storyId, 'auto'],
    queryFn: () => savesApi.list(storyId, 'auto'),
  });

  if (storyQuery.isLoading || filesQuery.isLoading || autosavesQuery.isLoading) {
    return <Skeleton height={320} />;
  }
  if (storyQuery.data === undefined || filesQuery.data === undefined) {
    return (
      <div>
        <h1>Story unavailable</h1>
        <p style={{ color: 'var(--text-dim)' }}>
          Could not load this story from the server — check that it is running.
        </p>
      </div>
    );
  }
  return (
    <Player
      story={storyQuery.data}
      files={filesQuery.data}
      hasAutosave={(autosavesQuery.data ?? []).length > 0}
      latestAutosaveId={autosavesQuery.data?.[0]?.id ?? null}
    />
  );
}

function Player({
  story,
  files,
  hasAutosave,
  latestAutosaveId,
}: {
  story: StoryProject;
  files: StoryFile[];
  hasAutosave: boolean;
  latestAutosaveId: string | null;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const storyId = story.id;

  /* ── compile (F541) ──────────────────────────────────────────────────── */
  const sources = useMemo(() => new Map(files.map((f) => [f.path, f.source])), [files]);
  const build = useMemo(() => compileForPlay(sources, story.entryFile), [sources, story.entryFile]);
  const statDefs = useMemo(
    () => parseStatTags(sources.get(story.entryFile) ?? ''),
    [sources, story.entryFile],
  );
  /** Static endings count for the collection hints (F568), via the scene graph. */
  const totalEndings = useMemo(() => {
    try {
      const project = buildProject(sources, story.entryFile);
      return project.entry !== null ? buildSceneGraph(project.entry).stats.endings : null;
    } catch {
      return null;
    }
  }, [sources, story.entryFile]);

  /* ── reader prefs + theme (F551–F553) ────────────────────────────────── */
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => loadPrefs());
  const updatePrefs = useCallback((next: ReaderPrefs) => {
    setPrefs(next);
    savePrefs(next);
  }, []);
  const storyTheme = story.settings?.theme ?? null;
  const effectiveTheme: PlayerTheme = (PLAYER_THEMES as readonly string[]).includes(
    storyTheme ?? '',
  )
    ? (storyTheme as PlayerTheme)
    : prefs.theme;

  /* ── VM session ──────────────────────────────────────────────────────── */
  const vmRef = useRef<Story | null>(null);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [phase, setPhase] = useState<'gate' | 'playing'>(hasAutosave ? 'gate' : 'playing');
  const [revealed, setRevealed] = useState(0);
  const [panel, setPanel] = useState<PlayerPanel | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [endings, setEndings] = useState(() => loadEndings(storyId));
  const endingRecordedRef = useRef(false);
  const madeChoiceRef = useRef(false);

  const vm = vmRef.current;
  const blocks: PlayerBlock[] = useMemo(
    () => (vm === null ? [] : blocksFrom(vm.transcript())),
    [vm, vm?.transcript().length],
  );

  /** Persist reading position to the autosave ring + continue rail (F549/F575). */
  const persist = useCallback(
    (session: Story) => {
      const state = session.saveState();
      void savesApi
        .autosave(storyId, state)
        .then(() => queryClient.invalidateQueries({ queryKey: ['story-saves', storyId, 'auto'] }))
        .catch(() => undefined); // offline play keeps working; the ring catches up next time
      const frame = state.frames[state.frames.length - 1];
      recordRecent({
        storyId,
        title: story.title,
        scene: frame?.container.split('#')[0] ?? '',
        turn: state.turn,
        at: new Date().toISOString(),
      });
    },
    [storyId, story.title, queryClient],
  );

  const beginFresh = useCallback(() => {
    if (build.program === null) return;
    try {
      vmRef.current = startSession(build.program, pickSeed(story.settings));
      endingRecordedRef.current = false;
      madeChoiceRef.current = false;
      setRuntimeError(null);
      setRevealed(0);
      setPhase('playing');
      bumpStats(storyId, { runsStarted: 1 });
      bump();
    } catch (e) {
      setRuntimeError(e instanceof Error ? e.message : String(e));
      setPhase('playing');
    }
  }, [build.program, story.settings, storyId, bump]);

  const restoreFromSave = useCallback(
    async (saveId: string) => {
      if (build.program === null) return;
      try {
        const save = await savesApi.get(storyId, saveId);
        const session = resumeSession(build.program, save.state);
        vmRef.current = session;
        endingRecordedRef.current = session.status === 'done';
        madeChoiceRef.current = false;
        setRuntimeError(null);
        setRevealed(blocksFrom(session.transcript()).length);
        setPanel(null);
        setPhase('playing');
        bump();
      } catch (e) {
        const message =
          e instanceof SaveError
            ? 'That save was made against an older version of this story — start fresh instead.'
            : e instanceof Error
              ? e.message
              : String(e);
        toast(message);
      }
    },
    [build.program, storyId, toast, bump],
  );

  // No autosave → straight into a fresh run (F544).
  useEffect(() => {
    if (phase === 'playing' && vmRef.current === null && runtimeError === null) beginFresh();
  }, [phase, beginFresh, runtimeError]);

  /* ── progressive reveal (F542) ───────────────────────────────────────── */
  const delay = PACING_MS[prefs.pacing];
  useEffect(() => {
    if (vm === null || revealed >= blocks.length) return;
    if (delay === 0) {
      setRevealed(blocks.length);
      return;
    }
    const timer = window.setTimeout(
      () => setRevealed((r) => Math.min(r + 1, blocks.length)),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [vm, revealed, blocks.length, delay]);

  const fullyRevealed = revealed >= blocks.length;

  // Keep the newest paragraph in view as it reveals.
  const streamEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (revealed > 0) streamEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [revealed]);

  /* ── choices (F543) ──────────────────────────────────────────────────── */
  const choicesRef = useRef<HTMLDivElement>(null);
  const choicesVisible = vm !== null && vm.status === 'choices' && fullyRevealed;
  useEffect(() => {
    // Move focus to the new choices after a tap, for switch/screen-reader flow (F599).
    if (choicesVisible && madeChoiceRef.current) {
      choicesRef.current?.querySelector('button')?.focus();
    }
  }, [choicesVisible]);

  const ttsRef = useRef<TtsHandle | null>(null);
  const [ttsActive, setTtsActive] = useState<number | null>(null);
  const stopTts = useCallback(() => {
    ttsRef.current?.stop();
    ttsRef.current = null;
  }, []);
  useEffect(() => () => stopTts(), [stopTts]);

  const choose = useCallback(
    (index: number) => {
      const session = vmRef.current;
      if (session === null || session.status !== 'choices') return;
      stopTts();
      madeChoiceRef.current = true;
      try {
        chooseAndContinue(session, index);
      } catch (e) {
        setRuntimeError(e instanceof Error ? e.message : String(e));
      }
      bumpStats(storyId, { choicesMade: 1 });
      persist(session);
      bump();
    },
    [storyId, persist, bump, stopTts],
  );

  const rewind = useCallback(
    (turn: number) => {
      const session = vmRef.current;
      if (session === null || build.program === null) return;
      try {
        const rewound = rewindTo(session, turn);
        vmRef.current = rewound;
        endingRecordedRef.current = false;
        setRuntimeError(null);
        setRevealed(blocksFrom(rewound.transcript()).length);
        setPanel(null);
        persist(rewound);
        bump();
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
      }
    },
    [build.program, persist, bump, toast],
  );

  /* ── ending collection + playthrough log (F567–F569) ─────────────────── */
  const status = vm?.status;
  useEffect(() => {
    if (status !== 'done' || vm === null || endingRecordedRef.current || !fullyRevealed) return;
    endingRecordedRef.current = true;
    const entries = vm.transcript();
    const ending = endingOf(entries);
    setEndings(recordEnding(storyId, ending.id, ending.label));
    recordPlaythrough(storyId, {
      endedAt: new Date().toISOString(),
      ending: ending.label,
      transcript: plainTranscript(entries),
    });
    bumpStats(storyId, { runsFinished: 1 });
  }, [status, vm, fullyRevealed, storyId]);

  /* ── reading time (F577) ─────────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        bumpStats(storyId, { secondsRead: 10 });
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [phase, storyId]);

  /* ── read-aloud (F597/F598) ──────────────────────────────────────────── */
  const paraBlocks = useMemo(
    () => blocks.slice(0, revealed).filter((b) => b.kind === 'para'),
    [blocks, revealed],
  );
  const toggleTts = useCallback(() => {
    if (ttsRef.current !== null) {
      stopTts();
      setTtsActive(null);
      return;
    }
    const texts = paraBlocks.map((b) =>
      b.segments
        .map((s) => (s.kind === 'image' ? s.alt : s.text))
        .join(' ')
        .trim(),
    );
    ttsRef.current = speakParagraphs(texts, {
      voiceUri: prefs.ttsVoice,
      rate: prefs.ttsRate,
      onParagraph: (index) => setTtsActive(index),
      onEnd: () => {
        setTtsActive(null);
        ttsRef.current = null;
      },
    });
  }, [paraBlocks, prefs.ttsVoice, prefs.ttsRate, stopTts]);

  /* ── derived presentation ────────────────────────────────────────────── */
  const scene = currentScene(blocks.slice(0, Math.max(revealed, 1)));
  const hue = sceneHue(scene);
  const stats = vm === null ? [] : statValues(vm, statDefs);
  const surfaceStyle = {
    '--pl-size': `${prefs.textSize}px`,
    '--pl-leading': String(prefs.lineHeight),
    ...(hue !== null ? { '--pl-scene-hue': String(hue) } : {}),
  } as CSSProperties;

  const exit = useCallback(() => navigate(`/stories/${storyId}`), [navigate, storyId]);

  /* ── render ──────────────────────────────────────────────────────────── */

  if (build.program === null) {
    return (
      <div className="player-surface" data-player-theme={effectiveTheme}>
        <div className="player-gate">
          <h1>{story.title}</h1>
          <p className="player-gate-sub">
            This story does not compile yet{build.error !== null ? ` — ${build.error}` : ''}. Fix
            it in the editor, then come back.
          </p>
          <div className="player-gate-actions">
            <Button variant="primary" onClick={() => navigate(`/stories/${storyId}/edit`)}>
              Open editor
            </Button>
            <Button onClick={exit}>Back to library</Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'gate') {
    return (
      <div className="player-surface" data-player-theme={effectiveTheme} style={surfaceStyle}>
        <div className="player-gate">
          <h1>{story.title}</h1>
          {story.description !== '' ? <p className="player-gate-sub">{story.description}</p> : null}
          <div className="player-gate-actions">
            {latestAutosaveId !== null ? (
              <Button variant="primary" onClick={() => void restoreFromSave(latestAutosaveId)}>
                Continue where you left off
              </Button>
            ) : null}
            <Button onClick={beginFresh}>Start from the beginning</Button>
            <Button onClick={exit}>Back to library</Button>
          </div>
        </div>
      </div>
    );
  }

  let paraIndex = -1;
  return (
    <div
      className="player-surface"
      data-player-theme={effectiveTheme}
      {...(scene !== null ? { 'data-scene': scene } : {})}
      style={surfaceStyle}
      data-testid="player-surface"
    >
      <div className="player-topbar">
        <button className="player-iconbtn" onClick={exit} aria-label="Exit player">
          ✕
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="player-iconbtn"
            onClick={toggleTts}
            aria-label={ttsActive !== null ? 'Stop reading aloud' : 'Read aloud'}
            aria-pressed={ttsActive !== null}
          >
            {ttsActive !== null ? <Square size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            className="player-iconbtn"
            onClick={() => setPanel('menu')}
            aria-label="Player menu"
            aria-haspopup="dialog"
          >
            <MenuIcon size={16} />
          </button>
        </div>
      </div>

      {stats.length > 0 ? (
        <div className="player-stats" data-testid="player-stats" aria-label="Story stats">
          {stats.map((stat) => (
            <span key={stat.name} className="player-stat">
              {stat.name}
              {stat.max !== null ? (
                <span
                  className="player-stat-bar"
                  role="img"
                  aria-label={`${stat.name} ${stat.value} of ${stat.max}`}
                >
                  <span
                    style={{
                      width: `${Math.max(0, Math.min(100, (stat.value / stat.max) * 100))}%`,
                    }}
                  />
                </span>
              ) : null}
              <strong>{stat.value}</strong>
            </span>
          ))}
        </div>
      ) : null}

      <PlayerBoundary onExit={exit}>
        <div className="player-stream">
          <div aria-live="polite" data-testid="player-stream">
            {blocks.slice(0, revealed).map((block) => {
              if (block.kind === 'chapter') {
                return (
                  <div key={block.key} className="player-chapter" role="heading" aria-level={2}>
                    {block.text}
                  </div>
                );
              }
              if (block.kind === 'choice') {
                return (
                  <p key={block.key} className="player-echo">
                    {block.text}
                  </p>
                );
              }
              paraIndex += 1;
              const active = ttsActive === paraIndex;
              const fx = block.effects.map((e) => ` fx-${e}`).join('');
              return (
                <p key={block.key} className={`player-para${fx}${active ? ' tts-active' : ''}`}>
                  {block.segments.map((segment, i) =>
                    segment.kind === 'image' ? (
                      <img key={i} src={segment.src} alt={segment.alt} loading="lazy" />
                    ) : (
                      <span key={i}>{segment.text}</span>
                    ),
                  )}
                </p>
              );
            })}
          </div>

          {runtimeError !== null ? (
            <div className="player-error" role="alert" data-testid="player-runtime-error">
              The story hit a runtime error and cannot continue.
              <code>{runtimeError}</code>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Button onClick={beginFresh}>Restart story</Button>
                <Button onClick={exit}>Back to library</Button>
              </div>
            </div>
          ) : null}

          {choicesVisible ? (
            <div className="player-choices" ref={choicesRef} data-testid="player-choices">
              {vm.choices().map((choice) => (
                <button
                  key={choice.index}
                  className="player-choice"
                  onClick={() => choose(choice.index)}
                >
                  {choice.text}
                </button>
              ))}
            </div>
          ) : null}

          {vm !== null && vm.status === 'done' && fullyRevealed && runtimeError === null ? (
            <EndScreen
              endingLabel={endingOf(vm.transcript()).label}
              progress={knotProgress(build.program, vm)}
              endings={endings}
              totalEndings={totalEndings}
              showHints={prefs.endingHints}
              onReplay={beginFresh}
              onTranscript={() => setPanel('transcript')}
              onExit={exit}
            />
          ) : null}

          <div ref={streamEndRef} />
        </div>
      </PlayerBoundary>

      {panel === 'menu' ? (
        <MenuSheet onPick={setPanel} onExit={exit} onClose={() => setPanel(null)} />
      ) : null}
      {panel === 'saves' && vm !== null ? (
        <SavesPanel
          storyId={storyId}
          canSave={vm.status !== 'done'}
          saveNow={() => vm.saveState()}
          onRestore={(saveId) => void restoreFromSave(saveId)}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'settings' ? (
        <SettingsPanel
          prefs={prefs}
          onPrefs={updatePrefs}
          storyTheme={storyTheme}
          onStoryTheme={(theme) => {
            void storiesApi
              .patch(storyId, { settings: { theme } })
              .then(() => queryClient.invalidateQueries({ queryKey: ['story', storyId] }))
              .catch((e) => toast(e instanceof Error ? e.message : 'could not save theme'));
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'info' ? (
        <InfoPanel
          story={story}
          author={loadLibraryMeta(storyId).author}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'history' && vm !== null ? (
        <HistoryPanel
          history={vm.choiceHistory()}
          onRewind={rewind}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'bookmarks' && vm !== null ? (
        <BookmarksPanel
          storyId={storyId}
          canBookmark={vm.status !== 'done'}
          turn={vm.currentTurn}
          scene={scene ?? ''}
          saveNow={() => vm.saveState()}
          onRestore={(saveId) => void restoreFromSave(saveId)}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'transcript' && vm !== null ? (
        <TranscriptPanel
          storyTitle={story.title}
          entries={vm.transcript()}
          ending={vm.status === 'done' ? endingOf(vm.transcript()).label : null}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'compare' ? (
        <ComparePanel storyId={storyId} onClose={() => setPanel(null)} />
      ) : null}
    </div>
  );
}
