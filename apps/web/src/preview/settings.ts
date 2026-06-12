/** Preview settings persistence (F136/F137): math + mermaid toggles. */
import { defaultPreviewSettings, type PreviewSettings } from './MarkdownPreview.js';

const STORAGE_KEY = 'fables.preview.settings';

export function loadPreviewSettings(): PreviewSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPreviewSettings;
    return { ...defaultPreviewSettings, ...(JSON.parse(raw) as Partial<PreviewSettings>) };
  } catch {
    return defaultPreviewSettings;
  }
}

export function savePreviewSettings(settings: PreviewSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable — settings just won't persist.
  }
}
