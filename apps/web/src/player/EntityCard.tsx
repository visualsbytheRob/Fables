/**
 * Codex entity card (F615): a spoiler-safe view of one met entity. The server
 * only ever sends `revealedFields`, so the card simply renders the type,
 * encounter count and whatever facts the story has unlocked so far — never an
 * unrevealed field (F618 is enforced server-side; we just render what arrives).
 */
import { Compass, Flag, MapPin, Package, Shapes, Users } from '@fables/ui';
import type { ReactNode } from 'react';
import type { CodexEntry, EntityType } from '../api/client.js';

const TYPE_ICON: Record<EntityType, ReactNode> = {
  character: <Users size={16} />,
  place: <MapPin size={16} />,
  item: <Package size={16} />,
  faction: <Flag size={16} />,
  custom: <Shapes size={16} />,
};

/** Render a revealed field value compactly (lists join, scalars stringify). */
export function formatRevealed(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value === null || value === undefined) return '—';
  return String(value);
}

export function EntityCard({ entry }: { entry: CodexEntry }) {
  const fields = Object.entries(entry.revealedFields);
  return (
    <article className="codex-card" data-testid="codex-card">
      <header className="codex-card-head">
        <span className="codex-card-icon" aria-hidden>
          {TYPE_ICON[entry.type] ?? <Compass size={16} />}
        </span>
        <div className="codex-card-title">
          <strong>{entry.name}</strong>
          <small>
            {entry.type}
            {entry.encounters > 1 ? ` · met ${entry.encounters}×` : ''}
          </small>
        </div>
      </header>
      {fields.length === 0 ? (
        <p className="codex-card-empty">No facts revealed yet — read on to learn more.</p>
      ) : (
        <dl className="codex-card-fields">
          {fields.map(([name, value]) => (
            <div key={name} className="codex-card-field">
              <dt>{name}</dt>
              <dd>{formatRevealed(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
