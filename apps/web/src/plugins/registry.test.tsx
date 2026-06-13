// @vitest-environment jsdom
/**
 * F1050 — Extension point tests: registry + contribution wiring.
 * F1089 — Example plugins as integration tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { type ReactNode } from 'react';
import {
  PluginRegistryProvider,
  useExtensionRegistry,
  usePluginSidebarPanels,
  usePluginCommands,
  usePluginContextMenuItems,
  usePluginToolbarButtons,
  usePluginRoutes,
  usePluginStatusBarItems,
  usePluginSettings,
  loadPluginSettings,
  savePluginSettings,
  useRegistryMutator,
} from './registry.js';
import { PluginSandbox } from './PluginSandbox.js';
import { computeStats } from './examples/wordCount.js';
import { WORD_COUNT_MANIFEST } from './examples/wordCount.js';
import { POMODORO_MANIFEST } from './examples/pomodoro.js';
import { BUNDLED_THEMES } from './examples/customTheme.js';
import type { SidebarPanelRegistration, PluginCommandRegistration } from './types.js';

afterEach(() => cleanup());

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
  return <PluginRegistryProvider>{children}</PluginRegistryProvider>;
}

// ────────────────────────────────────────────────────────────────────────────
// Registry unit tests
// ────────────────────────────────────────────────────────────────────────────

describe('PluginRegistryProvider', () => {
  it('initialises with empty registry', () => {
    let registry: ReturnType<typeof useExtensionRegistry> | null = null;
    function ReadRegistry() {
      registry = useExtensionRegistry();
      return null;
    }
    render(<Wrapper><ReadRegistry /></Wrapper>);
    expect(registry!.sidebarPanels).toHaveLength(0);
    expect(registry!.commands).toHaveLength(0);
    expect(registry!.routes).toHaveLength(0);
    expect(registry!.themes).toHaveLength(0);
  });

  it('adds and removes a sidebar panel', async () => {
    let mutator: ReturnType<typeof useRegistryMutator> | null = null;
    let panels: SidebarPanelRegistration[] = [];

    function Component() {
      mutator = useRegistryMutator();
      panels = usePluginSidebarPanels();
      return null;
    }

    render(<Wrapper><Component /></Wrapper>);

    expect(panels).toHaveLength(0);

    const panel: SidebarPanelRegistration = {
      pluginId: 'test',
      panelId: 'my-panel',
      title: 'My Panel',
      order: 50,
      component: () => null,
    };

    let remove: (() => void) | null = null;
    act(() => { remove = mutator!.addSidebarPanel(panel); });

    expect(panels).toHaveLength(1);
    expect(panels.at(0)!.panelId).toBe('my-panel');

    act(() => { remove!(); });
    expect(panels).toHaveLength(0);
  });

  it('adds and removes a command', () => {
    let mutator: ReturnType<typeof useRegistryMutator> | null = null;
    let commands: PluginCommandRegistration[] = [];

    function Component() {
      mutator = useRegistryMutator();
      commands = usePluginCommands();
      return null;
    }
    render(<Wrapper><Component /></Wrapper>);

    const cmd: PluginCommandRegistration = {
      pluginId: 'test',
      command: { id: 'test.cmd', label: 'Test cmd', run: vi.fn() },
    };

    let remove: (() => void) | null = null;
    act(() => { remove = mutator!.addCommand(cmd); });

    expect(commands).toHaveLength(1);
    expect(commands.at(0)!.command.id).toBe('test.cmd');

    act(() => { remove!(); });
    expect(commands).toHaveLength(0);
  });

  it('filters context menu items by context', () => {
    let mutator: ReturnType<typeof useRegistryMutator> | null = null;
    let noteItems: ReturnType<typeof usePluginContextMenuItems> = [];

    function Component() {
      mutator = useRegistryMutator();
      noteItems = usePluginContextMenuItems('note');
      return null;
    }
    render(<Wrapper><Component /></Wrapper>);

    act(() => {
      mutator!.addContextMenuItem({
        pluginId: 'test',
        item: { id: 'test.note-action', label: 'Note action', run: vi.fn() },
        context: 'note',
      });
      mutator!.addContextMenuItem({
        pluginId: 'test',
        item: { id: 'test.notebook-action', label: 'Notebook action', run: vi.fn() },
        context: 'notebook',
      });
    });

    expect(noteItems).toHaveLength(1);
    expect(noteItems.at(0)!.item.id).toBe('test.note-action');
  });

  it('adds toolbar buttons', () => {
    let mutator: ReturnType<typeof useRegistryMutator> | null = null;
    let buttons: ReturnType<typeof usePluginToolbarButtons> = [];

    function Component() {
      mutator = useRegistryMutator();
      buttons = usePluginToolbarButtons();
      return null;
    }
    render(<Wrapper><Component /></Wrapper>);

    act(() => {
      mutator!.addToolbarButton({
        pluginId: 'test',
        buttonId: 'my-btn',
        label: 'My Button',
        order: 10,
        run: vi.fn(),
      });
    });
    expect(buttons).toHaveLength(1);
    expect(buttons.at(0)!.buttonId).toBe('my-btn');
  });

  it('adds routes', () => {
    let mutator: ReturnType<typeof useRegistryMutator> | null = null;
    let routes: ReturnType<typeof usePluginRoutes> = [];

    function Component() {
      mutator = useRegistryMutator();
      routes = usePluginRoutes();
      return null;
    }
    render(<Wrapper><Component /></Wrapper>);

    act(() => {
      mutator!.addRoute({
        pluginId: 'test',
        path: '/my-page',
        title: 'My Page',
        showInSidebar: true,
        sidebarOrder: 100,
        component: () => null,
      });
    });
    expect(routes).toHaveLength(1);
    expect(routes.at(0)!.path).toBe('/my-page');
  });

  it('filters status-bar items by alignment', () => {
    let mutator: ReturnType<typeof useRegistryMutator> | null = null;
    let rightItems: ReturnType<typeof usePluginStatusBarItems> = [];

    function Component() {
      mutator = useRegistryMutator();
      rightItems = usePluginStatusBarItems('right');
      return null;
    }
    render(<Wrapper><Component /></Wrapper>);

    act(() => {
      mutator!.addStatusBarItem({ pluginId: 'a', itemId: 'item-right', align: 'right', order: 1, component: () => null });
      mutator!.addStatusBarItem({ pluginId: 'b', itemId: 'item-left', align: 'left', order: 1, component: () => null });
    });
    expect(rightItems).toHaveLength(1);
    expect(rightItems.at(0)!.itemId).toBe('item-right');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// PluginSandbox tests
// ────────────────────────────────────────────────────────────────────────────

describe('PluginSandbox', () => {
  it('renders children', () => {
    render(
      <PluginSandbox pluginId="test-plugin">
        <span>hello plugin</span>
      </PluginSandbox>,
    );
    expect(screen.getByText('hello plugin')).toBeDefined();
  });

  it('catches and displays error boundary', () => {
    const originalError = console.error;
    console.error = vi.fn();

    function Bomb(): ReactNode {
      throw new Error('plugin exploded');
    }

    render(
      <PluginSandbox pluginId="bad-plugin">
        <Bomb />
      </PluginSandbox>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    // Should mention the plugin ID
    expect(alert.textContent).toContain('bad-plugin');

    console.error = originalError;
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Plugin settings storage tests
// ────────────────────────────────────────────────────────────────────────────

describe('plugin settings storage', () => {
  it('round-trips settings via localStorage', () => {
    const id = 'test-plugin-123';
    savePluginSettings(id, { foo: 'bar', count: 42 });
    const loaded = loadPluginSettings(id);
    expect(loaded['foo']).toBe('bar');
    expect(loaded['count']).toBe(42);
  });

  it('returns empty object for unknown plugin', () => {
    const loaded = loadPluginSettings('unknown-plugin-zzz');
    expect(loaded).toEqual({});
  });

  it('usePluginSettings updates and persists', () => {
    let setter: ((updates: Record<string, unknown>) => void) | null = null;
    let vals: Record<string, unknown> = {};

    function TestComponent() {
      const [s, update] = usePluginSettings('test-hook-plugin');
      vals = s;
      setter = update;
      return null;
    }

    render(<Wrapper><TestComponent /></Wrapper>);

    act(() => { setter!({ hello: 'world' }); });

    expect(vals['hello']).toBe('world');
    expect(loadPluginSettings('test-hook-plugin')['hello']).toBe('world');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// F1089 — Example plugins as integration tests
// ────────────────────────────────────────────────────────────────────────────

describe('example plugin manifests', () => {
  it('word-count manifest has required fields', () => {
    expect(WORD_COUNT_MANIFEST.id).toBe('word-count');
    expect(WORD_COUNT_MANIFEST.permissions).toContain('notes:read');
    expect(WORD_COUNT_MANIFEST.contributes.sidebarPanels).toHaveLength(1);
    expect(WORD_COUNT_MANIFEST.contributes.commands).toHaveLength(1);
  });

  it('pomodoro manifest declares notes:write + notifications', () => {
    expect(POMODORO_MANIFEST.permissions).toContain('notes:write');
    expect(POMODORO_MANIFEST.permissions).toContain('notifications');
    expect(POMODORO_MANIFEST.contributes.statusBarItems).toHaveLength(1);
    expect(POMODORO_MANIFEST.contributes.settingsSections?.[0]?.fields).toHaveLength(1);
  });

  it('theme pack has 3 themes with required token keys', () => {
    expect(BUNDLED_THEMES).toHaveLength(3);
    for (const t of BUNDLED_THEMES) {
      expect(t.tokens['--bg']).toBeDefined();
      expect(t.tokens['--text']).toBeDefined();
      expect(t.tokens['--accent']).toBeDefined();
      expect(['dark', 'light']).toContain(t.base);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Writing-stats logic tests (word-count plugin, F1081)
// ────────────────────────────────────────────────────────────────────────────

describe('computeStats', () => {
  it('counts words', () => {
    expect(computeStats('hello world foo').words).toBe(3);
  });

  it('counts characters', () => {
    expect(computeStats('hello').characters).toBe(5);
  });

  it('counts sentences by punctuation', () => {
    expect(computeStats('Hello. World! How are you?').sentences).toBe(3);
  });

  it('counts paragraphs', () => {
    expect(computeStats('Para one.\n\nPara two.\n\nPara three.').paragraphs).toBe(3);
  });

  it('estimates reading time (at least 1 min)', () => {
    expect(computeStats('short').readingTimeMinutes).toBeGreaterThanOrEqual(1);
  });

  it('reading time for 400 words is 2 minutes', () => {
    const body = 'word '.repeat(400);
    expect(computeStats(body).readingTimeMinutes).toBe(2);
  });

  it('handles empty string', () => {
    const s = computeStats('');
    expect(s.words).toBe(0);
    expect(s.characters).toBe(0);
    expect(s.readingTimeMinutes).toBe(1); // floor at 1
  });
});
