/**
 * useComments (F1161–F1170): React hook wrapping CommentsStore.
 *
 * Works in both collab mode (Y.Map-backed) and non-collab mode (in-memory).
 * The yDoc argument is optional — pass it when collab is active.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { CommentsStore } from './comments.js';
import type { AnchoredComment, CommentReply, Suggestion } from './comments.js';

export type { AnchoredComment, CommentReply, Suggestion };

export interface CommentsHandle {
  comments: AnchoredComment[];
  store: CommentsStore;
  addComment: (params: {
    from: number;
    to: number;
    quotedText: string;
    body: string;
    author: string;
    authorColor: string;
    yText?: Y.Text | null;
    knotName?: string;
    suggestion?: Omit<Suggestion, 'status'>;
  }) => AnchoredComment;
  resolve: (id: string) => void;
  unresolve: (id: string) => void;
  deleteComment: (id: string) => void;
  addReply: (commentId: string, reply: Omit<CommentReply, 'id'>) => CommentReply | null;
  toggleReaction: (commentId: string, emoji: string, clientId: number) => void;
  acceptSuggestion: (
    commentId: string,
    yText: Y.Text,
    yDoc: Y.Doc,
  ) => { from: number; to: number; insert: string } | null;
  rejectSuggestion: (commentId: string) => void;
  search: (query: string, opts?: { resolved?: boolean }) => AnchoredComment[];
  exportAsMarkdown: () => string;
}

export function useComments(docKey: string, yDoc?: Y.Doc | null): CommentsHandle {
  const storeRef = useRef<CommentsStore | null>(null);
  const prevDocRef = useRef<Y.Doc | null | undefined>(undefined);

  // Recreate store when yDoc changes
  if (prevDocRef.current !== yDoc) {
    storeRef.current?.destroy();
    storeRef.current = new CommentsStore(yDoc);
    prevDocRef.current = yDoc;
  }

  const store = storeRef.current!;
  const [, setTick] = useState(0);

  useEffect(() => {
    return store.subscribe(() => setTick((t) => t + 1));
  }, [store]);

  const comments = useMemo(() => store.getForDoc(docKey), [store, docKey]);

  const addComment = useCallback(
    (params: {
      from: number;
      to: number;
      quotedText: string;
      body: string;
      author: string;
      authorColor: string;
      yText?: Y.Text | null;
      knotName?: string;
      suggestion?: Omit<Suggestion, 'status'>;
    }) => store.addComment({ docKey, ...params }),
    [store, docKey],
  );

  const resolve = useCallback((id: string) => store.resolve(id), [store]);
  const unresolve = useCallback((id: string) => store.unresolve(id), [store]);
  const deleteComment = useCallback((id: string) => store.deleteComment(id), [store]);
  const addReply = useCallback(
    (commentId: string, reply: Omit<CommentReply, 'id'>) => store.addReply(commentId, reply),
    [store],
  );
  const toggleReaction = useCallback(
    (commentId: string, emoji: string, clientId: number) =>
      store.toggleReaction(commentId, emoji, clientId),
    [store],
  );
  const acceptSuggestion = useCallback(
    (commentId: string, yText: Y.Text, yd: Y.Doc) => store.acceptSuggestion(commentId, yText, yd),
    [store],
  );
  const rejectSuggestion = useCallback(
    (commentId: string) => store.rejectSuggestion(commentId),
    [store],
  );
  const search = useCallback(
    (query: string, opts?: { resolved?: boolean }) => store.search(query, { docKey, ...opts }),
    [store, docKey],
  );
  const exportAsMarkdown = useCallback(() => store.exportAsMarkdown(docKey), [store, docKey]);

  return {
    comments,
    store,
    addComment,
    resolve,
    unresolve,
    deleteComment,
    addReply,
    toggleReaction,
    acceptSuggestion,
    rejectSuggestion,
    search,
    exportAsMarkdown,
  };
}
