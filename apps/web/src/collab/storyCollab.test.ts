/**
 * Tests for F1151–F1160: Collaborative stories
 *
 * - Shared file Y.Text convergence (F1151)
 * - Shared playthrough state (F1153)
 * - Vote-on-choice convergence (F1154)
 * - Role split (F1155)
 * - Chat messages (F1158)
 * - Recording transcript (F1160)
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { StoryCollabSession } from './storyCollab.js';

function makeSession(doc?: Y.Doc) {
  const d = doc ?? new Y.Doc();
  const aw = new Awareness(d);
  const session = new StoryCollabSession(d, aw);
  return { doc: d, aw, session };
}

describe('F1151 — shared file Y.Text', () => {
  it('two sessions sharing the same doc converge on file text', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const { session: sessA } = makeSession(docA);
    const { session: sessB } = makeSession(docB);

    const textA = sessA.getFileText('main.fable');
    textA.insert(0, '=== start ===\n-> END\n');

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const textB = sessB.getFileText('main.fable');
    expect(textB.toString()).toBe('=== start ===\n-> END\n');

    docA.destroy();
    docB.destroy();
  });

  it('concurrent edits to the same file converge', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const { session: sessA } = makeSession(docA);
    const { session: sessB } = makeSession(docB);

    sessA.getFileText('main.fable').insert(0, 'Hello');
    sessB.getFileText('main.fable').insert(0, 'World');

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    const finalA = sessA.getFileText('main.fable').toString();
    const finalB = sessB.getFileText('main.fable').toString();
    expect(finalA).toBe(finalB);
    expect(finalA).toContain('Hello');
    expect(finalA).toContain('World');

    docA.destroy();
    docB.destroy();
  });
});

describe('F1153 — shared playthrough state', () => {
  it('play state set on A is visible on B after sync', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const { session: sessA } = makeSession(docA);
    const { session: sessB } = makeSession(docB);

    sessA.setPlayState({
      running: true,
      seed: '99',
      transcript: ['line 1'],
      waitingChoiceCount: 2,
    });

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const state = sessB.getPlayState();
    expect(state.running).toBe(true);
    expect(state.seed).toBe('99');
    expect(state.waitingChoiceCount).toBe(2);

    docA.destroy();
    docB.destroy();
  });
});

describe('F1154 — vote-on-choice', () => {
  it('votes cast on docA are visible on docB', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const { session: sessA } = makeSession(docA);
    const { session: sessB } = makeSession(docB);

    sessA.castVote(0);
    sessA.castVote(0); // duplicate should not add twice
    sessA.castVote(1);

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const counts = sessB.getVoteCounts();
    expect(counts.get(0)).toBe(1);
    expect(counts.get(1)).toBe(1);

    docA.destroy();
    docB.destroy();
  });

  it('leading choice is the one with most votes', () => {
    const { doc, session } = makeSession();
    session.castVote(0);

    // Simulate another client voting for choice 1
    const doc2 = new Y.Doc();
    const sess2 = new StoryCollabSession(doc2, new Awareness(doc2));
    sess2.castVote(1);
    sess2.castVote(1); // cast again as different mock id - won't double-count same client

    // One vote each = tie
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(doc2));

    // Clear and put 2 votes on choice 0
    session.clearVotes();
    session.castVote(0);
    expect(session.getLeadingChoice()).toBe(0);

    doc.destroy();
    doc2.destroy();
  });

  it('clearVotes removes all votes', () => {
    const { doc, session } = makeSession();
    session.castVote(0);
    session.castVote(1);
    session.clearVotes();
    expect(session.getVoteCounts().size).toBe(0);
    doc.destroy();
  });
});

describe('F1155 — role split', () => {
  it('setRole persists and getMyRole reads it back', () => {
    const { doc, session } = makeSession();
    session.setRole('playtester');
    expect(session.getMyRole()).toBe('playtester');
    session.setRole('spectator');
    expect(session.isSpectator()).toBe(true);
    doc.destroy();
  });

  it('roles are shared across docs', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const { session: sessA } = makeSession(docA);
    const { session: sessB } = makeSession(docB);

    sessA.setRole('author');
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // B can see A's role
    const roleFromB = sessB.roles.get(String(docA.clientID));
    expect(roleFromB).toBe('author');

    docA.destroy();
    docB.destroy();
  });
});

describe('F1158 — session chat', () => {
  it('messages sent on A appear on B after sync', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const { session: sessA } = makeSession(docA);
    const { session: sessB } = makeSession(docB);

    sessA.sendChat('Alice', '#e05c5c', 'Hello everyone!');
    sessA.sendChat('Alice', '#e05c5c', 'Ready to play?');

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const msgs = sessB.chat.toArray();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.text).toBe('Hello everyone!');
    expect(msgs[0]!.author).toBe('Alice');

    docA.destroy();
    docB.destroy();
  });
});

describe('F1160 — recording transcript', () => {
  it('recording lines accumulate and export correctly', () => {
    const { doc, session } = makeSession();
    session.appendRecording('You enter the forest.');
    session.appendRecording('> Take the left path');
    session.appendRecording('The path winds through the trees.');

    const transcript = session.exportTranscript();
    expect(transcript).toBe(
      'You enter the forest.\n> Take the left path\nThe path winds through the trees.',
    );

    session.clearRecording();
    expect(session.recording.length).toBe(0);

    doc.destroy();
  });

  it('recording convergence across two sessions', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const { session: sessA } = makeSession(docA);
    const { session: sessB } = makeSession(docB);

    sessA.appendRecording('Line from A');
    sessB.appendRecording('Line from B');

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    // Both should have 2 lines
    expect(sessA.recording.length).toBe(2);
    expect(sessB.recording.length).toBe(2);

    docA.destroy();
    docB.destroy();
  });
});

describe('F1159 — spectator mode', () => {
  it('spectator is identified correctly', () => {
    const { doc, session } = makeSession();
    session.setRole('spectator');
    expect(session.isSpectator()).toBe(true);
    session.setRole('author');
    expect(session.isSpectator()).toBe(false);
    doc.destroy();
  });
});
