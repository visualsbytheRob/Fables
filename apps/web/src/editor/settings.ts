/** Editor settings (F129): the component consumes these as a prop; callers persist them. */
export interface EditorSettings {
  /** Editor font size in px. */
  fontSize: number;
  /** Max line width in characters; 0 means full width. */
  lineWidth: number;
  /** Soft-wrap long lines instead of horizontal scrolling. */
  softWrap: boolean;
}

export const defaultEditorSettings: EditorSettings = {
  fontSize: 15,
  lineWidth: 80,
  softWrap: true,
};

const STORAGE_KEY = 'fables.editor.settings';

/** localStorage helpers for callers that own persistence (the component itself stays controlled). */
export function loadEditorSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultEditorSettings;
    return { ...defaultEditorSettings, ...(JSON.parse(raw) as Partial<EditorSettings>) };
  } catch {
    return defaultEditorSettings;
  }
}

export function saveEditorSettings(settings: EditorSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (private mode etc.) — settings just won't persist.
  }
}
