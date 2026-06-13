/**
 * PresenceSettings (F1136/F1137): a small settings panel letting the user
 * set their display name, choose a color, and toggle presence privacy.
 *
 *   F1136 — per-device presence identity (name + color, persisted)
 *   F1137 — presence privacy toggle
 */
import { useState } from 'react';
import { PRESENCE_COLORS, type PresenceIdentity } from './identity.js';
import type { CollabHandle } from './useCollab.js';

interface PresenceSettingsProps {
  collab: CollabHandle;
  onClose: () => void;
}

export function PresenceSettings({ collab, onClose }: PresenceSettingsProps) {
  const [name, setName] = useState(collab.identity.name);
  const [color, setColor] = useState(collab.identity.color);

  const save = () => {
    const next: PresenceIdentity = { name: name.trim() || 'Anonymous', color };
    collab.setIdentity(next);
    onClose();
  };

  return (
    <div className="presence-settings" role="dialog" aria-label="Presence settings">
      <h3 className="presence-settings__title">Your presence</h3>

      <label className="presence-settings__field">
        <span>Display name</span>
        <input
          type="text"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="Anonymous"
        />
      </label>

      <fieldset className="presence-settings__colors">
        <legend>Color</legend>
        <div className="presence-settings__swatch-row">
          {PRESENCE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`presence-swatch${c === color ? ' presence-swatch--selected' : ''}`}
              style={{ background: c }}
              aria-label={c}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </fieldset>

      <label className="presence-settings__privacy">
        <input
          type="checkbox"
          checked={collab.isPrivate}
          onChange={(e) => collab.setPrivate(e.target.checked)}
        />
        <span>Hide my identity from peers (anonymous mode)</span>
      </label>

      <div className="presence-settings__actions">
        <button type="button" className="btn btn--primary" onClick={save}>
          Save
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
