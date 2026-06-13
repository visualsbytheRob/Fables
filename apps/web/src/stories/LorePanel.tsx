/**
 * Lore side-pane (F628): lists the `[[Note]]` lore embeds and `@entity` /
 * `@entity.field` bindings found in the active file. Each ref is clickable and
 * jumps the editor to its first occurrence. Presentational — extraction lives
 * in `loreRefs.ts`.
 */
import { useMemo } from 'react';
import { BookOpen, Users } from '@fables/ui';
import { entityRefKey, entityRefLabel, extractLoreRefs } from './loreRefs.js';

export interface LorePanelProps {
  /** Path of the active file (header context); null when nothing is open. */
  activePath: string | null;
  /** Source of the active file. */
  source: string;
  /** Jump the editor to a byte offset in the active file. */
  onJump: (offset: number) => void;
}

export function LorePanel({ activePath, source, onJump }: LorePanelProps) {
  const refs = useMemo(() => extractLoreRefs(source), [source]);

  if (activePath === null) {
    return (
      <div className="lore-panel" data-testid="lore-panel">
        <p className="lore-empty">Open a file to inspect its lore bindings.</p>
      </div>
    );
  }

  const empty = refs.notes.length === 0 && refs.entities.length === 0;

  return (
    <div className="lore-panel" data-testid="lore-panel">
      <div className="lore-file">{activePath}</div>

      <section className="lore-section">
        <h4>
          <BookOpen size={13} /> Lore embeds
          <span className="lore-count">{refs.notes.length}</span>
        </h4>
        {refs.notes.length === 0 ? (
          <p className="lore-empty">No [[note]] embeds in this file.</p>
        ) : (
          <ul>
            {refs.notes.map((title) => {
              const offset = refs.offsets.get(`note:${title}`) ?? 0;
              return (
                <li key={title}>
                  <button className="lore-ref" onClick={() => onJump(offset)} title="Jump to first use">
                    <span className="lore-note">[[{title}]]</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="lore-section">
        <h4>
          <Users size={13} /> Entity bindings
          <span className="lore-count">{refs.entities.length}</span>
        </h4>
        {refs.entities.length === 0 ? (
          <p className="lore-empty">No @entity references in this file.</p>
        ) : (
          <ul>
            {refs.entities.map((ref) => {
              const key = entityRefKey(ref);
              const offset = refs.offsets.get(`entity:${key}`) ?? 0;
              return (
                <li key={key}>
                  <button className="lore-ref" onClick={() => onJump(offset)} title="Jump to first use">
                    <span className="lore-entity">{entityRefLabel(ref)}</span>
                    {ref.field !== null ? <span className="lore-field-tag">field</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {empty ? (
        <p className="lore-hint">
          Embed lore with <code>[[Note Title]]</code> and bind entities with <code>@Name</code> or{' '}
          <code>@Name.field</code>.
        </p>
      ) : null}
    </div>
  );
}
