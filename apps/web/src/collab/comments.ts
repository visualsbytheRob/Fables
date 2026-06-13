/**
 * Anchored comments & suggestion mode (F1161–F1170).
 *
 * Comments are anchored to document ranges using Y.RelativePosition so they
 * survive edits (F1161). Each comment has:
 *   - A thread of replies (F1162)
 *   - A resolve state (F1162)
 *   - Optional suggestion payload (F1163): a proposed edit not yet applied
 *   - Emoji reactions (F1168)
 *
 * All comment data lives in a Y.Map on the shared Y.Doc. When collab is off,
 * we use a plain Map stored in module state (graceful degradation).
 *
 * Anchor survival guarantee (F1169): relative positions are computed via
 * Y.createRelativePositionFromTypeIndex and resolved back via
 * Y.createAbsolutePositionFromRelativePosition on the live Y.Text.
 */

import * as Y from 'yjs';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CommentReply {
  id: string;
  author: string;
  color: string;
  text: string;
  ts: number;
}

export interface CommentReaction {
  emoji: string;
  /** clientIds who reacted */
  by: number[];
}

export interface Suggestion {
  /** The text to replace the anchored range with. */
  replacement: string;
  /** Author who proposed the suggestion. */
  author: string;
  authorColor: string;
  ts: number;
  /** accepted | rejected | pending */
  status: 'pending' | 'accepted' | 'rejected';
}

export interface AnchoredComment {
  id: string;
  /** Y.RelativePosition encoded as base64 string for the range start. */
  anchorStart: string;
  /** Y.RelativePosition encoded as base64 string for the range end. */
  anchorEnd: string;
  /** Text of the anchored range at the time of creation (for display). */
  quotedText: string;
  /** Which doc/file this comment is on. */
  docKey: string;
  author: string;
  authorColor: string;
  body: string;
  ts: number;
  resolved: boolean;
  replies: CommentReply[];
  reactions: CommentReaction[];
  suggestion: Suggestion | null;
  /** knot name, for author-mode knot comments (F1165). Undefined when not a knot comment. */
  knotName?: string | undefined;
}

// ─── Serialization helpers ────────────────────────────────────────────────────

export function encodeRelPos(pos: Y.RelativePosition): string {
  return btoa(String.fromCharCode(...Y.encodeRelativePosition(pos)));
}

export function decodeRelPos(encoded: string): Y.RelativePosition {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  return Y.decodeRelativePosition(bytes);
}

// ─── CommentsStore ────────────────────────────────────────────────────────────

/**
 * Manages comments on a shared Y.Doc (or falls back to an in-memory store
 * when no Y.Doc is provided — for the non-collab editing path).
 */
export class CommentsStore {
  private _yMap: Y.Map<AnchoredComment> | null;
  /** Fallback for non-collab usage. */
  private _local = new Map<string, AnchoredComment>();
  private _listeners: Array<() => void> = [];

  constructor(yDoc?: Y.Doc | null) {
    if (yDoc) {
      this._yMap = yDoc.getMap('comments');
      this._yMap.observe(() => this._notify());
    } else {
      this._yMap = null;
    }
  }

  subscribe(fn: () => void): () => void {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== fn);
    };
  }

  private _notify() {
    this._listeners.forEach((fn) => fn());
  }

  private _get(id: string): AnchoredComment | undefined {
    return this._yMap ? this._yMap.get(id) : this._local.get(id);
  }

  private _set(id: string, comment: AnchoredComment) {
    if (this._yMap) {
      this._yMap.set(id, comment);
    } else {
      this._local.set(id, comment);
      this._notify();
    }
  }

  private _delete(id: string) {
    if (this._yMap) {
      this._yMap.delete(id);
    } else {
      this._local.delete(id);
      this._notify();
    }
  }

  getAll(): AnchoredComment[] {
    if (this._yMap) {
      const result: AnchoredComment[] = [];
      this._yMap.forEach((v) => result.push(v));
      return result;
    }
    return [...this._local.values()];
  }

  getForDoc(docKey: string): AnchoredComment[] {
    return this.getAll().filter((c) => c.docKey === docKey);
  }

  getUnresolved(docKey: string): AnchoredComment[] {
    return this.getForDoc(docKey).filter((c) => !c.resolved);
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  addComment(params: {
    docKey: string;
    yText?: Y.Text | null;
    from: number;
    to: number;
    quotedText: string;
    author: string;
    authorColor: string;
    body: string;
    knotName?: string;
    suggestion?: Omit<Suggestion, 'status'>;
  }): AnchoredComment {
    const id = `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let anchorStart = '';
    let anchorEnd = '';

    if (params.yText) {
      const startPos = Y.createRelativePositionFromTypeIndex(params.yText, params.from);
      const endPos = Y.createRelativePositionFromTypeIndex(params.yText, params.to);
      anchorStart = encodeRelPos(startPos);
      anchorEnd = encodeRelPos(endPos);
    }

    const comment: AnchoredComment = {
      id,
      anchorStart,
      anchorEnd,
      quotedText: params.quotedText,
      docKey: params.docKey,
      author: params.author,
      authorColor: params.authorColor,
      body: params.body,
      ts: Date.now(),
      resolved: false,
      replies: [],
      reactions: [],
      suggestion: params.suggestion ? { ...params.suggestion, status: 'pending' } : null,
      ...(params.knotName !== undefined ? { knotName: params.knotName } : {}),
    };

    this._set(id, comment);
    return comment;
  }

  // ─── Resolve ──────────────────────────────────────────────────────────────

  resolve(id: string) {
    const comment = this._get(id);
    if (!comment) return;
    this._set(id, { ...comment, resolved: true });
  }

  unresolve(id: string) {
    const comment = this._get(id);
    if (!comment) return;
    this._set(id, { ...comment, resolved: false });
  }

  deleteComment(id: string) {
    this._delete(id);
  }

  // ─── Replies (F1162) ─────────────────────────────────────────────────────

  addReply(commentId: string, reply: Omit<CommentReply, 'id'>): CommentReply | null {
    const comment = this._get(commentId);
    if (!comment) return null;
    const r: CommentReply = {
      id: `r-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...reply,
    };
    this._set(commentId, { ...comment, replies: [...comment.replies, r] });
    return r;
  }

  // ─── Reactions (F1168) ────────────────────────────────────────────────────

  toggleReaction(commentId: string, emoji: string, clientId: number) {
    const comment = this._get(commentId);
    if (!comment) return;
    const reactions = comment.reactions.map((r) => {
      if (r.emoji !== emoji) return r;
      const by = r.by.includes(clientId)
        ? r.by.filter((id) => id !== clientId)
        : [...r.by, clientId];
      return { ...r, by };
    });
    if (!reactions.find((r) => r.emoji === emoji)) {
      reactions.push({ emoji, by: [clientId] });
    }
    this._set(commentId, { ...comment, reactions });
  }

  // ─── Suggestions (F1163) ─────────────────────────────────────────────────

  /**
   * Accept a suggestion: returns the {from, to, insert} edit to apply to the
   * Y.Text (or CodeMirror doc), and marks the suggestion accepted.
   */
  acceptSuggestion(
    commentId: string,
    yText: Y.Text,
    yDoc: Y.Doc,
  ): { from: number; to: number; insert: string } | null {
    const comment = this._get(commentId);
    if (!comment?.suggestion || comment.suggestion.status !== 'pending') return null;

    const startRel = decodeRelPos(comment.anchorStart);
    const endRel = decodeRelPos(comment.anchorEnd);
    const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, yDoc);
    const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, yDoc);
    if (!startAbs || !endAbs) return null;

    const edit = {
      from: startAbs.index,
      to: endAbs.index,
      insert: comment.suggestion.replacement,
    };

    this._set(commentId, {
      ...comment,
      suggestion: { ...comment.suggestion, status: 'accepted' },
      resolved: true,
    });

    return edit;
  }

  rejectSuggestion(commentId: string) {
    const comment = this._get(commentId);
    if (!comment?.suggestion) return;
    this._set(commentId, {
      ...comment,
      suggestion: { ...comment.suggestion, status: 'rejected' },
      resolved: true,
    });
  }

  // ─── Anchor resolution (F1161/F1169) ─────────────────────────────────────

  /**
   * Resolve an anchor to the current document offset.
   * Returns null if the anchor no longer maps to a valid position
   * (e.g. the anchored text was fully deleted).
   */
  resolveAnchor(comment: AnchoredComment, yDoc: Y.Doc): { from: number; to: number } | null {
    if (!comment.anchorStart || !comment.anchorEnd) return null;
    try {
      const startRel = decodeRelPos(comment.anchorStart);
      const endRel = decodeRelPos(comment.anchorEnd);
      const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, yDoc);
      const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, yDoc);
      if (!startAbs || !endAbs) return null;
      return { from: startAbs.index, to: endAbs.index };
    } catch {
      return null;
    }
  }

  // ─── Search + Filter (F1166) ──────────────────────────────────────────────

  search(query: string, opts?: { docKey?: string; resolved?: boolean }): AnchoredComment[] {
    const q = query.toLowerCase();
    return this.getAll().filter((c) => {
      if (opts?.docKey && c.docKey !== opts.docKey) return false;
      if (opts?.resolved !== undefined && c.resolved !== opts.resolved) return false;
      if (q === '') return true;
      return (
        c.body.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.quotedText.toLowerCase().includes(q) ||
        c.replies.some((r) => r.text.toLowerCase().includes(q))
      );
    });
  }

  // ─── Export (F1167) ──────────────────────────────────────────────────────

  exportAsMarkdown(docKey?: string): string {
    const comments = docKey ? this.getForDoc(docKey) : this.getAll();
    if (comments.length === 0) return '';
    const lines: string[] = ['## Comments\n'];
    for (const c of comments) {
      lines.push(`### ${c.author} — ${new Date(c.ts).toLocaleString()}`);
      if (c.knotName) lines.push(`_Knot: ${c.knotName}_`);
      if (c.quotedText) lines.push(`> ${c.quotedText}`);
      lines.push('');
      lines.push(c.body);
      if (c.suggestion) {
        lines.push('');
        lines.push(`**Suggestion (${c.suggestion.status}):** \`${c.suggestion.replacement}\``);
      }
      if (c.resolved) lines.push('_Resolved_');
      for (const r of c.replies) {
        lines.push(`\n  **${r.author}:** ${r.text}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  destroy() {
    this._listeners = [];
    // Y.Map observer auto-removed when doc is destroyed
  }
}
