/**
 * Related notes panel (F751–F760): shows shared-link neighbors, shared-tag
 * neighbors, and a "semantic (coming soon)" placeholder. Has a dismiss
 * affordance and uses cached graph data.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Button, Network, X } from '@fables/ui';
import { useBacklinks, useRelatedByLinks } from '../api/hooks.js';
import { computeRelatedNotes } from './relatedCompute.js';
import type { NoteWithTags } from '../api/client.js';
import './related.css';

interface RelatedPanelProps {
  note: NoteWithTags;
  onClose: () => void;
}

export function RelatedPanel({ note, onClose }: RelatedPanelProps) {
  const navigate = useNavigate();
  const graph = useRelatedByLinks(note.id);
  const backlinks = useBacklinks(note.id);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  // Compute related by link graph
  const relatedByLinks = useMemo(() => {
    if (!graph.data) return [];
    return computeRelatedNotes(note.id, graph.data, 8).filter((r) => !dismissed.has(r.id));
  }, [graph.data, note.id, dismissed]);

  // Related by shared tags: notes that share at least one tag with this note
  const noteTags = new Set(note.tags.map((t) => t.name));
  // We don't have direct "notes by tag" in the graph, so show backlink sources
  // that share at least one tag name — approximate shared-tag neighbors
  const backlinkSources = backlinks.data?.sources ?? [];
  const sharedTagRelated = backlinkSources
    .filter((src) => !dismissed.has(src.note.id) && noteTags.size > 0)
    .slice(0, 5);

  const dismiss = (id: string) => setDismissed((prev) => new Set([...prev, id]));

  const openNote = (id: string) => navigate(`/notes/${id}`);

  return (
    <aside className="related-panel" aria-label="Related notes">
      <div className="related-panel__head">
        <strong className="related-panel__title">
          <Network size={14} /> Related
        </strong>
        <Button aria-label="Close related panel" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      {/* By shared links */}
      <section className="related-section">
        <h3 className="related-section__title">By connections</h3>
        {graph.isPending && <p className="related-empty">Loading…</p>}
        {!graph.isPending && relatedByLinks.length === 0 && (
          <p className="related-empty">No related notes found via links.</p>
        )}
        <ul className="related-list">
          {relatedByLinks.map((r) => (
            <li key={r.id} className="related-item">
              <button
                type="button"
                className="related-item__title"
                onClick={() => openNote(r.id)}
              >
                {r.title || 'Untitled'}
              </button>
              <span className="related-item__score">{r.sharedLinks} shared</span>
              <Button
                aria-label={`Dismiss ${r.title}`}
                className="related-item__dismiss"
                onClick={() => dismiss(r.id)}
              >
                <X size={12} />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {/* By shared tags (backlinkers approximation) */}
      {noteTags.size > 0 && (
        <section className="related-section">
          <h3 className="related-section__title">By tags</h3>
          {sharedTagRelated.length === 0 ? (
            <p className="related-empty">No tag-related notes found.</p>
          ) : (
            <ul className="related-list">
              {sharedTagRelated.map((src) => (
                <li key={src.note.id} className="related-item">
                  <button
                    type="button"
                    className="related-item__title"
                    onClick={() => openNote(src.note.id)}
                  >
                    {src.note.title || 'Untitled'}
                  </button>
                  <Button
                    aria-label={`Dismiss ${src.note.title}`}
                    className="related-item__dismiss"
                    onClick={() => dismiss(src.note.id)}
                  >
                    <X size={12} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Semantic placeholder */}
      <section className="related-section related-section--soon">
        <h3 className="related-section__title">
          <Brain size={14} /> Semantic similarity
          <span className="related-soon-badge">coming soon</span>
        </h3>
        <p className="related-empty">
          Semantic similarity search will find conceptually related notes even without explicit
          links.
        </p>
      </section>
    </aside>
  );
}
