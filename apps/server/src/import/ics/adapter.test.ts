/**
 * ICS calendar importer tests (F1465).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IcsAdapter } from './adapter.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ics-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const BASIC_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event-001@example.com
SUMMARY:Team Meeting
DTSTART:20260615T090000Z
DTEND:20260615T100000Z
DESCRIPTION:Discuss Q3 goals\\nBring notes
LOCATION:Conference Room 1
END:VEVENT
BEGIN:VEVENT
UID:event-002@example.com
SUMMARY:Lunch Break
DTSTART:20260615T120000Z
DTEND:20260615T130000Z
END:VEVENT
END:VCALENDAR`;

const DATE_ONLY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:allday@example.com
SUMMARY:All Day Event
DTSTART;VALUE=DATE:20260701
DTEND;VALUE=DATE:20260702
END:VEVENT
END:VCALENDAR`;

// RFC 5545 fold: CRLF/LF + leading whitespace on next line is the fold indicator.
// Trailing space before the fold is part of the content, so after unfolding we get "multiple lines".
const FOLDED_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:folded@example.com',
  'SUMMARY:Folded Event',
  'DESCRIPTION:This is a very long description that gets folded across multiple ',
  ' lines in the ICS file format',
  'DTSTART:20260620T080000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\n');

describe('IcsAdapter (F1465)', () => {
  it('parses VEVENT blocks into StagedDocs', () => {
    const file = path.join(root, 'test.ics');
    fs.writeFileSync(file, BASIC_ICS);
    const docs = new IcsAdapter({ path: file }).stage();
    expect(docs).toHaveLength(2);
  });

  it('maps SUMMARY to title', () => {
    const file = path.join(root, 'test.ics');
    fs.writeFileSync(file, BASIC_ICS);
    const docs = new IcsAdapter({ path: file }).stage();
    expect(docs[0]!.title).toBe('Team Meeting');
    expect(docs[1]!.title).toBe('Lunch Break');
  });

  it('sets notebookPath to [Calendar]', () => {
    const file = path.join(root, 'test.ics');
    fs.writeFileSync(file, BASIC_ICS);
    const docs = new IcsAdapter({ path: file }).stage();
    expect(docs[0]!.notebookPath).toEqual(['Calendar']);
  });

  it('sets createdAt from DTSTART as ISO-8601', () => {
    const file = path.join(root, 'test.ics');
    fs.writeFileSync(file, BASIC_ICS);
    const docs = new IcsAdapter({ path: file }).stage();
    expect(docs[0]!.createdAt).toBe('2026-06-15T09:00:00.000Z');
  });

  it('includes date range, location, and description in body', () => {
    const file = path.join(root, 'test.ics');
    fs.writeFileSync(file, BASIC_ICS);
    const docs = new IcsAdapter({ path: file }).stage();
    expect(docs[0]!.body).toContain('🗓');
    expect(docs[0]!.body).toContain('📍 Conference Room 1');
    expect(docs[0]!.body).toContain('Discuss Q3 goals');
  });

  it('un-escapes \\n in DESCRIPTION', () => {
    const file = path.join(root, 'test.ics');
    fs.writeFileSync(file, BASIC_ICS);
    const docs = new IcsAdapter({ path: file }).stage();
    // \n in ICS DESCRIPTION should become actual newline
    expect(docs[0]!.body).toContain('Discuss Q3 goals\nBring notes');
  });

  it('sourceId is UID lowercased', () => {
    const file = path.join(root, 'test.ics');
    fs.writeFileSync(file, BASIC_ICS);
    const docs = new IcsAdapter({ path: file }).stage();
    expect(docs[0]!.sourceId).toBe('event-001@example.com');
    expect(docs[1]!.sourceId).toBe('event-002@example.com');
  });

  it('handles DATE-only DTSTART', () => {
    const file = path.join(root, 'allday.ics');
    fs.writeFileSync(file, DATE_ONLY_ICS);
    const docs = new IcsAdapter({ path: file }).stage();
    expect(docs[0]!.createdAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('unfolds continuation lines', () => {
    const file = path.join(root, 'folded.ics');
    fs.writeFileSync(file, FOLDED_ICS);
    const docs = new IcsAdapter({ path: file }).stage();
    expect(docs[0]!.body).toContain(
      'This is a very long description that gets folded across multiple lines',
    );
  });

  it('uses event-N as sourceId when UID is missing', () => {
    const noUid = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:No UID\nDTSTART:20260101T000000Z\nEND:VEVENT\nEND:VCALENDAR`;
    const file = path.join(root, 'nouid.ics');
    fs.writeFileSync(file, noUid);
    const docs = new IcsAdapter({ path: file }).stage();
    expect(docs[0]!.sourceId).toBe('event-0');
  });

  it('uses Event as title when SUMMARY is missing', () => {
    const noSummary = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x@y\nDTSTART:20260101T000000Z\nEND:VEVENT\nEND:VCALENDAR`;
    const file = path.join(root, 'nosummary.ics');
    fs.writeFileSync(file, noSummary);
    const docs = new IcsAdapter({ path: file }).stage();
    expect(docs[0]!.title).toBe('Event');
  });

  it('rejects non-.ics files', () => {
    const file = path.join(root, 'calendar.txt');
    fs.writeFileSync(file, BASIC_ICS);
    expect(() => new IcsAdapter({ path: file }).stage()).toThrow();
  });
});
