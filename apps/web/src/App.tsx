import { Suspense, lazy, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Activity,
  BarChart2,
  BookmarkPlus,
  BookOpen,
  CalendarDays,
  CommandPalette,
  FileInput,
  FileText,
  History,
  Mic,
  Network,
  Package,
  Paperclip,
  Puzzle,
  Search,
  Settings,
  Share2,
  Shapes,
  ThemeProvider,
  ToastProvider,
  Upload,
  type PaletteCommand,
} from '@fables/ui';
import { NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { CommandRegistryProvider, useRegisteredCommands } from './commands/registry.js';
import { PluginRegistryProvider, usePluginCommands } from './plugins/registry.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Skeleton } from './components/Skeleton.js';
import { CheatSheet } from './notes/CheatSheet.js';
import { QuickCapture } from './notes/QuickCapture.js';
import { SearchOverlay } from './search/SearchOverlay.js';
import { Tour } from './onboarding/Tour.js';
import { PlaygroundPage } from './pages/Playground.js';
import { SWUpdateToast } from './pwa/SWUpdateToast.js';
import { OfflineIndicator } from './offline/OfflineIndicator.js';
import { NotificationCenter } from './notifications/NotificationCenter.js';
import { BottomTabBar } from './mobile/BottomTabBar.js';
import { useReconnectSync } from './offline/useReconnectSync.js';
import { useSync } from './offline/useSync.js';
import { ConflictReviewPanel } from './offline/ConflictReviewPanel.js';
import { VaultGate } from './vault/VaultGate.js';
import { scheduleJournalReminder } from './notifications/notificationStore.js';
import './mobile/mobile.css';
import './offline/offline.css';
import './offline/conflict.css';

// Code-split the notes experience (CodeMirror + markdown pipeline) off the main chunk.
const NotesPage = lazy(() =>
  import('./notes/NotesPage.js').then((m) => ({ default: m.NotesPage })),
);
const AttachmentsPage = lazy(() =>
  import('./pages/Attachments.js').then((m) => ({ default: m.AttachmentsPage })),
);
const GraphPage = lazy(() =>
  import('./graph/GraphPage.js').then((m) => ({ default: m.GraphPage })),
);
const TodayPage = lazy(() =>
  import('./daily/TodayPage.js').then((m) => ({ default: m.TodayPage })),
);
const TemplatesPage = lazy(() =>
  import('./templates/TemplatesPage.js').then((m) => ({ default: m.TemplatesPage })),
);
const ImportPage = lazy(() =>
  import('./pages/ImportPage.js').then((m) => ({ default: m.ImportPage })),
);
// Forge editor stack (CodeMirror + the .fable compiler) stays off the main chunk.
const ForgePlaygroundPage = lazy(() =>
  import('./forge/ForgePlayground.js').then((m) => ({ default: m.ForgePlaygroundPage })),
);
// Story authoring (Day 6): library is light, the workspace pulls the whole
// editor + compiler + VM stack — both stay off the main chunk.
const StoriesPage = lazy(() =>
  import('./stories/StoriesPage.js').then((m) => ({ default: m.StoriesPage })),
);
const StoryEditPage = lazy(() =>
  import('./stories/StoryEditPage.js').then((m) => ({ default: m.StoryEditPage })),
);
const StoryDetailPage = lazy(() =>
  import('./stories/StoryDetailPage.js').then((m) => ({ default: m.StoryDetailPage })),
);
// Entity editor (Day 7, F603/F604/F607): schema-driven forms + markdown body.
const EntitiesPage = lazy(() =>
  import('./entities/EntitiesPage.js').then((m) => ({ default: m.EntitiesPage })),
);
// The player (Day 6, F541–F600) carries the forge compiler + VM: own chunk.
const PlayerPage = lazy(() =>
  import('./player/PlayerPage.js').then((m) => ({ default: m.PlayerPage })),
);
// Fusion views (Day 7): unified timeline (F651–F660) and world inspector (F681–F690).
const TimelinePage = lazy(() =>
  import('./timeline/TimelinePage.js').then((m) => ({ default: m.TimelinePage })),
);
const WorldPage = lazy(() =>
  import('./world/WorldPage.js').then((m) => ({ default: m.WorldPage })),
);
// Day 8: Insights (F791–F800) — own chunk (SVG charts + multiple queries).
const InsightsPage = lazy(() =>
  import('./insights/InsightsPage.js').then((m) => ({ default: m.InsightsPage })),
);
// Day 8: Ingestion (F766), Clipper (F771–F773), Voice (F781–F786) — own chunks.
const IngestPage = lazy(() =>
  import('./pages/IngestPage.js').then((m) => ({ default: m.IngestPage })),
);
const ClipPage = lazy(() => import('./pages/ClipPage.js').then((m) => ({ default: m.ClipPage })));
const VoicePage = lazy(() =>
  import('./pages/VoicePage.js').then((m) => ({ default: m.VoicePage })),
);
// Day 9: PWA install instructions (F804)
const InstallPage = lazy(() =>
  import('./pwa/InstallPage.js').then((m) => ({ default: m.InstallPage })),
);
// Day 10: Local analytics dashboard (F971–F980) and Settings page (F997)
const AnalyticsPage = lazy(() =>
  import('./analytics/AnalyticsPage.js').then((m) => ({ default: m.AnalyticsPage })),
);
const SettingsPage = lazy(() =>
  import('./settings/SettingsPage.js').then((m) => ({ default: m.SettingsPage })),
);
// Tier 2 Epic 11: Plugin & Extension Architecture (F1041–F1090)
const PluginsPage = lazy(() =>
  import('./plugins/PluginsPage.js').then((m) => ({ default: m.PluginsPage })),
);
const PluginDetailPage = lazy(() =>
  import('./plugins/PluginDetailPage.js').then((m) => ({ default: m.PluginDetailPage })),
);
const PluginDevKitPage = lazy(() =>
  import('./plugins/PluginDevKitPage.js').then((m) => ({ default: m.PluginDevKitPage })),
);
const ExampleGalleryPage = lazy(() =>
  import('./plugins/ExampleGalleryPage.js').then((m) => ({ default: m.ExampleGalleryPage })),
);
const PluginInstallPage = lazy(() =>
  import('./plugins/PluginInstallPage.js').then((m) => ({ default: m.PluginInstallPage })),
);
// Tier 2 Epic 13: Encrypted Vault / Sharing (F1144, F1147)
const SharesPage = lazy(() =>
  import('./shares/SharesPage.js').then((m) => ({ default: m.SharesPage })),
);
const SharedWithMePage = lazy(() =>
  import('./shares/SharedWithMePage.js').then((m) => ({ default: m.SharedWithMePage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function Shell() {
  const navigate = useNavigate();
  const registered = useRegisteredCommands();
  const pluginCommands = usePluginCommands();
  const [searchOpen, setSearchOpen] = useState(false);
  const [conflictPanelOpen, setConflictPanelOpen] = useState(false);

  // PWA Day 9: reconnect sync (F856) + journal reminder scheduling (F872)
  useReconnectSync();
  // Sync engine wiring (F834/F837/F855/F863)
  const { pendingCount, conflictCount, isSyncing } = useSync();
  useEffect(() => {
    scheduleJournalReminder();
  }, []);

  // Global search hotkeys: ⌘⇧F / Ctrl+Shift+F (F711)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commands: PaletteCommand[] = [
    { id: 'notes', label: 'Go to Notes', keywords: 'home', run: () => navigate('/') },
    {
      id: 'stories',
      label: 'Go to Stories',
      keywords: 'fables play',
      run: () => navigate('/stories'),
    },
    {
      id: 'entities',
      label: 'Go to Entities',
      keywords: 'characters places items codex world',
      run: () => navigate('/entities'),
    },
    { id: 'graph', label: 'Go to Graph', keywords: 'links network', run: () => navigate('/graph') },
    { id: 'today', label: 'Open Today', keywords: 'daily journal', run: () => navigate('/today') },
    {
      id: 'templates',
      label: 'Manage templates',
      keywords: 'template snippets',
      run: () => navigate('/templates'),
    },
    {
      id: 'attachments',
      label: 'Go to Attachments',
      keywords: 'files uploads',
      run: () => navigate('/attachments'),
    },
    {
      id: 'import',
      label: 'Import notes…',
      keywords: 'markdown obsidian vault migrate',
      run: () => navigate('/import'),
    },
    {
      id: 'ingest',
      label: 'Ingest document…',
      keywords: 'pdf epub html document ingestion',
      run: () => navigate('/ingest'),
    },
    {
      id: 'clip',
      label: 'Clip a web page…',
      keywords: 'clip web url bookmarklet',
      run: () => navigate('/clip'),
    },
    {
      id: 'voice',
      label: 'Voice memos…',
      keywords: 'record audio transcribe microphone',
      run: () => navigate('/voice'),
    },
    {
      id: 'playground',
      label: 'UI Playground',
      keywords: 'design system',
      run: () => navigate('/playground'),
    },
    {
      id: 'forge-playground',
      label: 'Forge Playground',
      keywords: 'fable dsl editor compiler',
      run: () => navigate('/forge-playground'),
    },
    // Day 8 (F711, F791)
    {
      id: 'search',
      label: 'Search vault (⌘⇧F)',
      keywords: 'find query global',
      run: () => setSearchOpen(true),
    },
    {
      id: 'insights',
      label: 'Go to Insights',
      keywords: 'analytics stats health vault intelligence',
      run: () => navigate('/insights'),
    },
    {
      id: 'install',
      label: 'Install Fables on iPhone…',
      keywords: 'pwa install home screen ios',
      run: () => navigate('/install'),
    },
    {
      id: 'analytics',
      label: 'Local Analytics…',
      keywords: 'usage stats counters performance errors',
      run: () => navigate('/analytics'),
    },
    {
      id: 'settings',
      label: 'Settings',
      keywords: 'theme preferences notifications analytics a11y',
      run: () => navigate('/settings'),
    },
    {
      id: 'plugins',
      label: 'Manage Plugins',
      keywords: 'extensions plugins install dev',
      run: () => navigate('/plugins'),
    },
    {
      id: 'plugins-gallery',
      label: 'Plugin Gallery',
      keywords: 'extensions examples',
      run: () => navigate('/plugins/gallery'),
    },
    {
      id: 'plugins-devkit',
      label: 'Plugin Developer Kit',
      keywords: 'plugin sdk dev build tutorial',
      run: () => navigate('/plugins/devkit'),
    },
    {
      id: 'plugins-install',
      label: 'Install Plugin',
      keywords: 'plugin install file url catalog fplugin',
      run: () => navigate('/plugins/install'),
    },
    {
      id: 'plugins-catalog',
      label: 'Plugin Catalog',
      keywords: 'plugin catalog browse install',
      run: () => navigate('/plugins/install'),
    },
    // Tier 2 Epic 13: Sharing (F1144, F1147)
    {
      id: 'shares',
      label: 'Manage Shares',
      keywords: 'share sharing revoke access vault encrypt',
      run: () => navigate('/shares'),
    },
    {
      id: 'shared-with-me',
      label: 'Shared with Me',
      keywords: 'shared collaborate incoming access',
      run: () => navigate('/shared-with-me'),
    },
    ...registered,
    ...pluginCommands.map((r) => r.command),
  ];

  return (
    <div className="shell">
      {/* F933 — skip-to-content link for keyboard/screen reader users */}
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <nav className="sidebar" aria-label="Main navigation">
        <div className="brand" aria-hidden="true">
          Fables
        </div>
        <NavLink to="/" end aria-label="Notes">
          <FileText size={16} aria-hidden="true" /> Notes
        </NavLink>
        <NavLink to="/stories">
          <BookOpen size={16} /> Stories
        </NavLink>
        <NavLink to="/entities">
          <Shapes size={16} /> Entities
        </NavLink>
        <NavLink to="/graph">
          <Network size={16} /> Graph
        </NavLink>
        <NavLink to="/timeline">
          <History size={16} /> Timeline
        </NavLink>
        <NavLink to="/world">
          <Package size={16} /> World
        </NavLink>
        <NavLink to="/today">
          <CalendarDays size={16} /> Today
        </NavLink>
        <NavLink to="/attachments">
          <Paperclip size={16} /> Files
        </NavLink>
        <NavLink to="/import">
          <Upload size={16} /> Import
        </NavLink>
        <NavLink to="/ingest">
          <FileInput size={16} /> Ingest
        </NavLink>
        <NavLink to="/clip">
          <BookmarkPlus size={16} /> Clip
        </NavLink>
        <NavLink to="/voice">
          <Mic size={16} /> Voice
        </NavLink>
        <NavLink to="/insights" aria-label="Insights">
          <Activity size={16} aria-hidden="true" /> Insights
        </NavLink>
        <NavLink to="/analytics" aria-label="Local Analytics">
          <BarChart2 size={16} aria-hidden="true" /> Analytics
        </NavLink>
        <NavLink to="/settings" aria-label="Settings">
          <Settings size={16} aria-hidden="true" /> Settings
        </NavLink>
        <NavLink to="/plugins" aria-label="Plugins">
          <Puzzle size={16} aria-hidden="true" /> Plugins
        </NavLink>
        <NavLink to="/shares" aria-label="Shares">
          <Share2 size={16} aria-hidden="true" /> Shares
        </NavLink>
        <div className="spacer" />
        <button
          type="button"
          className="sidebar-search-btn"
          onClick={() => setSearchOpen(true)}
          title="Search vault (⌘⇧F)"
          aria-label="Open search"
        >
          <Search size={16} /> Search
        </button>
      </nav>
      <main id="main-content" className="main">
        <Outlet />
      </main>
      <CommandPalette commands={commands} />
      <QuickCapture onCreated={(id) => navigate(`/notes/${id}`)} />
      <CheatSheet />
      <Tour />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      {/* Day 9: PWA + offline + notifications (F801–F900) */}
      <SWUpdateToast />
      <OfflineIndicator
        pendingCount={pendingCount}
        conflictCount={conflictCount}
        isSyncing={isSyncing}
        onConflictClick={() => setConflictPanelOpen(true)}
      />
      {conflictPanelOpen && (
        <div className="conflict-panel-overlay" role="dialog" aria-label="Sync conflict review">
          <ConflictReviewPanel onClose={() => setConflictPanelOpen(false)} />
        </div>
      )}
      <NotificationCenter />
      <BottomTabBar />
    </div>
  );
}

const Placeholder = ({ title, day }: { title: string; day: number }) => (
  <div>
    <h1>{title}</h1>
    <p>Coming on Day {day} of the build.</p>
  </div>
);

const lazyPage = (page: React.ReactNode) => (
  <Suspense fallback={<Skeleton height={320} />}>{page}</Suspense>
);

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <CommandRegistryProvider>
              <PluginRegistryProvider>
                <VaultGate>
                  <Routes>
                    <Route element={<Shell />}>
                      <Route index element={lazyPage(<NotesPage />)} />
                      <Route path="notes/:noteId" element={lazyPage(<NotesPage />)} />
                      <Route path="attachments" element={lazyPage(<AttachmentsPage />)} />
                      <Route path="stories" element={lazyPage(<StoriesPage />)} />
                      <Route path="stories/:storyId" element={lazyPage(<StoryDetailPage />)} />
                      <Route path="stories/:storyId/edit" element={lazyPage(<StoryEditPage />)} />
                      <Route path="stories/:storyId/play" element={lazyPage(<PlayerPage />)} />
                      <Route path="entities" element={lazyPage(<EntitiesPage />)} />
                      <Route path="entities/:entityId" element={lazyPage(<EntitiesPage />)} />
                      <Route path="graph" element={lazyPage(<GraphPage />)} />
                      <Route path="timeline" element={lazyPage(<TimelinePage />)} />
                      <Route path="world" element={lazyPage(<WorldPage />)} />
                      <Route path="today" element={lazyPage(<TodayPage />)} />
                      <Route path="templates" element={lazyPage(<TemplatesPage />)} />
                      <Route path="import" element={lazyPage(<ImportPage />)} />
                      <Route path="ingest" element={lazyPage(<IngestPage />)} />
                      <Route path="clip" element={lazyPage(<ClipPage />)} />
                      <Route path="voice" element={lazyPage(<VoicePage />)} />
                      <Route path="playground" element={<PlaygroundPage />} />
                      <Route path="forge-playground" element={lazyPage(<ForgePlaygroundPage />)} />
                      <Route path="insights" element={lazyPage(<InsightsPage />)} />
                      <Route path="install" element={lazyPage(<InstallPage />)} />
                      {/* Day 10: analytics + settings (F971–F980, F997) */}
                      <Route path="analytics" element={lazyPage(<AnalyticsPage />)} />
                      <Route path="settings" element={lazyPage(<SettingsPage />)} />
                      {/* Tier 2 Epic 11: Plugin & Extension Architecture (F1041–F1090) */}
                      <Route path="plugins" element={lazyPage(<PluginsPage />)} />
                      <Route path="plugins/install" element={lazyPage(<PluginInstallPage />)} />
                      <Route path="plugins/gallery" element={lazyPage(<ExampleGalleryPage />)} />
                      <Route path="plugins/devkit" element={lazyPage(<PluginDevKitPage />)} />
                      <Route path="plugins/:pluginId" element={lazyPage(<PluginDetailPage />)} />
                      {/* Tier 2 Epic 13: Encrypted Vault / Sharing (F1144, F1147) */}
                      <Route path="shares" element={lazyPage(<SharesPage />)} />
                      <Route path="shared-with-me" element={lazyPage(<SharedWithMePage />)} />
                      <Route path="*" element={<Placeholder title="Not found" day={1} />} />
                    </Route>
                  </Routes>
                </VaultGate>
              </PluginRegistryProvider>
            </CommandRegistryProvider>
          </QueryClientProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
