/**
 * Email importer tests (F1466).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmailAdapter } from './adapter.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'email-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const SIMPLE_EML = `From: Alice <alice@example.com>
To: Bob <bob@example.com>
Subject: Hello World
Date: Mon, 15 Jun 2026 10:00:00 +0000
Message-ID: <hello-world-001@example.com>

This is the email body.
It has multiple lines.
`;

const MBOX_CONTENT = `From alice@example.com Mon Jun 15 10:00:00 2026
From: Alice <alice@example.com>
To: Bob <bob@example.com>
Subject: First Email
Date: Mon, 15 Jun 2026 10:00:00 +0000
Message-ID: <first@example.com>

Body of first email.

From alice@example.com Mon Jun 15 11:00:00 2026
From: Alice <alice@example.com>
To: Bob <bob@example.com>
Subject: Second Email
Date: Mon, 15 Jun 2026 11:00:00 +0000
Message-ID: <second@example.com>

Body of second email.
`;

const FOLDED_HEADER_EML = `From: Very Long Name That Wraps
 Across Lines <long@example.com>
To: recipient@example.com
Subject: Folded Header Test
Date: Mon, 15 Jun 2026 09:00:00 +0000
Message-ID: <folded@example.com>

Body text here.
`;

const MULTIPART_EML = `From: sender@example.com
To: recipient@example.com
Subject: HTML Email
Date: Mon, 15 Jun 2026 12:00:00 +0000
Message-ID: <html-email@example.com>
Content-Type: multipart/alternative; boundary="boundary123"

--boundary123
Content-Type: text/plain

Plain text version.

--boundary123
Content-Type: text/html

<html><body><p>HTML version.</p></body></html>

--boundary123--
`;

describe('EmailAdapter (F1466)', () => {
  it('parses a single .eml file', () => {
    const file = path.join(root, 'hello.eml');
    fs.writeFileSync(file, SIMPLE_EML);
    const docs = new EmailAdapter({ path: file }).stage();
    expect(docs).toHaveLength(1);
  });

  it('maps Subject to title', () => {
    const file = path.join(root, 'hello.eml');
    fs.writeFileSync(file, SIMPLE_EML);
    const docs = new EmailAdapter({ path: file }).stage();
    expect(docs[0]!.title).toBe('Hello World');
  });

  it('sets notebookPath to [Email]', () => {
    const file = path.join(root, 'hello.eml');
    fs.writeFileSync(file, SIMPLE_EML);
    const docs = new EmailAdapter({ path: file }).stage();
    expect(docs[0]!.notebookPath).toEqual(['Email']);
  });

  it('sets createdAt from Date header as ISO-8601', () => {
    const file = path.join(root, 'hello.eml');
    fs.writeFileSync(file, SIMPLE_EML);
    const docs = new EmailAdapter({ path: file }).stage();
    expect(docs[0]!.createdAt).toBe('2026-06-15T10:00:00.000Z');
  });

  it('sourceId is Message-ID lowercased with angle brackets stripped', () => {
    const file = path.join(root, 'hello.eml');
    fs.writeFileSync(file, SIMPLE_EML);
    const docs = new EmailAdapter({ path: file }).stage();
    expect(docs[0]!.sourceId).toBe('hello-world-001@example.com');
  });

  it('includes From/To/Date header block in body', () => {
    const file = path.join(root, 'hello.eml');
    fs.writeFileSync(file, SIMPLE_EML);
    const docs = new EmailAdapter({ path: file }).stage();
    expect(docs[0]!.body).toContain('**From:** Alice');
    expect(docs[0]!.body).toContain('**To:** Bob');
    expect(docs[0]!.body).toContain('**Date:**');
    expect(docs[0]!.body).toContain('---');
    expect(docs[0]!.body).toContain('This is the email body.');
  });

  it('splits an mbox file into multiple messages', () => {
    const file = path.join(root, 'archive.mbox');
    fs.writeFileSync(file, MBOX_CONTENT);
    const docs = new EmailAdapter({ path: file }).stage();
    expect(docs).toHaveLength(2);
    expect(docs[0]!.title).toBe('First Email');
    expect(docs[1]!.title).toBe('Second Email');
  });

  it('mbox message sourceIds are set from Message-ID', () => {
    const file = path.join(root, 'archive.mbox');
    fs.writeFileSync(file, MBOX_CONTENT);
    const docs = new EmailAdapter({ path: file }).stage();
    expect(docs[0]!.sourceId).toBe('first@example.com');
    expect(docs[1]!.sourceId).toBe('second@example.com');
  });

  it('reads a directory of .eml files', () => {
    fs.writeFileSync(path.join(root, 'msg1.eml'), SIMPLE_EML);
    fs.writeFileSync(
      path.join(root, 'msg2.eml'),
      SIMPLE_EML.replace('Hello World', 'Another Email').replace(
        'hello-world-001@example.com',
        'another@example.com',
      ),
    );
    const docs = new EmailAdapter({ path: root }).stage();
    expect(docs).toHaveLength(2);
  });

  it('unfolds continuation headers', () => {
    const file = path.join(root, 'folded.eml');
    fs.writeFileSync(file, FOLDED_HEADER_EML);
    const docs = new EmailAdapter({ path: file }).stage();
    // folded 'From' header should be joined
    expect(docs[0]!.body).toContain('Very Long Name That Wraps Across Lines');
  });

  it('extracts text/plain from multipart messages', () => {
    const file = path.join(root, 'html.eml');
    fs.writeFileSync(file, MULTIPART_EML);
    const docs = new EmailAdapter({ path: file }).stage();
    expect(docs[0]!.body).toContain('Plain text version.');
    expect(docs[0]!.metadata?.['lossy']).toBeTruthy();
  });

  it('uses (no subject) for missing Subject', () => {
    const noSubject = `From: a@b.com\nTo: c@d.com\nDate: Mon, 15 Jun 2026 00:00:00 +0000\n\nBody.\n`;
    const file = path.join(root, 'nosub.eml');
    fs.writeFileSync(file, noSubject);
    const docs = new EmailAdapter({ path: file }).stage();
    expect(docs[0]!.title).toBe('(no subject)');
  });

  it('uses email-N as sourceId when Message-ID is missing', () => {
    const noMsgId = `From: a@b.com\nTo: c@d.com\nSubject: No ID\n\nBody.\n`;
    const file = path.join(root, 'nomsgid.eml');
    fs.writeFileSync(file, noMsgId);
    const docs = new EmailAdapter({ path: file }).stage();
    expect(docs[0]!.sourceId).toBe('email-0');
  });

  it('rejects non-.eml/.mbox files', () => {
    const file = path.join(root, 'email.txt');
    fs.writeFileSync(file, SIMPLE_EML);
    expect(() => new EmailAdapter({ path: file }).stage()).toThrow();
  });
});
