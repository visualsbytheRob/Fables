// Cron scheduling core — pure, no I/O, UTC only.

export interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  domRestricted: boolean;
  dowRestricted: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rangeArray(lo: number, hi: number): number[] {
  const arr: number[] = [];
  for (let i = lo; i <= hi; i++) {
    arr.push(i);
  }
  return arr;
}

function unique(arr: number[]): number[] {
  return [...new Set(arr)].sort((a, b) => a - b);
}

interface FieldSpec {
  min: number;
  max: number;
  name: string;
}

const FIELD_SPECS: [FieldSpec, FieldSpec, FieldSpec, FieldSpec, FieldSpec] = [
  { min: 0, max: 59, name: 'minute' },
  { min: 0, max: 23, name: 'hour' },
  { min: 1, max: 31, name: 'day-of-month' },
  { min: 1, max: 12, name: 'month' },
  { min: 0, max: 6, name: 'day-of-week' },
];

function parseFieldValue(raw: string, spec: FieldSpec): number[] {
  const { min, max, name } = spec;

  // Wildcard: *
  if (raw === '*') {
    return rangeArray(min, max);
  }

  // Step on wildcard: */n
  const stepWildcard = /^\*\/(\d+)$/.exec(raw);
  if (stepWildcard) {
    const step = parseInt(stepWildcard[1]!, 10);
    if (step < 1) throw new Error(`Invalid step 0 in ${name} field`);
    const arr: number[] = [];
    for (let i = min; i <= max; i += step) {
      arr.push(i);
    }
    return arr;
  }

  // Range with optional step: a-b or a-b/n
  const rangeStep = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(raw);
  if (rangeStep) {
    const lo = parseInt(rangeStep[1]!, 10);
    const hi = parseInt(rangeStep[2]!, 10);
    const stepStr = rangeStep[3];
    const step = stepStr !== undefined ? parseInt(stepStr, 10) : 1;
    if (lo < min || lo > max) throw new Error(`${name} value ${lo} out of range [${min}-${max}]`);
    if (hi < min || hi > max) throw new Error(`${name} value ${hi} out of range [${min}-${max}]`);
    if (lo > hi) throw new Error(`${name} range start ${lo} > end ${hi}`);
    if (step < 1) throw new Error(`Invalid step 0 in ${name} field`);
    const arr: number[] = [];
    for (let i = lo; i <= hi; i += step) {
      arr.push(i);
    }
    return arr;
  }

  // Single number
  const single = /^\d+$/.exec(raw);
  if (single) {
    const val = parseInt(raw, 10);
    if (val < min || val > max)
      throw new Error(`${name} value ${val} out of range [${min}-${max}]`);
    return [val];
  }

  throw new Error(`Invalid ${name} field value: "${raw}"`);
}

function parseField(token: string, spec: FieldSpec): number[] {
  // Handle comma-separated list
  const parts = token.split(',');
  let values: number[] = [];
  for (const part of parts) {
    values = values.concat(parseFieldValue(part, spec));
  }
  return unique(values);
}

// ---------------------------------------------------------------------------
// Alias expansion
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseCron(expr: string): CronFields {
  const trimmed = expr.trim();

  // Resolve aliases
  const resolved = ALIASES[trimmed] ?? trimmed;

  const tokens = resolved.split(/\s+/);
  if (tokens.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${tokens.length}: "${expr}"`);
  }

  const [minTok, hrTok, domTok, monTok, dowTok] = tokens as [
    string,
    string,
    string,
    string,
    string,
  ];

  const minutes = parseField(minTok, FIELD_SPECS[0]);
  const hours = parseField(hrTok, FIELD_SPECS[1]);
  const daysOfMonth = parseField(domTok, FIELD_SPECS[2]);
  const months = parseField(monTok, FIELD_SPECS[3]);
  const daysOfWeek = parseField(dowTok, FIELD_SPECS[4]);

  // Determine restriction flags (true when the token is NOT a plain *)
  const domRestricted = domTok !== '*';
  const dowRestricted = dowTok !== '*';

  return { minutes, hours, daysOfMonth, months, daysOfWeek, domRestricted, dowRestricted };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

export function matches(fields: CronFields, date: Date): boolean {
  const m = date.getUTCMinutes();
  const h = date.getUTCHours();
  const dom = date.getUTCDate();
  const mon = date.getUTCMonth() + 1; // UTC month is 0-indexed
  const dow = date.getUTCDay();

  if (!fields.minutes.includes(m)) return false;
  if (!fields.hours.includes(h)) return false;
  if (!fields.months.includes(mon)) return false;

  // Day matching: OR semantics when both restricted; otherwise whichever is restricted
  if (fields.domRestricted && fields.dowRestricted) {
    if (!fields.daysOfMonth.includes(dom) && !fields.daysOfWeek.includes(dow)) return false;
  } else if (fields.domRestricted) {
    if (!fields.daysOfMonth.includes(dom)) return false;
  } else if (fields.dowRestricted) {
    if (!fields.daysOfWeek.includes(dow)) return false;
  }
  // neither restricted => every day matches (both are full range anyway)

  return true;
}

const MAX_SEARCH_MINUTES = 366 * 24 * 60; // 1 year in minutes

export function nextRun(expr: string, after: Date): Date {
  const fields = parseCron(expr);

  // Start searching from the next minute after `after`
  const start = new Date(after);
  // Zero out seconds and ms, then advance one minute
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  const candidate = new Date(start);

  for (let i = 0; i < MAX_SEARCH_MINUTES; i++) {
    if (matches(fields, candidate)) {
      return new Date(candidate);
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  throw new Error(`No matching time found within 366 days for expression: "${expr}"`);
}

export function missedRuns(expr: string, lastRun: Date, now: Date, cap = 100): Date[] {
  const fields = parseCron(expr);
  const results: Date[] = [];

  // Start from the minute after lastRun
  const start = new Date(lastRun);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  const candidate = new Date(start);

  // Window size guard: don't iterate more than 366 days
  const maxMs = MAX_SEARCH_MINUTES * 60 * 1000;
  const windowMs = now.getTime() - lastRun.getTime();
  if (windowMs > maxMs) {
    throw new Error('missedRuns window exceeds 366 days');
  }

  while (candidate <= now) {
    if (matches(fields, candidate)) {
      results.push(new Date(candidate));
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  // If over cap, keep the most recent `cap` entries
  if (results.length > cap) {
    return results.slice(results.length - cap);
  }
  return results;
}

// ---------------------------------------------------------------------------
// describe — best-effort human-readable summary
// ---------------------------------------------------------------------------

function describeField(values: number[], allMin: number, allMax: number, unit: string): string {
  if (values.length === allMax - allMin + 1) {
    return `every ${unit}`;
  }
  if (values.length === 1) {
    return `${unit} ${values[0]!}`;
  }
  return `${unit}s ${values.join(', ')}`;
}

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function describe(expr: string): string {
  const trimmed = expr.trim();

  // Alias shortcuts
  if (trimmed === '@hourly') return 'At minute 0 of every hour';
  if (trimmed === '@daily' || trimmed === '@midnight') return 'At midnight (00:00) every day';
  if (trimmed === '@weekly') return 'At midnight on Sunday every week';
  if (trimmed === '@monthly') return 'At midnight on the 1st of every month';

  const fields = parseCron(expr);

  // Minute part
  const minPart =
    fields.minutes.length === 60
      ? 'every minute'
      : fields.minutes.length === 1
        ? `minute ${fields.minutes[0]!}`
        : `minutes ${fields.minutes.join(', ')}`;

  // Hour part
  const hrPart =
    fields.hours.length === 24
      ? 'every hour'
      : fields.hours.length === 1
        ? `hour ${fields.hours[0]!}`
        : `hours ${fields.hours.join(', ')}`;

  // Month part
  const monPart =
    fields.months.length === 12
      ? ''
      : fields.months.map((m) => MONTH_NAMES[m] ?? String(m)).join(', ');

  // Day part
  let dayPart = '';
  if (fields.domRestricted && fields.dowRestricted) {
    const domStr = describeField(fields.daysOfMonth, 1, 31, 'day-of-month');
    const dowStr = fields.daysOfWeek.map((d) => DOW_NAMES[d] ?? String(d)).join(', ');
    dayPart = `${domStr} or ${dowStr}`;
  } else if (fields.domRestricted) {
    dayPart = describeField(fields.daysOfMonth, 1, 31, 'day');
  } else if (fields.dowRestricted) {
    dayPart = fields.daysOfWeek.map((d) => DOW_NAMES[d] ?? String(d)).join(', ');
  }

  const parts: string[] = [`At ${minPart} of ${hrPart}`];
  if (dayPart) parts.push(`on ${dayPart}`);
  if (monPart) parts.push(`in ${monPart}`);

  return parts.join(', ');
}
