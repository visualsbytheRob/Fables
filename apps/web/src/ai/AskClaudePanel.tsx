/**
 * "Ask your vault" panel (Epic 14 RAG, F1321–F1328): ask a question and get a
 * grounded, cited answer drawn only from your notes. Shows a confidence signal,
 * clickable sources, follow-up suggestions, and an honest "no sources" refusal
 * rather than a confident guess. Optionally files the answer as a note (F1327).
 */
import { useRef, useState, type FormEvent } from 'react';
import { Button, Sparkles, X, useToast } from '@fables/ui';
import { aiApi, type AskResult, type RagConfidence } from '../api/client.js';
import './ai.css';

export interface AskClaudePanelProps {
  /** Restrict retrieval to one notebook (F1323). Omit to search the whole vault. */
  notebookId?: string;
  onOpenNote: (noteId: string) => void;
  onClose: () => void;
}

interface Exchange {
  question: string;
  result: AskResult;
}

const CONFIDENCE_LABEL: Record<RagConfidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  none: 'No sources',
};

export function AskClaudePanel({ notebookId, onOpenNote, onClose }: AskClaudePanelProps) {
  const { toast } = useToast();
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const ask = async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    setFollowUps([]);
    try {
      const history = exchanges
        .filter((e) => e.result.available && e.result.ok)
        .map((e) => ({ question: e.question, answer: (e.result as { answer: string }).answer }))
        .slice(-4);
      const result = await aiApi.ask({
        question: trimmed,
        ...(notebookId !== undefined ? { notebookId } : {}),
        ...(history.length > 0 ? { history } : {}),
      });
      setExchanges((prev) => [...prev, { question: trimmed, result }]);
      setQuestion('');
      // Follow-ups are best-effort and never block the answer (F1328).
      if (result.available && result.ok) {
        const fu = await aiApi.followUps(trimmed, result.answer);
        if (fu.available && fu.ok) setFollowUps(fu.questions);
      }
    } catch (err) {
      toast(`Ask failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };

  const saveAnswer = async (q: string) => {
    try {
      const result = await aiApi.ask({
        question: q,
        ...(notebookId !== undefined ? { notebookId } : {}),
        save: true,
      });
      if (result.available && result.ok && result.savedNoteId) {
        toast('Saved answer as a note');
        onOpenNote(result.savedNoteId);
      } else {
        toast('Could not save that answer', 'error');
      }
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`, 'error');
    }
  };

  return (
    <aside className="ask-panel" aria-label="Ask your vault">
      <div className="ask-panel__head">
        <strong className="ask-panel__title">
          <Sparkles size={14} /> Ask Claude{notebookId ? ' (this notebook)' : ' your vault'}
        </strong>
        <Button aria-label="Close ask panel" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      <div className="ask-panel__thread">
        {exchanges.length === 0 && !busy && (
          <p className="ask-panel__hint">
            Ask a question and Claude answers using only your notes, with citations.
          </p>
        )}
        {exchanges.map((ex, i) => (
          <div key={i} className="ask-exchange">
            <p className="ask-exchange__q">{ex.question}</p>
            {!ex.result.available ? (
              <p className="ask-exchange__a ask-panel__muted">AI backend unavailable.</p>
            ) : !ex.result.ok ? (
              <p className="ask-exchange__a ask-panel__error">{ex.result.error}</p>
            ) : (
              <div className="ask-exchange__a">
                <p className="ask-answer">{ex.result.answer}</p>
                <div className="ask-meta">
                  <span className={`ask-confidence ask-confidence--${ex.result.confidence}`}>
                    {CONFIDENCE_LABEL[ex.result.confidence]}
                  </span>
                  {ex.result.grounded && !ex.result.citationsValid && (
                    <span className="ask-warn" title="Some citations don't resolve">
                      answer may be unsupported
                    </span>
                  )}
                  {ex.result.grounded && (
                    <button
                      type="button"
                      className="ask-link-btn"
                      onClick={() => void saveAnswer(ex.question)}
                    >
                      Save as note
                    </button>
                  )}
                </div>
                {ex.result.sources.length > 0 && (
                  <ul className="ask-sources">
                    {ex.result.sources.map((s) => (
                      <li key={s.n}>
                        <button
                          type="button"
                          className="ask-source"
                          onClick={() => onOpenNote(s.id)}
                        >
                          <span className="ask-source__n">[{s.n}]</span> {s.title || 'Untitled'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <p className="ask-panel__status" role="status">
            <span className="ai-spinner" aria-hidden /> Searching your vault…
          </p>
        )}
      </div>

      {followUps.length > 0 && (
        <div className="ask-followups">
          {followUps.map((q) => (
            <button key={q} type="button" className="ask-chip" onClick={() => void ask(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      <form className="ask-panel__form" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          className="ui-input"
          aria-label="Your question"
          placeholder="Ask your notes…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
        />
        <Button type="submit" variant="primary" disabled={busy || question.trim().length === 0}>
          Ask
        </Button>
      </form>
    </aside>
  );
}
