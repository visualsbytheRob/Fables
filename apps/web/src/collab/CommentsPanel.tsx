/**
 * CommentsPanel (F1161–F1170): side panel for anchored comments & suggestions.
 *
 * Features:
 *   F1161 — anchored comments (shown with quoted text)
 *   F1162 — threads with resolve toggle
 *   F1163 — suggestion mode: accept / reject
 *   F1164 — comment notifications via toast (new comments)
 *   F1165 — knot-mode comments shown with knot name badge
 *   F1166 — search + filter (resolved / unresolved)
 *   F1167 — export button
 *   F1168 — emoji reactions
 */

import { useState } from 'react';
import { Button, Input, useToast } from '@fables/ui';
import type { AnchoredComment } from './comments.js';
import type { CommentsHandle } from './useComments.js';
import './comments.css';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀'];

function ThreadCard({
  comment,
  handle,
  clientId,
  replyAuthor,
}: {
  comment: AnchoredComment;
  handle: CommentsHandle;
  clientId: number;
  replyAuthor: string;
}) {
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);

  const submitReply = () => {
    const t = replyText.trim();
    if (!t) return;
    handle.addReply(comment.id, { author: replyAuthor, color: '#5c7ce0', text: t, ts: Date.now() });
    setReplyText('');
    setShowReply(false);
  };

  return (
    <div
      className={`comment-card${comment.resolved ? ' comment-card--resolved' : ''}${comment.suggestion ? ' comment-card--suggestion' : ''}`}
      data-testid={`comment-${comment.id}`}
    >
      {comment.knotName && <span className="comment-knot-badge">{comment.knotName}</span>}
      {comment.quotedText && (
        <blockquote className="comment-quote">&ldquo;{comment.quotedText}&rdquo;</blockquote>
      )}
      <div className="comment-header">
        <span className="comment-author" style={{ color: comment.authorColor }}>
          {comment.author}
        </span>
        <span className="comment-ts">{new Date(comment.ts).toLocaleString()}</span>
        {comment.resolved ? <span className="comment-resolved-badge">Resolved</span> : null}
      </div>
      <p className="comment-body">{comment.body}</p>

      {/* Suggestion (F1163) */}
      {comment.suggestion && comment.suggestion.status === 'pending' && (
        <div className="comment-suggestion">
          <span className="comment-suggestion-label">Suggested change:</span>
          <code className="comment-suggestion-text">{comment.suggestion.replacement}</code>
          <div className="comment-suggestion-actions">
            <Button
              variant="primary"
              onClick={() => {
                // Acceptance requires yText + yDoc — signal up via custom event
                document.dispatchEvent(
                  new CustomEvent('fables:acceptSuggestion', { detail: { commentId: comment.id } }),
                );
              }}
              aria-label="Accept suggestion"
            >
              Accept
            </Button>
            <Button
              variant="danger"
              onClick={() => handle.rejectSuggestion(comment.id)}
              aria-label="Reject suggestion"
            >
              Reject
            </Button>
          </div>
        </div>
      )}
      {comment.suggestion && comment.suggestion.status !== 'pending' && (
        <div className="comment-suggestion comment-suggestion--settled">
          Suggestion {comment.suggestion.status}
        </div>
      )}

      {/* Replies (F1162) */}
      {comment.replies.length > 0 && (
        <div className="comment-replies">
          {comment.replies.map((r) => (
            <div key={r.id} className="comment-reply">
              <span className="comment-author" style={{ color: r.color }}>
                {r.author}
              </span>
              <span className="comment-reply-body">{r.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Reactions (F1168) */}
      <div className="comment-reactions">
        {REACTION_EMOJIS.map((emoji) => {
          const reaction = comment.reactions.find((r) => r.emoji === emoji);
          const count = reaction?.by.length ?? 0;
          const active = reaction?.by.includes(clientId) ?? false;
          return (
            <button
              key={emoji}
              className={`reaction-btn${active ? ' active' : ''}`}
              onClick={() => handle.toggleReaction(comment.id, emoji, clientId)}
              aria-label={`React with ${emoji}`}
            >
              {emoji} {count > 0 ? count : null}
            </button>
          );
        })}
      </div>

      {/* Actions */}
      <div className="comment-actions">
        <Button onClick={() => setShowReply((v) => !v)}>Reply</Button>
        {comment.resolved ? (
          <Button onClick={() => handle.unresolve(comment.id)}>Reopen</Button>
        ) : (
          <Button onClick={() => handle.resolve(comment.id)} aria-label="Resolve comment">
            Resolve
          </Button>
        )}
        <Button onClick={() => handle.deleteComment(comment.id)} aria-label="Delete comment">
          ×
        </Button>
      </div>

      {showReply && (
        <div className="comment-reply-form">
          <Input
            placeholder="Reply…"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitReply();
              }
            }}
          />
          <Button onClick={submitReply}>Send</Button>
        </div>
      )}
    </div>
  );
}

export interface CommentsPanelProps {
  handle: CommentsHandle;
  clientId: number;
  authorName: string;
  onClose: () => void;
  onExport?: (md: string) => void;
}

export function CommentsPanel({
  handle,
  clientId,
  authorName,
  onClose,
  onExport,
}: CommentsPanelProps) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [filterResolved, setFilterResolved] = useState<boolean | undefined>(false);

  const displayed =
    filterResolved === undefined
      ? handle.search(query)
      : handle.search(query, { resolved: filterResolved });

  const handleExport = () => {
    const md = handle.exportAsMarkdown();
    if (onExport) {
      onExport(md);
    } else {
      void navigator.clipboard.writeText(md).then(
        () => toast('Comments copied as Markdown'),
        () => toast('Copy failed', 'error'),
      );
    }
  };

  return (
    <aside className="comments-panel" aria-label="Comments">
      <div className="comments-panel-header">
        <span className="comments-panel-title">Comments</span>
        <Button onClick={onClose} aria-label="Close comments panel">
          ×
        </Button>
      </div>

      {/* Filter / Search (F1166) */}
      <div className="comments-panel-toolbar">
        <Input
          placeholder="Search comments…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search comments"
          className="comments-search"
        />
        <select
          className="ui-select"
          value={filterResolved === undefined ? 'all' : filterResolved ? 'resolved' : 'open'}
          onChange={(e) => {
            const v = e.target.value;
            setFilterResolved(v === 'all' ? undefined : v === 'resolved');
          }}
          aria-label="Filter by status"
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <Button onClick={handleExport} title="Export comments as Markdown (F1167)">
          Export
        </Button>
      </div>

      <div className="comments-panel-list">
        {displayed.length === 0 && (
          <p className="comments-empty">{query ? 'No matching comments.' : 'No comments yet.'}</p>
        )}
        {displayed.map((c) => (
          <ThreadCard
            key={c.id}
            comment={c}
            handle={handle}
            clientId={clientId}
            replyAuthor={authorName}
          />
        ))}
      </div>
    </aside>
  );
}
