/**
 * F1041–F1050 — Plugin Extension Registry.
 *
 * A React context that accumulates all plugin contributions. Pages and shell
 * components read from this to render contributed sidebar panels, commands,
 * toolbar buttons, status-bar items, etc.
 *
 * Design: purely additive, imperative registration (not React-managed state)
 * so that plugin code running outside React components can still register.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type {
  ContextMenuItemRegistration,
  PluginCommandRegistration,
  RouteRegistration,
  SidebarPanelRegistration,
  SettingsSectionRegistration,
  StatusBarItemRegistration,
  ThemeRegistration,
  ToolbarButtonRegistration,
} from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Registry state shape
// ────────────────────────────────────────────────────────────────────────────

export interface ExtensionRegistry {
  sidebarPanels: SidebarPanelRegistration[];
  commands: PluginCommandRegistration[];
  contextMenuItems: ContextMenuItemRegistration[];
  toolbarButtons: ToolbarButtonRegistration[];
  settingsSections: SettingsSectionRegistration[];
  routes: RouteRegistration[];
  statusBarItems: StatusBarItemRegistration[];
  themes: ThemeRegistration[];
}

const emptyRegistry: ExtensionRegistry = {
  sidebarPanels: [],
  commands: [],
  contextMenuItems: [],
  toolbarButtons: [],
  settingsSections: [],
  routes: [],
  statusBarItems: [],
  themes: [],
};

// ────────────────────────────────────────────────────────────────────────────
// Context + Provider
// ────────────────────────────────────────────────────────────────────────────

/** Read-only view of the current registry. */
const RegistryContext = createContext<ExtensionRegistry>(emptyRegistry);

/** Mutator – provided only inside PluginRegistryProvider. */
interface RegistryMutator {
  addSidebarPanel(r: SidebarPanelRegistration): () => void;
  addCommand(r: PluginCommandRegistration): () => void;
  addContextMenuItem(r: ContextMenuItemRegistration): () => void;
  addToolbarButton(r: ToolbarButtonRegistration): () => void;
  addSettingsSection(r: SettingsSectionRegistration): () => void;
  addRoute(r: RouteRegistration): () => void;
  addStatusBarItem(r: StatusBarItemRegistration): () => void;
  addTheme(r: ThemeRegistration): () => void;
}

const MutatorContext = createContext<RegistryMutator | null>(null);

export function PluginRegistryProvider({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<ExtensionRegistry>(emptyRegistry);

  /** Generic helper: add an item to an array field and return a removal callback. */
  function makeAdder<K extends keyof ExtensionRegistry>(
    field: K,
  ): (item: ExtensionRegistry[K][number]) => () => void {
    return (item) => {
      setRegistry((prev) => ({
        ...prev,
        [field]: [...(prev[field] as unknown[]), item],
      }));
      return () => {
        setRegistry((prev) => ({
          ...prev,
          [field]: (prev[field] as unknown[]).filter((x) => x !== item),
        }));
      };
    };
  }

  const mutator: RegistryMutator = useMemo(
    () => ({
      addSidebarPanel: makeAdder('sidebarPanels'),
      addCommand: makeAdder('commands'),
      addContextMenuItem: makeAdder('contextMenuItems'),
      addToolbarButton: makeAdder('toolbarButtons'),
      addSettingsSection: makeAdder('settingsSections'),
      addRoute: makeAdder('routes'),
      addStatusBarItem: makeAdder('statusBarItems'),
      addTheme: makeAdder('themes'),
    }),
    // makeAdder is a stable function that captures setState — empty dep array is correct.
    // Intentional: the mutator object never changes across renders.
    [],
  );

  return (
    <MutatorContext.Provider value={mutator}>
      <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
    </MutatorContext.Provider>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Read hooks
// ────────────────────────────────────────────────────────────────────────────

export function useExtensionRegistry(): ExtensionRegistry {
  return useContext(RegistryContext);
}

export function usePluginSidebarPanels(): SidebarPanelRegistration[] {
  return useContext(RegistryContext).sidebarPanels;
}

export function usePluginCommands(): PluginCommandRegistration[] {
  return useContext(RegistryContext).commands;
}

export function usePluginContextMenuItems(
  context: ContextMenuItemRegistration['context'],
): ContextMenuItemRegistration[] {
  const all = useContext(RegistryContext).contextMenuItems;
  return useMemo(() => all.filter((r) => r.context === context), [all, context]);
}

export function usePluginToolbarButtons(): ToolbarButtonRegistration[] {
  return useContext(RegistryContext).toolbarButtons;
}

export function usePluginSettingsSections(): SettingsSectionRegistration[] {
  return useContext(RegistryContext).settingsSections;
}

export function usePluginRoutes(): RouteRegistration[] {
  return useContext(RegistryContext).routes;
}

export function usePluginStatusBarItems(align: 'left' | 'right'): StatusBarItemRegistration[] {
  const all = useContext(RegistryContext).statusBarItems;
  return useMemo(
    () =>
      all
        .filter((r) => (r.align ?? 'right') === align)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [all, align],
  );
}

export function usePluginThemes(): ThemeRegistration[] {
  return useContext(RegistryContext).themes;
}

// ────────────────────────────────────────────────────────────────────────────
// Write hooks (used by plugin host implementations)
// ────────────────────────────────────────────────────────────────────────────

export function useRegistryMutator(): RegistryMutator {
  const m = useContext(MutatorContext);
  if (!m) throw new Error('useRegistryMutator called outside PluginRegistryProvider');
  return m;
}

/**
 * Hook that wires a plugin's HostApi registration calls into the registry.
 * Used by the plugin host component for each active plugin.
 */
export function usePluginRegistration(
  pluginId: string,
  register: (mutator: RegistryMutator) => (() => void)[],
): void {
  const mutator = useRegistryMutator();
  const registerRef = useRef(register);
  registerRef.current = register;
  const idRef = useRef(pluginId);

  useEffect(() => {
    const cleanups = registerRef.current(mutator);
    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [mutator, idRef.current]);
}

// ────────────────────────────────────────────────────────────────────────────
// useContributeCommand — convenience for plugin components that need to
// register a single ephemeral command while mounted.
// ────────────────────────────────────────────────────────────────────────────

export function useContributeCommand(
  pluginId: string,
  command: { id: string; label: string; keywords?: string; run: () => void },
): void {
  const mutator = useRegistryMutator();
  const latest = useRef(command);
  latest.current = command;
  const key = `${pluginId}::${command.id}`;

  useEffect(() => {
    const proxy: PluginCommandRegistration = {
      pluginId,
      command: {
        id: key,
        label: command.label,
        ...(command.keywords !== undefined ? { keywords: command.keywords } : {}),
        run: () => latest.current.run(),
      },
    };
    return mutator.addCommand(proxy);
  }, [mutator, key, command.label, command.keywords]);
}

// ────────────────────────────────────────────────────────────────────────────
// Settings storage helpers (F1063)
// ────────────────────────────────────────────────────────────────────────────

const SETTINGS_PREFIX = 'fables.plugin.settings.';

export function loadPluginSettings(pluginId: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(`${SETTINGS_PREFIX}${pluginId}`);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function savePluginSettings(pluginId: string, settings: Record<string, unknown>): void {
  try {
    localStorage.setItem(`${SETTINGS_PREFIX}${pluginId}`, JSON.stringify(settings));
  } catch {
    // ignore quota errors
  }
}

export function usePluginSettings(
  pluginId: string,
): [Record<string, unknown>, (updates: Record<string, unknown>) => void] {
  const [settings, setSettings] = useState<Record<string, unknown>>(() =>
    loadPluginSettings(pluginId),
  );

  const update = useCallback(
    (updates: Record<string, unknown>) => {
      setSettings((prev) => {
        const next = { ...prev, ...updates };
        savePluginSettings(pluginId, next);
        return next;
      });
    },
    [pluginId],
  );

  return [settings, update];
}
