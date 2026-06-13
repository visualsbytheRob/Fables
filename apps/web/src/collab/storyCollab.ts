/**
 * storyCollab (F1151–F1160): Shared collab infrastructure for story editing.
 *
 * Extends the base collab provider to support:
 *   - Shared story-file editing per-file Y.Text (F1151)
 *   - Debounced shared compile coordination (F1152)
 *   - Shared playthrough state via Y.Map (F1153)
 *   - Vote-on-choice mode for group play (F1154)
 *   - Author/playtester role split (F1155)
 *   - Session chat via shared Y.Array (F1158)
 *   - Spectator mode (F1159)
 *   - Group-play session recording → transcript (F1160)
 *
 * All state lives in the shared Y.Doc so peers converge automatically.
 */

import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

// ─── Role ───────────────────────────────────────────────────────────────────

export type StoryRole = 'author' | 'playtester' | 'spectator';

// ─── Chat ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  author: string;
  color: string;
  text: string;
  ts: number; // ms epoch
}

// ─── Shared playthrough state (F1153) ────────────────────────────────────────

export interface SharedPlayState {
  /** Index of the current choice being voted on, or null when in narrative. */
  waitingChoiceCount: number | null;
  /** Transcript lines accumulated so far. */
  transcript: string[];
  /** Whether a run is currently active. */
  running: boolean;
  /** Seed used by the current run. */
  seed: string;
}

// ─── Vote (F1154) ────────────────────────────────────────────────────────────

export interface ChoiceVote {
  /** choice index → clientId[] */
  [choiceIndex: number]: number[];
}

// ─── Compile coordination (F1152) ────────────────────────────────────────────

/** Debounce ms shared across peers: first edit triggers compile after this delay. */
export const SHARED_COMPILE_DEBOUNCE_MS = 350;

// ─── StoryCollabSession ───────────────────────────────────────────────────────

export class StoryCollabSession {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;

  /**
   * Per-file Y.Text, keyed by file path.
   * Lazily created: call getFileText(path) to get or create.
   */
  private _fileTexts = new Map<string, Y.Text>();

  /** Shared playthrough state map (F1153). */
  readonly playState: Y.Map<unknown>;

  /** Vote map: choice index (string) → array of clientIds (F1154). */
  readonly votes: Y.Map<Y.Array<number>>;

  /** Session chat messages (F1158). */
  readonly chat: Y.Array<ChatMessage>;

  /** Recording transcript lines (F1160). */
  readonly recording: Y.Array<string>;

  /** Shared roles map: clientId (string) → StoryRole (F1155). */
  readonly roles: Y.Map<StoryRole>;

  constructor(doc: Y.Doc, awareness: Awareness) {
    this.doc = doc;
    this.awareness = awareness;
    this.playState = doc.getMap('story.playState');
    this.votes = doc.getMap('story.votes');
    this.chat = doc.getArray('story.chat');
    this.recording = doc.getArray('story.recording');
    this.roles = doc.getMap('story.roles');
  }

  /** Get (or create) the Y.Text for a story file. */
  getFileText(path: string): Y.Text {
    let t = this._fileTexts.get(path);
    if (!t) {
      t = this.doc.getText(`story.file:${path}`);
      this._fileTexts.set(path, t);
    }
    return t;
  }

  /** Set this client's role (F1155). */
  setRole(role: StoryRole) {
    this.roles.set(String(this.doc.clientID), role);
    this.awareness.setLocalStateField('storyRole', role);
  }

  /** Get this client's role (F1155). */
  getMyRole(): StoryRole {
    return (this.roles.get(String(this.doc.clientID)) as StoryRole | undefined) ?? 'author';
  }

  /** Is this client a spectator? (F1159) */
  isSpectator(): boolean {
    return this.getMyRole() === 'spectator';
  }

  // ─── Chat (F1158) ──────────────────────────────────────────────────────────

  sendChat(author: string, color: string, text: string) {
    const msg: ChatMessage = {
      id: `${this.doc.clientID}-${Date.now()}`,
      author,
      color,
      text,
      ts: Date.now(),
    };
    this.chat.push([msg]);
  }

  // ─── Votes (F1154) ─────────────────────────────────────────────────────────

  castVote(choiceIndex: number) {
    const key = String(choiceIndex);
    let arr = this.votes.get(key);
    if (!arr) {
      arr = new Y.Array<number>();
      this.votes.set(key, arr);
    }
    const myId = this.doc.clientID;
    const existing = arr.toArray();
    if (!existing.includes(myId)) {
      arr.push([myId]);
    }
  }

  clearVotes() {
    this.votes.forEach((_, key) => {
      this.votes.delete(key);
    });
  }

  getVoteCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    this.votes.forEach((arr, key) => {
      counts.set(Number(key), arr.length);
    });
    return counts;
  }

  /** Leading choice index by vote count, or null if tie/no votes. */
  getLeadingChoice(): number | null {
    const counts = this.getVoteCounts();
    if (counts.size === 0) return null;
    let best: number | null = null;
    let bestCount = 0;
    let tied = false;
    counts.forEach((count, idx) => {
      if (count > bestCount) {
        best = idx;
        bestCount = count;
        tied = false;
      } else if (count === bestCount) {
        tied = true;
      }
    });
    return tied ? null : best;
  }

  // ─── Play state (F1153) ────────────────────────────────────────────────────

  setPlayState(state: Partial<SharedPlayState>) {
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(state)) {
        this.playState.set(k, v);
      }
    });
  }

  getPlayState(): SharedPlayState {
    return {
      waitingChoiceCount: (this.playState.get('waitingChoiceCount') as number | null) ?? null,
      transcript: (this.playState.get('transcript') as string[]) ?? [],
      running: (this.playState.get('running') as boolean) ?? false,
      seed: (this.playState.get('seed') as string) ?? '42',
    };
  }

  // ─── Recording (F1160) ─────────────────────────────────────────────────────

  appendRecording(line: string) {
    this.recording.push([line]);
  }

  clearRecording() {
    this.recording.delete(0, this.recording.length);
  }

  exportTranscript(): string {
    return this.recording.toArray().join('\n');
  }
}
