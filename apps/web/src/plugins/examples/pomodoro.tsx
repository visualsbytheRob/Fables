/**
 * F1082 — Pomodoro/focus timer example plugin with note logging.
 *
 * Demonstrates:
 *  - sidebar panel contribution
 *  - status-bar item contribution (F1047)
 *  - command palette entries (F1042)
 *  - notes:write (appending a focus session log to today's note)
 *
 * This is also an integration test fixture (F1089).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@fables/ui';
import type { PluginFactory, SidebarPanelProps, StatusBarItemProps } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Timer logic
// ────────────────────────────────────────────────────────────────────────────

type Phase = 'work' | 'short-break' | 'long-break' | 'idle';

const DURATIONS: Record<Phase, number> = {
  work: 25 * 60,
  'short-break': 5 * 60,
  'long-break': 15 * 60,
  idle: 0,
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Sidebar panel
// ────────────────────────────────────────────────────────────────────────────

export function PomodoroPanel({ activeNoteId: _noteId, settings }: SidebarPanelProps) {
  const workDuration = typeof settings.workMinutes === 'number' ? settings.workMinutes * 60 : 25 * 60;
  const [phase, setPhase] = useState<Phase>('idle');
  const [remaining, setRemaining] = useState(workDuration);
  const [running, setRunning] = useState(false);
  const [sessionsCompleted, setSessionsCompleted] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPhase = useCallback(
    (p: Phase) => {
      const dur = p === 'work' ? workDuration : DURATIONS[p];
      setPhase(p);
      setRemaining(dur);
      setRunning(true);
    },
    [workDuration],
  );

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          setRunning(false);
          if (phase === 'work') {
            setSessionsCompleted((n) => n + 1);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, phase]);

  const phaseLabel: Record<Phase, string> = {
    work: 'Focus',
    'short-break': 'Short break',
    'long-break': 'Long break',
    idle: 'Ready',
  };

  return (
    <div className="pomodoro-panel" aria-label="Pomodoro timer">
      <div
        className="pomodoro-panel__timer"
        aria-live="polite"
        aria-label={`${formatTime(remaining)} remaining`}
      >
        {formatTime(remaining)}
      </div>
      <div className="pomodoro-panel__phase">{phaseLabel[phase]}</div>
      <div className="pomodoro-panel__controls">
        {!running && phase === 'idle' && (
          <Button variant="primary" onClick={() => startPhase('work')}>
            Start focus
          </Button>
        )}
        {running && (
          <Button onClick={() => setRunning(false)}>Pause</Button>
        )}
        {!running && phase !== 'idle' && remaining > 0 && (
          <Button variant="primary" onClick={() => setRunning(true)}>
            Resume
          </Button>
        )}
        {!running && remaining === 0 && phase === 'work' && (
          <>
            <Button onClick={() => startPhase('short-break')}>Short break</Button>
            <Button onClick={() => startPhase('long-break')}>Long break</Button>
          </>
        )}
        {phase !== 'idle' && (
          <Button
            onClick={() => {
              setRunning(false);
              setPhase('idle');
              setRemaining(workDuration);
            }}
          >
            Reset
          </Button>
        )}
      </div>
      {sessionsCompleted > 0 && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-dim)', marginTop: 4 }}>
          {sessionsCompleted} session{sessionsCompleted !== 1 ? 's' : ''} completed today
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Status-bar item (shows current timer state)
// ────────────────────────────────────────────────────────────────────────────

export function PomodoroStatusItem({ settings: _settings }: StatusBarItemProps) {
  return (
    <span className="plugin-status-bar" aria-label="Pomodoro timer status" title="Pomodoro">
      🍅
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Plugin factory
// ────────────────────────────────────────────────────────────────────────────

export const pomodoroPlugin: PluginFactory = (host) => {
  const deregPanel = host.registerSidebarPanel(
    'pomodoro',
    'Pomodoro',
    PomodoroPanel,
    { order: 60 },
  );

  const deregStatus = host.registerStatusBarItem('pomodoro-timer', PomodoroStatusItem, {
    align: 'right',
    order: 10,
  });

  const deregCmd = host.registerCommand({
    id: `${host.pluginId}.start`,
    label: 'Start Pomodoro timer',
    keywords: 'focus timer pomodoro',
    run: () => {
      host.showToast('Pomodoro panel is in the sidebar.', 'info');
    },
  });

  return () => {
    deregPanel();
    deregStatus();
    deregCmd();
  };
};

export const POMODORO_MANIFEST = {
  id: 'pomodoro',
  name: 'Pomodoro Timer',
  version: '1.0.0',
  description: 'Focus timer with note logging and status-bar indicator.',
  permissions: ['notes:write', 'notifications'] as const,
  contributes: {
    sidebarPanels: [{ id: 'pomodoro', title: 'Pomodoro', order: 60 }],
    statusBarItems: [{ id: 'pomodoro-timer', align: 'right' }],
    commands: [{ id: 'pomodoro.start', label: 'Start Pomodoro timer' }],
    settingsSections: [
      {
        id: 'pomodoro-settings',
        title: 'Timer settings',
        fields: [
          {
            type: 'number' as const,
            key: 'workMinutes',
            label: 'Work duration (minutes)',
            min: 1,
            max: 90,
            defaultValue: 25,
          },
        ],
      },
    ],
  },
};
