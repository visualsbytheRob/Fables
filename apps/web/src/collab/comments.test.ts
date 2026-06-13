/**
 * Tests for F1161–F1170: Comments & Suggestions
 *
 * - Anchor survival through heavy edits (F1169)
 * - Thread + resolve flow (F1162)
 * - Suggestion accept/reject (F1163)
 * - Search + filter (F1166)
 * - Export (F1167)
 * - Reactions (F1168)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { CommentsStore } from './comments.js';

function makeDoc() {
  const doc = new Y.Doc();
  const yText = doc.getText('body');
  return { doc, yText };
}

describe('F1161 — anchored comments', () => {
  it('creates a comment with relative position anchors', () => {
    const { doc, yText } = makeDoc();
    const store = new CommentsStore(doc);

    yText.insert(0, 'Hello world');
    const comment = store.addComment({
      docKey: 'test',
      yText,
      from: 6,
      to: 11,
      quotedText: 'world',
      author: 'Alice',
      authorColor: '#e05c5c',
      body: 'Great word choice',
    });

    expect(comment.anchorStart).toBeTruthy();
    expect(comment.anchorEnd).toBeTruthy();
    expect(comment.quotedText).toBe('world');
  });

  it('F1169 — anchors survive heavy edits (insertions before anchor)', () => {
    const { doc, yText } = makeDoc();
    const store = new CommentsStore(doc);

    yText.insert(0, 'Hello world');
    const comment = store.addComment({
      docKey: 'test',
      yText,
      from: 6,
      to: 11,
      quotedText: 'world',
      author: 'Alice',
      authorColor: '#e05c5c',
      body: 'Anchored to "world"',
    });

    // Insert a large prefix before the anchor
    yText.insert(0, 'PREAMBLE: ');

    const resolved = store.resolveAnchor(comment, doc);
    expect(resolved).not.toBeNull();
    // Anchor should have shifted by 10 characters
    expect(resolved!.from).toBe(16); // 6 + 10
    expect(resolved!.to).toBe(21); // 11 + 10
  });

  it('F1169 — anchors survive deletions before anchor', () => {
    const { doc, yText } = makeDoc();
    const store = new CommentsStore(doc);

    yText.insert(0, 'Hello world end');
    const comment = store.addComment({
      docKey: 'test',
      yText,
      from: 12,
      to: 15,
      quotedText: 'end',
      author: 'Bob',
      authorColor: '#5c7ce0',
      body: 'End comment',
    });

    // Delete characters before the anchor
    yText.delete(0, 6); // delete "Hello "

    const resolved = store.resolveAnchor(comment, doc);
    expect(resolved).not.toBeNull();
    expect(resolved!.from).toBe(6); // 12 - 6
    expect(resolved!.to).toBe(9); // 15 - 6
  });
});

describe('F1162 — comment threads + resolve', () => {
  let doc: Y.Doc;
  let store: CommentsStore;
  let commentId: string;

  beforeEach(() => {
    doc = new Y.Doc();
    const yText = doc.getText('body');
    yText.insert(0, 'Some text here');
    store = new CommentsStore(doc);
    const comment = store.addComment({
      docKey: 'doc1',
      yText,
      from: 0,
      to: 4,
      quotedText: 'Some',
      author: 'Alice',
      authorColor: '#e05c5c',
      body: 'Opening comment',
    });
    commentId = comment.id;
  });

  it('resolves and unresolves a comment', () => {
    expect(store.getForDoc('doc1')[0]!.resolved).toBe(false);
    store.resolve(commentId);
    expect(store.getForDoc('doc1')[0]!.resolved).toBe(true);
    store.unresolve(commentId);
    expect(store.getForDoc('doc1')[0]!.resolved).toBe(false);
  });

  it('adds replies to a thread', () => {
    const reply = store.addReply(commentId, {
      author: 'Bob',
      color: '#5c7ce0',
      text: 'I agree',
      ts: Date.now(),
    });
    expect(reply).not.toBeNull();
    const comment = store.getForDoc('doc1')[0]!;
    expect(comment.replies).toHaveLength(1);
    expect(comment.replies[0]!.text).toBe('I agree');
  });

  it('deletes a comment', () => {
    store.deleteComment(commentId);
    expect(store.getForDoc('doc1')).toHaveLength(0);
  });
});

describe('F1163 — suggestion mode', () => {
  it('accept applies the replacement edit and marks accepted', () => {
    const doc = new Y.Doc();
    const yText = doc.getText('body');
    yText.insert(0, 'quick brown fox');
    const store = new CommentsStore(doc);

    const comment = store.addComment({
      docKey: 'doc',
      yText,
      from: 6,
      to: 11,
      quotedText: 'brown',
      author: 'Alice',
      authorColor: '#e05c5c',
      body: 'Change colour?',
      suggestion: {
        replacement: 'red',
        author: 'Alice',
        authorColor: '#e05c5c',
        ts: Date.now(),
      },
    });

    const edit = store.acceptSuggestion(comment.id, yText, doc);
    expect(edit).not.toBeNull();
    expect(edit!.insert).toBe('red');

    const updated = store.getForDoc('doc')[0]!;
    expect(updated.suggestion!.status).toBe('accepted');
    expect(updated.resolved).toBe(true);
  });

  it('reject marks suggestion as rejected', () => {
    const doc = new Y.Doc();
    const yText = doc.getText('body');
    yText.insert(0, 'quick brown fox');
    const store = new CommentsStore(doc);

    const comment = store.addComment({
      docKey: 'doc',
      yText,
      from: 0,
      to: 5,
      quotedText: 'quick',
      author: 'Bob',
      authorColor: '#5c7ce0',
      body: 'Suggestion',
      suggestion: {
        replacement: 'slow',
        author: 'Bob',
        authorColor: '#5c7ce0',
        ts: Date.now(),
      },
    });

    store.rejectSuggestion(comment.id);
    const updated = store.getForDoc('doc')[0]!;
    expect(updated.suggestion!.status).toBe('rejected');
    expect(updated.resolved).toBe(true);
  });
});

describe('F1166 — comment search + filter', () => {
  it('filters by query text and resolve state', () => {
    const doc = new Y.Doc();
    const yText = doc.getText('body');
    yText.insert(0, 'test content');
    const store = new CommentsStore(doc);

    const c1 = store.addComment({
      docKey: 'doc',
      yText,
      from: 0,
      to: 4,
      quotedText: 'test',
      author: 'Alice',
      authorColor: '#000',
      body: 'Alpha comment',
    });
    const c2 = store.addComment({
      docKey: 'doc',
      yText,
      from: 5,
      to: 12,
      quotedText: 'content',
      author: 'Bob',
      authorColor: '#000',
      body: 'Beta note',
    });
    store.resolve(c2.id);

    const alphaResults = store.search('alpha');
    expect(alphaResults).toHaveLength(1);
    expect(alphaResults[0]!.id).toBe(c1.id);

    const unresolvedResults = store.search('', { resolved: false });
    expect(unresolvedResults).toHaveLength(1);
    expect(unresolvedResults[0]!.id).toBe(c1.id);

    const resolvedResults = store.search('', { resolved: true });
    expect(resolvedResults).toHaveLength(1);
    expect(resolvedResults[0]!.id).toBe(c2.id);
  });
});

describe('F1167 — comment export', () => {
  it('exports comments as Markdown', () => {
    const doc = new Y.Doc();
    const yText = doc.getText('body');
    yText.insert(0, 'hello world');
    const store = new CommentsStore(doc);

    store.addComment({
      docKey: 'doc',
      yText,
      from: 0,
      to: 5,
      quotedText: 'hello',
      author: 'Alice',
      authorColor: '#e05c5c',
      body: 'Great opening',
      knotName: 'start',
    });

    const md = store.exportAsMarkdown('doc');
    expect(md).toContain('## Comments');
    expect(md).toContain('Alice');
    expect(md).toContain('Great opening');
    expect(md).toContain('hello');
    expect(md).toContain('Knot: start');
  });
});

describe('F1168 — emoji reactions', () => {
  it('toggles reactions on/off per clientId', () => {
    const doc = new Y.Doc();
    const yText = doc.getText('body');
    yText.insert(0, 'test');
    const store = new CommentsStore(doc);

    const comment = store.addComment({
      docKey: 'doc',
      yText,
      from: 0,
      to: 4,
      quotedText: 'test',
      author: 'Alice',
      authorColor: '#e05c5c',
      body: 'body',
    });

    store.toggleReaction(comment.id, '👍', 123);
    let updated = store.getForDoc('doc')[0]!;
    expect(updated.reactions).toHaveLength(1);
    expect(updated.reactions[0]!.emoji).toBe('👍');
    expect(updated.reactions[0]!.by).toContain(123);

    // Toggle again to remove
    store.toggleReaction(comment.id, '👍', 123);
    updated = store.getForDoc('doc')[0]!;
    expect(updated.reactions[0]!.by).not.toContain(123);
  });
});

describe('CommentsStore — non-collab (in-memory) mode', () => {
  it('works without a Y.Doc', () => {
    const store = new CommentsStore(null);
    const comment = store.addComment({
      docKey: 'local',
      from: 0,
      to: 5,
      quotedText: 'hello',
      author: 'Me',
      authorColor: '#000',
      body: 'Local comment',
    });
    expect(store.getForDoc('local')).toHaveLength(1);
    store.resolve(comment.id);
    expect(store.getForDoc('local')[0]!.resolved).toBe(true);
  });

  it('fires subscribers on change', () => {
    const store = new CommentsStore(null);
    let fired = 0;
    const unsub = store.subscribe(() => {
      fired++;
    });
    store.addComment({
      docKey: 'x',
      from: 0,
      to: 0,
      quotedText: '',
      author: 'A',
      authorColor: '#000',
      body: 'B',
    });
    expect(fired).toBe(1);
    unsub();
    store.addComment({
      docKey: 'x',
      from: 0,
      to: 0,
      quotedText: '',
      author: 'A',
      authorColor: '#000',
      body: 'C',
    });
    expect(fired).toBe(1); // unsubscribed
  });
});

describe('F1162 — Y.Map collab convergence for comments', () => {
  it('comments added on docA are visible on docB after sync', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const storeA = new CommentsStore(docA);
    const storeB = new CommentsStore(docB);

    const yTextA = docA.getText('body');
    yTextA.insert(0, 'shared content');

    storeA.addComment({
      docKey: 'shared',
      yText: yTextA,
      from: 0,
      to: 6,
      quotedText: 'shared',
      author: 'Alice',
      authorColor: '#e05c5c',
      body: 'Comment from A',
    });

    // Sync A→B
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const commentsB = storeB.getForDoc('shared');
    expect(commentsB).toHaveLength(1);
    expect(commentsB[0]!.body).toBe('Comment from A');

    docA.destroy();
    docB.destroy();
  });
});
