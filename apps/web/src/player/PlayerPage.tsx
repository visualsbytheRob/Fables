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
import {
  Button,
  Compass,
  Highlighter,
  Menu as MenuIcon,
  Square,
  Volume2,
  useToast,
} from '@fables/ui';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Story, StoryHost } from '@fables/forge-vm';
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
import { BookmarksPanel, ComparePanel, HistoryPanel, TranscriptPanel } from './HistorySheets.js';
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
import {
  EffectsDispatcher,
  currentPlaythrough,
  newPlaythrough,
  type CodexEntry,
  type EffectEvent,
} from './effects.js';
import { codexApi, notesApi, notebooksApi } from '../api/client.js';
import { makePlayerHost } from './host.js';
import { loadPlayerKnowledge, type PlayerKnowledge } from './playerData.js';
import { CodexPanel } from './Codex.js';
import { EntityCard } from './EntityCard.js';
import { LorePopover, MAX_LORE_DEPTH, resolveLoreTitle } from './LorePopover.js';
import { AnnotationsPanel } from './index.js';
import { addAnnotation, annotationBody, annotationTitle } from './annotationsLogic.js';
import { loadLoreVisits, markLoreVisited } from './loreVisits.js';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const storyId = story.id;

  /* ── knowledge + host wiring (F613/F621/F623) ────────────────────────────
   * The codex/lore/journal features come alive only when entities and the
   * note index are loaded; until then the player still reads perfectly, with
   * @entity falling back to plain text and [[lore]] inert. */
  const knowledgeQuery = useQuery<PlayerKnowledge>({
    queryKey: ['player-knowledge'],
    queryFn: () => loadPlayerKnowledge(),
    staleTime: 60_000,
  });
  const knowledge = knowledgeQuery.data ?? null;

  /** Stable playthrough id for this run (codex + effects attach to it). */
  const playthroughRef = useRef<string>(currentPlaythrough(storyId));

  /** Host events buffer into the dispatcher; flushed once per turn. */
  const dispatcherRef = useRef<EffectsDispatcher | null>(null);
  const [codexBadge, setCodexBadge] = useState(0);
  const refreshCodex = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['codex', storyId] });
  }, [queryClient, storyId]);

  const ensureDispatcher = useCallback((): EffectsDispatcher => {
    if (dispatcherRef.current === null) {
      dispatcherRef.current = new EffectsDispatcher({
        storyId,
        playthroughId: playthroughRef.current,
        onDelivered: () => {
          refreshCodex();
          setCodexBadge((n) => n + 1);
        },
      });
    }
    return dispatcherRef.current;
  }, [storyId, refreshCodex]);

  const onHostEvent = useCallback(
    (event: EffectEvent) => {
      ensureDispatcher().enqueue(event);
    },
    [ensureDispatcher],
  );

  /** The VM host, rebuilt only when the entity index changes. */
  const host: StoryHost | undefined = useMemo(() => {
    if (knowledge === null) return undefined;
    return makePlayerHost({ entities: knowledge.entityIndex, onEvent: onHostEvent });
  }, [knowledge, onHostEvent]);
  const hostRef = useRef<StoryHost | undefined>(undefined);
  hostRef.current = host;

  /** Codex (spoiler-safe) for the live playthrough. */
  const codexQuery = useQuery({
    queryKey: ['codex', storyId, playthroughRef.current],
    queryFn: () => codexApi.get(storyId, playthroughRef.current),
    enabled: false, // fetched on demand once effects start landing
  });
  const refetchCodex = codexQuery.refetch;
  useEffect(() => {
    if (codexBadge > 0) void refetchCodex();
  }, [codexBadge, refetchCodex]);

  /** Flush the per-turn effect batch keyed to the current turn. */
  const flushEffects = useCallback((turn: number) => {
    const dispatcher = dispatcherRef.current;
    if (dispatcher === null) return;
    void dispatcher.flush(turn).catch(() => undefined);
  }, []);

  // Retry any queued offline batches when the network returns (F614 offline).
  useEffect(() => {
    const onOnline = () => void dispatcherRef.current?.retryQueued().catch(() => undefined);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  /* ── lore / codex / annotation UI state ─────────────────────────────────── */
  const [loreStack, setLoreStack] = useState<string[]>([]);
  const [codexOpen, setCodexOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(0); // codex entries seen when panel last opened
  const loreVisitsRef = useRef<Set<string>>(loadLoreVisits(storyId));

  const openLore = useCallback(
    (title: string) => {
      loreVisitsRef.current = markLoreVisited(storyId, title);
      setLoreStack((stack) => (stack.length >= MAX_LORE_DEPTH ? stack : [...stack, title]));
    },
    [storyId],
  );

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
      // A fresh run is a fresh playthrough: new codex, new effect history.
      playthroughRef.current = newPlaythrough(storyId);
      dispatcherRef.current = null;
      ensureDispatcher();
      vmRef.current = startSession(build.program, pickSeed(story.settings), hostRef.current);
      endingRecordedRef.current = false;
      madeChoiceRef.current = false;
      setRuntimeError(null);
      setRevealed(0);
      setPhase('playing');
      bumpStats(storyId, { runsStarted: 1 });
      // The opening passage may already have surfaced entities/lore.
      flushEffects(vmRef.current.currentTurn);
      bump();
    } catch (e) {
      setRuntimeError(e instanceof Error ? e.message : String(e));
      setPhase('playing');
    }
  }, [build.program, story.settings, storyId, bump, ensureDispatcher, flushEffects]);

  const restoreFromSave = useCallback(
    async (saveId: string) => {
      if (build.program === null) return;
      try {
        const save = await savesApi.get(storyId, saveId);
        const session = resumeSession(build.program, save.state, hostRef.current);
        vmRef.current = session;
        ensureDispatcher();
        endingRecordedRef.current = session.status === 'done';
        madeChoiceRef.current = false;
        setRuntimeError(null);
        setRevealed(blocksFrom(session.transcript()).length);
        setPanel(null);
        setPhase('playing');
        flushEffects(session.currentTurn);
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
    [build.program, storyId, toast, bump, ensureDispatcher, flushEffects],
  );

  // No autosave → straight into a fresh run (F544). Wait for the knowledge
  // load to settle first so the very first passage already binds entities/lore
  // (loaded or errored — a failed knowledge load just plays without bindings).
  const knowledgeSettled = !knowledgeQuery.isLoading;
  useEffect(() => {
    if (
      phase === 'playing' &&
      vmRef.current === null &&
      runtimeError === null &&
      knowledgeSettled
    ) {
      beginFresh();
    }
  }, [phase, beginFresh, runtimeError, knowledgeSettled]);

  /* ── ?turn= deep link (F635) ─────────────────────────────────────────────
   * A journal/annotation back-link lands here with `?turn=N`. We resolve it
   * against the live autosaved run by rewinding to that turn, then drop the
   * param so a later choice doesn't snap back. */
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    const raw = searchParams.get('turn');
    if (raw === null) return;
    const turn = Number.parseInt(raw, 10);
    const session = vmRef.current;
    if (session === null || Number.isNaN(turn)) return;
    deepLinkHandledRef.current = true;
    if (phase === 'gate') setPhase('playing');
    if (turn > 0 && turn <= session.currentTurn) {
      try {
        const rewound = rewindTo(session, turn, hostRef.current);
        vmRef.current = rewound;
        setRevealed(blocksFrom(rewound.transcript()).length);
        bump();
      } catch {
        /* incompatible turn — just stay where we are */
      }
    }
    const next = new URLSearchParams(searchParams);
    next.delete('turn');
    setSearchParams(next, { replace: true });
  }, [searchParams, phase, setSearchParams, bump]);

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
      // One idempotent effect batch per turn (F638 batching / F614 keys).
      flushEffects(session.currentTurn);
      bump();
    },
    [storyId, persist, bump, stopTts, flushEffects],
  );

  const rewind = useCallback(
    (turn: number) => {
      const session = vmRef.current;
      if (session === null || build.program === null) return;
      try {
        // Rewind re-fires host effects deterministically; their idempotency
        // keys collide with the originals so the server replays, not re-applies.
        const rewound = rewindTo(session, turn, hostRef.current);
        vmRef.current = rewound;
        endingRecordedRef.current = false;
        setRuntimeError(null);
        setRevealed(blocksFrom(rewound.transcript()).length);
        setPanel(null);
        persist(rewound);
        flushEffects(rewound.currentTurn);
        bump();
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
      }
    },
    [build.program, persist, bump, toast, flushEffects],
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
    // Playthrough summary journal entry on completion (F633): one batched
    // journal event so the run leaves a single line in the daily note.
    const dispatcher = dispatcherRef.current;
    if (dispatcher !== null) {
      dispatcher.enqueue({
        type: 'journal',
        payload: {
          text: `Finished “${story.title}” — reached the ending: ${ending.label}.`,
          choice: 'completion',
        },
      });
      flushEffects(vm.currentTurn + 1);
    }
  }, [status, vm, fullyRevealed, storyId, story.title, flushEffects]);

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

  /* ── entity tap → codex (F623/F614) ──────────────────────────────────────
   * Tapping an @entity opens the codex focused on that entity if the reader
   * has met it; otherwise the panel opens and the entry simply isn't there
   * yet (spoiler-safe — we never reveal an unmet entity). */
  const [focusEntity, setFocusEntity] = useState<string | null>(null);
  const codexData = codexQuery.data;
  const focusedEntry: CodexEntry | null = useMemo(() => {
    if (focusEntity === null || codexData === undefined) return null;
    const key = focusEntity.trim().toLowerCase();
    return codexData.entries.find((e) => e.name.trim().toLowerCase() === key) ?? null;
  }, [focusEntity, codexData]);

  const onEntityTap = useCallback(
    (name: string) => {
      setFocusEntity(name);
      setCodexOpen(true);
      void codexQuery.refetch();
    },
    [codexQuery],
  );

  /* ── reader annotations (F636/F637) ──────────────────────────────────────
   * The reader selects story text; we offer "Annotate" which creates a note
   * (notes API) capturing the quote + a deep link back to this turn, and
   * registers it locally so the review view can list it. */
  const [selection, setSelection] = useState<string>('');
  const captureSelection = useCallback(() => {
    if (typeof window === 'undefined') return;
    const text = window.getSelection?.()?.toString() ?? '';
    setSelection(text.trim());
  }, []);

  const annotate = useCallback(async () => {
    const quote = selection;
    if (quote === '' || vmRef.current === null) return;
    const turn = vmRef.current.currentTurn;
    try {
      // Drop annotation notes in (or create) an "Annotations" notebook.
      const notebooks = await notebooksApi.list(true);
      const target =
        notebooks.find((n) => n.name === 'Annotations') ??
        (await notebooksApi.create({ name: 'Annotations' }));
      const note = await notesApi.create({
        notebookId: target.id,
        title: annotationTitle(quote),
        body: annotationBody({
          storyId,
          storyTitle: story.title,
          turn,
          scene: scene ?? '',
          quote,
        }),
      });
      addAnnotation({
        noteId: note.id,
        storyId,
        playthroughId: playthroughRef.current,
        turn,
        scene: scene ?? '',
        quote,
      });
      setSelection('');
      window.getSelection?.()?.removeAllRanges();
      toast('Annotation saved to your notes');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'could not save annotation');
    }
  }, [selection, storyId, story.title, scene, toast]);

  /** Render one paragraph's segments, making entity/lore taps live (F621–F626). */
  const renderSegments = useCallback(
    (segments: PlayerBlock['segments']) =>
      segments.map((segment, i) => {
        if (segment.kind === 'image') {
          return <img key={i} src={segment.src} alt={segment.alt} loading="lazy" />;
        }
        if (segment.kind === 'entity') {
          const met =
            codexData?.entries.some(
              (e) => e.name.trim().toLowerCase() === segment.name.trim().toLowerCase(),
            ) ?? false;
          return (
            <button
              key={i}
              type="button"
              className={`player-entity${met ? ' player-entity--met' : ''}`}
              onClick={() => onEntityTap(segment.name)}
              title={met ? `Open ${segment.name} in the codex` : segment.name}
            >
              {segment.text}
            </button>
          );
        }
        if (segment.kind === 'lore') {
          const resolvable =
            knowledge !== null &&
            resolveLoreTitle(segment.title, knowledge.noteTitleIndex) !== null;
          const visited = loreVisitsRef.current.has(segment.title);
          return (
            <button
              key={i}
              type="button"
              className={`player-lore${resolvable ? '' : ' player-lore--inert'}${
                visited ? ' player-lore--visited' : ''
              }`}
              onClick={resolvable ? () => openLore(segment.title) : undefined}
              disabled={!resolvable}
              title={
                resolvable ? `Lore: ${segment.title}` : `${segment.title} (no longer available)`
              }
            >
              {segment.text}
            </button>
          );
        }
        return <span key={i}>{segment.text}</span>;
      }),
    [codexData, knowledge, onEntityTap, openLore],
  );

  /* ── render ──────────────────────────────────────────────────────────── */

  if (build.program === null) {
    return (
      <div className="player-surface" data-player-theme={effectiveTheme}>
        <div className="player-gate">
          <h1>{story.title}</h1>
          <p className="player-gate-sub">
            This story does not compile yet{build.error !== null ? ` — ${build.error}` : ''}. Fix it
            in the editor, then come back.
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
            className="player-iconbtn player-codex-btn"
            onClick={() => {
              setFocusEntity(null);
              setCodexOpen(true);
              setSeenCount(codexData?.entries.length ?? 0);
              void codexQuery.refetch();
            }}
            aria-label="Open codex"
            aria-haspopup="dialog"
          >
            <Compass size={16} />
            {(codexData?.entries.length ?? 0) > seenCount ? (
              <span className="player-codex-badge" aria-label="New codex entries" />
            ) : null}
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
          <div
            aria-live="polite"
            data-testid="player-stream"
            onMouseUp={captureSelection}
            onTouchEnd={captureSelection}
          >
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
                  {renderSegments(block.segments)}
                </p>
              );
            })}
          </div>

          {selection !== '' ? (
            <div className="player-annotate-bar" role="toolbar" aria-label="Annotate selection">
              <span className="player-annotate-quote">“{selection.slice(0, 60)}”</span>
              <Button onClick={() => void annotate()}>
                <Highlighter size={14} /> Annotate
              </Button>
              <button
                className="player-iconbtn"
                onClick={() => setSelection('')}
                aria-label="Dismiss annotation prompt"
              >
                ✕
              </button>
            </div>
          ) : null}

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
      {panel === 'annotations' ? (
        <AnnotationsPanel
          storyId={storyId}
          onOpen={(turn: number) => {
            setPanel(null);
            const session = vmRef.current;
            if (session !== null && turn > 0 && turn <= session.currentTurn) {
              try {
                const rewound = rewindTo(session, turn, hostRef.current);
                vmRef.current = rewound;
                setRevealed(blocksFrom(rewound.transcript()).length);
                bump();
              } catch {
                /* incompatible — ignore */
              }
            }
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {/* Codex slide-over (F614/F617) */}
      {codexOpen ? (
        <CodexPanel
          data={codexData}
          onClose={() => {
            setCodexOpen(false);
            setFocusEntity(null);
            setSeenCount(codexData?.entries.length ?? 0);
          }}
        />
      ) : null}
      {/* Focused entity card (entity-tap, F623) layered above the codex list */}
      {codexOpen && focusedEntry !== null ? (
        <div
          className="codex-focus-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFocusEntity(null);
          }}
        >
          <div className="codex-focus">
            <div className="codex-focus-head">
              <button
                className="player-iconbtn"
                onClick={() => setFocusEntity(null)}
                aria-label="Back to codex"
              >
                ✕
              </button>
            </div>
            <EntityCard entry={focusedEntry} />
          </div>
        </div>
      ) : null}

      {/* Lore popover stack (F622/F625), depth-capped */}
      {loreStack.length > 0
        ? (() => {
            const title = loreStack[loreStack.length - 1] as string;
            const noteId =
              knowledge === null ? null : resolveLoreTitle(title, knowledge.noteTitleIndex);
            return (
              <LorePopover
                title={title}
                noteId={noteId}
                depth={loreStack.length}
                onOpenLore={openLore}
                onClose={() => setLoreStack((stack) => stack.slice(0, -1))}
              />
            );
          })()
        : null}
    </div>
  );
}
