import { Suspense, lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  BookOpen,
  CalendarDays,
  CommandPalette,
  FileText,
  Network,
  Paperclip,
  ThemeProvider,
  ToastProvider,
  type PaletteCommand,
} from '@fables/ui';
import { NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { CommandRegistryProvider, useRegisteredCommands } from './commands/registry.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Skeleton } from './components/Skeleton.js';
import { CheatSheet } from './notes/CheatSheet.js';
import { QuickCapture } from './notes/QuickCapture.js';
import { PlaygroundPage } from './pages/Playground.js';

// Code-split the notes experience (CodeMirror + markdown pipeline) off the main chunk.
const NotesPage = lazy(() =>
  import('./notes/NotesPage.js').then((m) => ({ default: m.NotesPage })),
);
const AttachmentsPage = lazy(() =>
  import('./pages/Attachments.js').then((m) => ({ default: m.AttachmentsPage })),
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
    { id: 'graph', label: 'Go to Graph', keywords: 'links network', run: () => navigate('/graph') },
    { id: 'today', label: 'Open Today', keywords: 'daily journal', run: () => navigate('/today') },
    {
      id: 'attachments',
      label: 'Go to Attachments',
      keywords: 'files uploads',
      run: () => navigate('/attachments'),
    },
    {
      id: 'playground',
      label: 'UI Playground',
      keywords: 'design system',
      run: () => navigate('/playground'),
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
        <NavLink to="/graph">
          <Network size={16} /> Graph
        </NavLink>
        <NavLink to="/today">
          <CalendarDays size={16} /> Today
        </NavLink>
        <NavLink to="/attachments">
          <Paperclip size={16} /> Files
        </NavLink>
      </nav>
      <main className="main">
        <Outlet />
      </main>
      <CommandPalette commands={commands} />
      <QuickCapture onCreated={(id) => navigate(`/notes/${id}`)} />
      <CheatSheet />
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
                  <Route path="stories" element={<Placeholder title="Stories" day={6} />} />
                  <Route path="graph" element={<Placeholder title="Graph" day={3} />} />
                  <Route path="today" element={<Placeholder title="Today" day={3} />} />
                  <Route path="playground" element={<PlaygroundPage />} />
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
