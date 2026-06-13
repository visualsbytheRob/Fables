/**
 * In-player bottom sheets (F545): the menu, save slots, reader settings with
 * the theme gallery (F551/F553/F559), and story info. Pure presentation —
 * all state lives in PlayerPage.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Bookmark,
  Button,
  GitCompare,
  History,
  Info,
  LogOut,
  Save,
  ScrollText,
  Settings as SettingsIcon,
  Share2,
  useToast,
} from '@fables/ui';
import type { ReactNode } from 'react';
import type { StorySaveState } from '@fables/forge-vm';
import type { StoryProject } from '../stories/api.js';
import { savesApi } from './api.js';
import type { StorySaveMeta } from './api.js';
import { shareText } from './exporters.js';
import {
  PACING_MS,
  PLAYER_THEMES,
  THEME_LABELS,
  formatDuration,
  loadStats,
  type Pacing,
  type ReaderPrefs,
} from './prefs.js';
import { listVoices, ttsSupported } from './tts.js';

export type PlayerPanel =
  | 'menu'
  | 'saves'
  | 'settings'
  | 'info'
  | 'history'
  | 'bookmarks'
  | 'transcript'
  | 'compare';

/** Bottom sheet shell: dialog semantics, Escape + scrim dismissal (F599). */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="player-sheet"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="player-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h3 style={{ flex: 1 }}>{title}</h3>
          <button className="player-iconbtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── menu (F545) ───────────────────────────────────────────────────────── */

export function MenuSheet({
  onPick,
  onExit,
  onClose,
}: {
  onPick: (panel: PlayerPanel) => void;
  onExit: () => void;
  onClose: () => void;
}) {
  const items: { panel: PlayerPanel; icon: ReactNode; label: string }[] = [
    { panel: 'saves', icon: <Save size={16} />, label: 'Saves' },
    { panel: 'history', icon: <History size={16} />, label: 'Choice history' },
    { panel: 'bookmarks', icon: <Bookmark size={16} />, label: 'Bookmarks' },
    { panel: 'transcript', icon: <ScrollText size={16} />, label: 'Transcript' },
    { panel: 'compare', icon: <GitCompare size={16} />, label: 'Compare playthroughs' },
    { panel: 'settings', icon: <SettingsIcon size={16} />, label: 'Reader settings' },
    { panel: 'info', icon: <Info size={16} />, label: 'Story info' },
  ];
  return (
    <Sheet title="Menu" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item) => (
          <button key={item.panel} className="player-menu-item" onClick={() => onPick(item.panel)}>
            {item.icon} {item.label}
          </button>
        ))}
        <button className="player-menu-item" onClick={onExit}>
          <LogOut size={16} /> Exit to library
        </button>
      </div>
    </Sheet>
  );
}

/* ── save slots (F545, server F462) ────────────────────────────────────── */

export function SavesPanel({
  storyId,
  canSave,
  saveNow,
  onRestore,
  onClose,
}: {
  storyId: string;
  canSave: boolean;
  /** Returns the serialized state of the live run. */
  saveNow: () => StorySaveState;
  onRestore: (saveId: string) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const slots = useQuery({
    queryKey: ['story-saves', storyId, 'slot'],
    queryFn: () => savesApi.list(storyId, 'slot'),
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['story-saves', storyId, 'slot'] });

  const create = useMutation({
    mutationFn: (slotName: string) => savesApi.createSlot(storyId, slotName, saveNow()),
    onSuccess: () => {
      setName('');
      invalidate();
      toast('Saved');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'save failed'),
  });
  const remove = useMutation({
    mutationFn: (saveId: string) => savesApi.remove(storyId, saveId),
    onSuccess: invalidate,
  });

  return (
    <Sheet title="Saves" onClose={onClose}>
      {canSave ? (
        <form
          style={{ display: 'flex', gap: 8, marginBottom: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() !== '') create.mutate(name.trim());
          }}
        >
          <input
            type="text"
            aria-label="Save name"
            placeholder="Save name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1, font: 'inherit', fontSize: 14, padding: 10, borderRadius: 10 }}
          />
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Save here
          </Button>
        </form>
      ) : null}
      {(slots.data ?? []).length === 0 ? (
        <p style={{ color: 'var(--pl-dim)' }}>No saves yet.</p>
      ) : (
        (slots.data ?? []).map((slot: StorySaveMeta) => (
          <div key={slot.id} className="player-row">
            <div className="player-row-main">
              {slot.name}
              <small>
                turn {slot.turn}
                {slot.scene !== '' ? ` · ${slot.scene}` : ''} ·{' '}
                {new Date(slot.updatedAt).toLocaleString()}
              </small>
            </div>
            <Button onClick={() => onRestore(slot.id)}>Load</Button>
            <Button variant="danger" onClick={() => remove.mutate(slot.id)} aria-label={`Delete save ${slot.name}`}>
              ✕
            </Button>
          </div>
        ))
      )}
    </Sheet>
  );
}

/* ── reader settings + theme gallery (F551/F553/F559/F597) ─────────────── */

export function SettingsPanel({
  prefs,
  onPrefs,
  storyTheme,
  onStoryTheme,
  onClose,
}: {
  prefs: ReaderPrefs;
  onPrefs: (next: ReaderPrefs) => void;
  /** The per-story override from story settings (F552); null = none. */
  storyTheme: string | null;
  onStoryTheme: (theme: string | null) => void;
  onClose: () => void;
}) {
  const voices = ttsSupported() ? listVoices() : [];
  return (
    <Sheet title="Reader settings" onClose={onClose}>
      <div className="player-sheet-grid" role="group" aria-label="Theme gallery">
        {PLAYER_THEMES.map((theme) => (
          <button
            key={theme}
            className="player-theme-swatch"
            data-player-theme={theme}
            aria-pressed={prefs.theme === theme}
            onClick={() => onPrefs({ ...prefs, theme })}
          >
            <strong>{THEME_LABELS[theme]}</strong>
            <span className="swatch-sample">The fox trotted on…</span>
          </button>
        ))}
      </div>

      <div className="player-setting">
        <label htmlFor="pl-story-theme">Theme for this story</label>
        <select
          id="pl-story-theme"
          value={storyTheme ?? ''}
          onChange={(e) => onStoryTheme(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">My default</option>
          {PLAYER_THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {THEME_LABELS[theme]}
            </option>
          ))}
        </select>
      </div>

      <div className="player-setting">
        <label htmlFor="pl-size">
          Text size — {prefs.textSize}px
        </label>
        <input
          id="pl-size"
          type="range"
          min={14}
          max={26}
          step={1}
          value={prefs.textSize}
          onChange={(e) => onPrefs({ ...prefs, textSize: Number(e.target.value) })}
        />
      </div>
      <div className="player-setting">
        <label htmlFor="pl-leading">Line height — {prefs.lineHeight.toFixed(2)}</label>
        <input
          id="pl-leading"
          type="range"
          min={1.3}
          max={2.1}
          step={0.05}
          value={prefs.lineHeight}
          onChange={(e) => onPrefs({ ...prefs, lineHeight: Number(e.target.value) })}
        />
      </div>
      <div className="player-setting">
        <label htmlFor="pl-pacing">Text reveal pacing</label>
        <select
          id="pl-pacing"
          value={prefs.pacing}
          onChange={(e) => onPrefs({ ...prefs, pacing: e.target.value as Pacing })}
        >
          {(Object.keys(PACING_MS) as Pacing[]).map((pacing) => (
            <option key={pacing} value={pacing}>
              {pacing}
            </option>
          ))}
        </select>
      </div>

      {ttsSupported() ? (
        <>
          <div className="player-setting">
            <label htmlFor="pl-voice">Read-aloud voice</label>
            <select
              id="pl-voice"
              value={prefs.ttsVoice ?? ''}
              onChange={(e) => onPrefs({ ...prefs, ttsVoice: e.target.value || null })}
            >
              <option value="">System default</option>
              {voices.map((voice) => (
                <option key={voice.uri} value={voice.uri}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </div>
          <div className="player-setting">
            <label htmlFor="pl-rate">Read-aloud speed — {prefs.ttsRate.toFixed(1)}×</label>
            <input
              id="pl-rate"
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={prefs.ttsRate}
              onChange={(e) => onPrefs({ ...prefs, ttsRate: Number(e.target.value) })}
            />
          </div>
        </>
      ) : null}

      <div className="player-setting">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={prefs.endingHints}
            onChange={(e) => onPrefs({ ...prefs, endingHints: e.target.checked })}
          />
          Show undiscovered-ending hints
        </label>
      </div>
    </Sheet>
  );
}

/* ── story info (F545/F577) ────────────────────────────────────────────── */

export function InfoPanel({
  story,
  author,
  onClose,
}: {
  story: StoryProject;
  author: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const stats = loadStats(story.id);
  return (
    <Sheet title="Story info" onClose={onClose}>
      <p style={{ margin: '0 0 4px', fontSize: 18 }}>
        <strong>{story.title}</strong>
      </p>
      {author !== '' ? <p style={{ margin: '0 0 8px', color: 'var(--pl-dim)' }}>by {author}</p> : null}
      {story.description !== '' ? <p>{story.description}</p> : null}
      <div className="player-row">
        <BarChart3 size={16} />
        <div className="player-row-main">
          {formatDuration(stats.secondsRead)} read · {stats.choicesMade} choices ·{' '}
          {stats.runsFinished} of {stats.runsStarted} runs finished
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Button
          onClick={() => {
            void shareText({
              title: story.title,
              text: `Read “${story.title}” on Fables`,
              url: `${window.location.origin}/stories/${story.id}/play`,
            }).then((how) => {
              if (how === 'copied') toast('Link copied');
            });
          }}
        >
          <Share2 size={14} /> Share story link
        </Button>
      </div>
    </Sheet>
  );
}
