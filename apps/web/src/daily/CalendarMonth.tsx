/**
 * Dependency-free month calendar (F253): Monday-first grid with dots on days
 * that have journal entries; clicking any day navigates to it.
 */
import { ChevronDown, ChevronRight } from '@fables/ui';
import { addMonths, monthLabel, monthMatrix } from './dayKeys.js';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function CalendarMonth({
  month,
  selected,
  today,
  marked,
  onSelect,
  onMonthChange,
}: {
  /** YYYY-MM being displayed. */
  month: string;
  selected: string | null;
  today: string;
  /** Day keys that have a journal note. */
  marked: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onMonthChange: (month: string) => void;
}) {
  return (
    <div className="cal" aria-label={`Calendar for ${monthLabel(month)}`}>
      <div className="cal__head">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onMonthChange(addMonths(month, -1))}
        >
          <ChevronDown size={14} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <strong>{monthLabel(month)}</strong>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onMonthChange(addMonths(month, 1))}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="cal__grid" role="grid">
        {WEEKDAYS.map((d) => (
          <span key={d} className="cal__dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {monthMatrix(month)
          .flat()
          .map((key, i) =>
            key === null ? (
              <span key={`pad-${i}`} />
            ) : (
              <button
                key={key}
                type="button"
                className={`cal__day${key === selected ? ' cal__day--selected' : ''}${
                  key === today ? ' cal__day--today' : ''
                }`}
                aria-label={key}
                onClick={() => onSelect(key)}
              >
                {Number(key.slice(8))}
                {marked.has(key) && <span className="cal__dot" aria-hidden="true" />}
              </button>
            ),
          )}
      </div>
    </div>
  );
}
