/**
 * Author-workspace store (F511/F512/F519): in-memory project buffers with
 * tabs, dirty tracking and immutable snapshots for useSyncExternalStore.
 * The store is pure client state — server persistence (debounced PUT per
 * file) subscribes from the page and never blocks editing.
 */

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export interface FileBuffer {
  /** Server file id; null for files created locally and not yet persisted. */
  readonly id: string | null;
  readonly path: string;
  readonly source: string;
  /** Last source acknowledged by the server (dirty = source !== savedSource). */
  readonly savedSource: string;
}

export interface WorkspaceState {
  readonly files: ReadonlyMap<string, FileBuffer>;
  readonly tabs: readonly string[];
  readonly active: string | null;
  /** Path shown in the second editor pane, when split (F518). */
  readonly split: string | null;
  readonly saveStates: ReadonlyMap<string, SaveState>;
  /** Bumped on every source change — compile/debounce triggers key off it. */
  readonly version: number;
}

type Listener = () => void;

export class WorkspaceStore {
  private state: WorkspaceState = {
    files: new Map(),
    tabs: [],
    active: null,
    split: null,
    saveStates: new Map(),
    version: 0,
  };
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): WorkspaceState => this.state;

  private set(next: Partial<WorkspaceState>, bumpVersion = false): void {
    this.state = {
      ...this.state,
      ...next,
      version: bumpVersion ? this.state.version + 1 : this.state.version,
    };
    for (const listener of this.listeners) listener();
  }

  /** Replace the project contents (initial load). Opens the entry tab. */
  init(files: readonly { id: string | null; path: string; source: string }[], entry?: string): void {
    const map = new Map<string, FileBuffer>();
    for (const f of files) {
      map.set(f.path, { id: f.id, path: f.path, source: f.source, savedSource: f.source });
    }
    const first = entry !== undefined && map.has(entry) ? entry : ([...map.keys()].sort()[0] ?? null);
    this.set(
      {
        files: map,
        tabs: first !== null ? [first] : [],
        active: first,
        split: null,
        saveStates: new Map(),
      },
      true,
    );
  }

  /** Current sources keyed by path (compiler/search input). */
  sources(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [path, buf] of this.state.files) out.set(path, buf.source);
    return out;
  }

  file(path: string): FileBuffer | undefined {
    return this.state.files.get(path);
  }

  isDirty(path: string): boolean {
    const buf = this.state.files.get(path);
    return buf !== undefined && buf.source !== buf.savedSource;
  }

  dirtyPaths(): string[] {
    return [...this.state.files.values()]
      .filter((b) => b.source !== b.savedSource)
      .map((b) => b.path);
  }

  updateSource(path: string, source: string): void {
    const buf = this.state.files.get(path);
    if (buf === undefined || buf.source === source) return;
    const files = new Map(this.state.files);
    files.set(path, { ...buf, source });
    const saveStates = new Map(this.state.saveStates);
    saveStates.set(path, 'dirty');
    this.set({ files, saveStates }, true);
  }

  /** Apply a text edit (quick fix / snippet) to a buffer. */
  applyEdit(path: string, from: number, to: number, insert: string): void {
    const buf = this.state.files.get(path);
    if (buf === undefined) return;
    this.updateSource(path, buf.source.slice(0, from) + insert + buf.source.slice(to));
  }

  /** Bulk replace (story-wide search & replace, F516). */
  applySources(changed: ReadonlyMap<string, string>): void {
    if (changed.size === 0) return;
    const files = new Map(this.state.files);
    const saveStates = new Map(this.state.saveStates);
    for (const [path, source] of changed) {
      const buf = files.get(path);
      if (buf === undefined || buf.source === source) continue;
      files.set(path, { ...buf, source });
      saveStates.set(path, 'dirty');
    }
    this.set({ files, saveStates }, true);
  }

  addFile(path: string, source = '', id: string | null = null): void {
    if (this.state.files.has(path)) {
      this.openTab(path);
      return;
    }
    const files = new Map(this.state.files);
    files.set(path, { id, path, source, savedSource: source });
    const saveStates = new Map(this.state.saveStates);
    // Local-only files (id === null) still need their first POST.
    if (id === null) saveStates.set(path, 'dirty');
    this.set({ files, saveStates }, true);
    this.openTab(path);
  }

  /** Record the server's acknowledgement of a save. */
  markSaved(path: string, savedSource: string, id?: string): void {
    const buf = this.state.files.get(path);
    if (buf === undefined) return;
    const files = new Map(this.state.files);
    files.set(path, { ...buf, savedSource, id: id ?? buf.id });
    const saveStates = new Map(this.state.saveStates);
    saveStates.set(path, buf.source === savedSource ? 'saved' : 'dirty');
    this.set({ files, saveStates });
  }

  setSaveState(path: string, save: SaveState): void {
    const saveStates = new Map(this.state.saveStates);
    saveStates.set(path, save);
    this.set({ saveStates });
  }

  openTab(path: string): void {
    if (!this.state.files.has(path)) return;
    const tabs = this.state.tabs.includes(path) ? this.state.tabs : [...this.state.tabs, path];
    this.set({ tabs, active: path });
  }

  closeTab(path: string): void {
    const tabs = this.state.tabs.filter((t) => t !== path);
    const active =
      this.state.active === path ? (tabs[tabs.length - 1] ?? null) : this.state.active;
    const split = this.state.split === path ? null : this.state.split;
    this.set({ tabs, active, split });
  }

  setActive(path: string): void {
    if (this.state.tabs.includes(path)) this.set({ active: path });
  }

  /** Toggle the split pane; defaults to mirroring the active file (F518). */
  setSplit(path: string | null): void {
    this.set({ split: path });
  }
}
