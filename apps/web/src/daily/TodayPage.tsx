/**
 * Journal view (F251–F259): /today opens (creating if needed) today's daily
 * note in the Journal notebook, with a calendar widget, streak indicator,
 * yesterday/today/tomorrow navigation, a week view with snippets, on-this-day
 * resurfacing, quick capture into today, and configurable template sections.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Flame, Input, useToast } from '@fables/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAllNotes, useNote, useNotebookTree } from '../api/hooks.js';
import { useRegisterCommands } from '../commands/registry.js';
import { Skeleton } from '../components/Skeleton.js';
import { allNodes } from '../notes/notebookTreeModel.js';
import { loadDailySections, saveDailySections } from '../notes/prefs.js';
import { snippet } from '../notes/text.js';
import { CalendarMonth } from './CalendarMonth.js';
import {
  addDays,
  dayKey,
  dayLabel,
  isDayKey,
  monthOf,
  onThisDayKeys,
  streak,
  weekKeys,
} from './dayKeys.js';
import { appendToToday, ensureDailyNote, JOURNAL_NOTEBOOK_NAME } from './journal.js';
import './daily.css';

const NoteEditorPane = lazy(() =>
  import('../notes/NoteEditorPane.js').then((m) => ({ default: m.NoteEditorPane })),
);

export function TodayPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = dayKey();
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(monthOf(today));
  const [capture, setCapture] = useState('');
  const [sectionsText, setSectionsText] = useState(() => loadDailySections().join(', '));
  const [focusMode, setFocusMode] = useState(false);
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const ensuredRef = useRef(false);

  const tree = useNotebookTree();
  const roots = useMemo(() => tree.data ?? [], [tree.data]);
  const journal = useMemo(
    () =>
      allNodes(roots).find(
        (nb) => nb.name.trim().toLowerCase() === JOURNAL_NOTEBOOK_NAME.toLowerCase(),
      ) ?? null,
    [roots],
  );

  const journalNotes = useQuery({
    queryKey: ['notes', 'journal', journal?.id ?? 'none'],
    queryFn: () => fetchAllNotes(journal!.id),
    enabled: journal !== null,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['notes'] });
    void qc.invalidateQueries({ queryKey: ['notebooks'] });
  };

  // Opening /today creates today's note when missing (F252).
  useEffect(() => {
    if (ensuredRef.current || tree.isPending) return;
    const existing = (journalNotes.data ?? []).some((n) => n.title.trim() === today);
    if (journal !== null && (journalNotes.isPending || existing)) return;
    ensuredRef.current = true;
    void ensureDailyNote(today)
      .then(() => invalidate())
      .catch((err: Error) => toast(`Could not create today's note: ${err.message}`, 'error'));
  }, [tree.isPending, journal, journalNotes.isPending, journalNotes.data, today]);

  const notesByKey = useMemo(() => {
    const map = new Map<string, { id: string; body: string }>();
    for (const n of journalNotes.data ?? []) {
      const key = n.title.trim();
      if (isDayKey(key) && !map.has(key)) map.set(key, { id: n.id, body: n.body });
    }
    return map;
  }, [journalNotes.data]);

  const markedDays = useMemo(() => new Set(notesByKey.keys()), [notesByKey]);
  const streakDays = streak(markedDays, today);
  const selectedNote = notesByKey.get(selected) ?? null;
  const note = useNote(selectedNote?.id ?? null);

  const pickDay = (key: string) => {
    const go = () => {
      setSelected(key);
      setMonth(monthOf(key));
    };
    const flush = flushRef.current;
    if (flush) void flush().finally(go);
    else go();
  };

  const createSelected = () => {
    void ensureDailyNote(selected)
      .then(() => invalidate())
      .catch((err: Error) => toast(`Create failed: ${err.message}`, 'error'));
  };

  const submitCapture = () => {
    const text = capture.trim();
    if (text === '') return;
    void appendToToday(text)
      .then(() => {
        setCapture('');
        invalidate();
        toast('Added to today');
      })
      .catch((err: Error) => toast(`Capture failed: ${err.message}`, 'error'));
  };

  const onThisDay = onThisDayKeys(selected)
    .map((key) => ({ key, note: notesByKey.get(key) }))
    .filter((x): x is { key: string; note: { id: string; body: string } } => x.note !== undefined);

  useRegisterCommands([
    {
      id: 'journal-yesterday',
      label: 'Journal: open yesterday',
      keywords: 'daily previous',
      run: () => pickDay(addDays(selected, -1)),
    },
    {
      id: 'journal-tomorrow',
      label: 'Journal: open tomorrow',
      keywords: 'daily next',
      run: () => pickDay(addDays(selected, 1)),
    },
  ]);

  return (
    <div className="today-page">
      {!focusMode && (
        <aside className="today-page__side">
          <div className="today-page__nav ui-row">
            <Button aria-label="Yesterday" onClick={() => pickDay(addDays(selected, -1))}>
              ←
            </Button>
            <Button
              variant={selected === today ? 'primary' : 'default'}
              onClick={() => pickDay(today)}
            >
              Today
            </Button>
            <Button aria-label="Tomorrow" onClick={() => pickDay(addDays(selected, 1))}>
              →
            </Button>
            <span className="today-page__streak" title="Consecutive journaling days">
              <Flame size={14} /> {streakDays} day{streakDays === 1 ? '' : 's'}
            </span>
          </div>

          <CalendarMonth
            month={month}
            selected={selected}
            today={today}
            marked={markedDays}
            onSelect={pickDay}
            onMonthChange={setMonth}
          />

          <div className="today-page__capture ui-row">
            <Input
              aria-label="Quick capture to today"
              placeholder="Add to today…"
              value={capture}
              onChange={(e) => setCapture(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCapture();
              }}
            />
            <Button disabled={capture.trim() === ''} onClick={submitCapture}>
              Add
            </Button>
          </div>

          <section aria-label="This week">
            <h4 className="today-page__h">This week</h4>
            {weekKeys(selected).map((key) => {
              const entry = notesByKey.get(key);
              return (
                <button
                  key={key}
                  type="button"
                  className={`today-page__week-row${key === selected ? ' today-page__week-row--active' : ''}`}
                  onClick={() => pickDay(key)}
                >
                  <span className="today-page__week-day">{dayLabel(key)}</span>
                  <span className="today-page__week-snippet">
                    {entry ? snippet(entry.body, 48) || '(empty)' : '—'}
                  </span>
                </button>
              );
            })}
          </section>

          {onThisDay.length > 0 && (
            <section aria-label="On this day">
              <h4 className="today-page__h">On this day</h4>
              {onThisDay.map(({ key, note: past }) => (
                <button
                  key={key}
                  type="button"
                  className="today-page__week-row"
                  onClick={() => pickDay(key)}
                >
                  <span className="today-page__week-day">{key.slice(0, 4)}</span>
                  <span className="today-page__week-snippet">{snippet(past.body, 48)}</span>
                </button>
              ))}
            </section>
          )}

          <section aria-label="Daily template sections">
            <h4 className="today-page__h">Template sections</h4>
            <div className="ui-row">
              <Input
                aria-label="Daily template sections"
                value={sectionsText}
                onChange={(e) => setSectionsText(e.target.value)}
              />
              <Button
                onClick={() => {
                  saveDailySections(
                    sectionsText
                      .split(',')
                      .map((s) => s.trim())
                      .filter((s) => s !== ''),
                  );
                  toast('Daily template saved');
                }}
              >
                Save
              </Button>
            </div>
          </section>
        </aside>
      )}

      <section className="today-page__main" aria-label="Daily note">
        {(tree.isPending || (journal !== null && journalNotes.isPending)) && (
          <Skeleton height={280} />
        )}
        {!selectedNote && !journalNotes.isPending && journal !== null && (
          <div className="today-page__empty">
            <p>No journal entry for {selected}.</p>
            <Button variant="primary" onClick={createSelected}>
              Create it
            </Button>
          </div>
        )}
        {note.data && (
          <Suspense fallback={<Skeleton height={280} />}>
            <NoteEditorPane
              key={note.data.id}
              note={note.data}
              roots={roots}
              onSelectNotebook={() => navigate('/')}
              focusMode={focusMode}
              onToggleFocusMode={() => setFocusMode((v) => !v)}
              flushRef={flushRef}
            />
          </Suspense>
        )}
      </section>
    </div>
  );
}
