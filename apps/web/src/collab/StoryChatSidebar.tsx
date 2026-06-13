/**
 * StoryChatSidebar (F1158): session chat for collaborative story sessions.
 * Messages live in a shared Y.Array on the StoryCollabSession.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@fables/ui';
import type { StoryCollabSession, ChatMessage } from './storyCollab.js';
import './comments.css';

export interface StoryChatSidebarProps {
  session: StoryCollabSession;
  authorName: string;
  authorColor: string;
  onClose: () => void;
}

export function StoryChatSidebar({
  session,
  authorName,
  authorColor,
  onClose,
}: StoryChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => session.chat.toArray());
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setMessages(session.chat.toArray());
    session.chat.observe(handler);
    return () => session.chat.unobserve(handler);
  }, [session]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    session.sendChat(authorName, authorColor, t);
    setText('');
  };

  return (
    <div className="story-chat-sidebar" aria-label="Session chat">
      <div className="story-chat-header">
        <span>Chat</span>
        <Button onClick={onClose} aria-label="Close chat">
          ×
        </Button>
      </div>
      <div className="story-chat-messages" aria-live="polite" aria-label="Messages">
        {messages.length === 0 && (
          <p style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', marginTop: 12 }}>
            No messages yet.
          </p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className="story-chat-msg">
            <span className="story-chat-msg-author" style={{ color: msg.color }}>
              {msg.author}
            </span>
            <span className="story-chat-msg-text">{msg.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="story-chat-form">
        <Input
          placeholder="Say something…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Chat message"
        />
        <Button onClick={send} aria-label="Send message">
          Send
        </Button>
      </div>
    </div>
  );
}
