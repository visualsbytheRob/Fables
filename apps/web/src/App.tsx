import { Suspense, lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  BookOpen,
  CalendarDays,
  CommandPalette,
  FileText,
  History,
  Network,
  Package,
  Paperclip,
  Shapes,
  ThemeProvider,
  ToastProvider,
  Upload,
  type PaletteCommand,
} from '@fables/ui';
import { NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { CommandRegistryProvider, useRegisteredCommands } from './commands/registry.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Skeleton } from './components/Skeleton.js';
import { CheatSheet } from './notes/CheatSheet.js';
import { QuickCapture } from './notes/QuickCapture.js';
import { Tour } from './onboarding/Tour.js';
import { PlaygroundPage } from './pages/Playground.js';

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function Shell() {
  const navigate = useNavigate();
  const registered = useRegisteredCommands();
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
    ...registered,
  ];

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">Fables</div>
        <NavLink to="/" end>
          <FileText size={16} /> Notes
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
      </nav>
      <main className="main">
        <Outlet />
      </main>
      <CommandPalette commands={commands} />
      <QuickCapture onCreated={(id) => navigate(`/notes/${id}`)} />
      <CheatSheet />
      <Tour />
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
                  <Route path="playground" element={<PlaygroundPage />} />
                  <Route path="forge-playground" element={lazyPage(<ForgePlaygroundPage />)} />
                  <Route path="*" element={<Placeholder title="Not found" day={1} />} />
                </Route>
              </Routes>
            </CommandRegistryProvider>
          </QueryClientProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
