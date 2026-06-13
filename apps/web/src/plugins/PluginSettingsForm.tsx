/**
 * F1063 — Schema-driven plugin settings forms.
 *
 * Renders a form from a plugin's ContributedSettingsSection.fields array.
 * Controlled by the caller; call onSave with the updated values.
 */
import { useState } from 'react';
import { Button, Input, Select } from '@fables/ui';
import type { SettingsField } from './types.js';

export interface PluginSettingsFormProps {
  fields: SettingsField[];
  values: Record<string, unknown>;
  onSave: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

export function PluginSettingsForm({
  fields,
  values,
  onSave,
  disabled = false,
}: PluginSettingsFormProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of fields) {
      init[f.key] = values[f.key] ?? f.defaultValue ?? defaultForField(f);
    }
    return init;
  });

  function set(key: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      className="plugin-settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      {fields.map((field) => {
        const value = draft[field.key];
        return (
          <div key={field.key} className="plugin-settings-field">
            {field.type === 'toggle' ? (
              <label className="plugin-settings-field__toggle-row">
                <span className="plugin-settings-field__label">{field.label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(e) => set(field.key, e.target.checked)}
                  disabled={disabled}
                  aria-label={field.label}
                />
              </label>
            ) : field.type === 'select' ? (
              <>
                <label htmlFor={`psf-${field.key}`} className="plugin-settings-field__label">
                  {field.label}
                </label>
                <Select
                  id={`psf-${field.key}`}
                  value={String(value ?? '')}
                  onChange={(e) => set(field.key, e.target.value)}
                  disabled={disabled}
                  aria-label={field.label}
                >
                  {field.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </>
            ) : field.type === 'number' ? (
              <>
                <label htmlFor={`psf-${field.key}`} className="plugin-settings-field__label">
                  {field.label}
                </label>
                <Input
                  id={`psf-${field.key}`}
                  type="number"
                  value={String(value ?? '')}
                  min={field.min}
                  max={field.max}
                  onChange={(e) => set(field.key, Number(e.target.value))}
                  disabled={disabled}
                  aria-label={field.label}
                />
              </>
            ) : (
              /* text */
              <>
                <label htmlFor={`psf-${field.key}`} className="plugin-settings-field__label">
                  {field.label}
                </label>
                <Input
                  id={`psf-${field.key}`}
                  type="text"
                  value={String(value ?? '')}
                  placeholder={field.placeholder}
                  onChange={(e) => set(field.key, e.target.value)}
                  disabled={disabled}
                  aria-label={field.label}
                />
              </>
            )}
          </div>
        );
      })}
      <div className="plugin-settings-form__footer">
        <Button type="submit" variant="primary" disabled={disabled}>
          Save settings
        </Button>
      </div>
    </form>
  );
}

function defaultForField(f: SettingsField): unknown {
  switch (f.type) {
    case 'toggle':
      return false;
    case 'number':
      return 0;
    default:
      return '';
  }
}
