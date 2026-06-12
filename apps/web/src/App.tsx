import { Suspense, lazy } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  CalendarDays,
  CommandPalette,
  FileText,
  Network,
  ThemeProvider,
  ToastProvider,
  type PaletteCommand,
} from '@fables/ui';
import { NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { fetchHealth } from './api/client.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Skeleton } from './components/Skeleton.js';
import { PlaygroundPage } from './pages/Playground.js';

// Code-split the editor stack (CodeMirror + markdown pipeline) off the main chunk.
const EditorDemo = lazy(() =>
  import('./pages/EditorDemo.js').then((m) => ({ default: m.EditorDemo })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function Shell() {
  const navigate = useNavigate();
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
      id: 'playground',
      label: 'UI Playground',
      keywords: 'design system',
      run: () => navigate('/playground'),
    },
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
      </nav>
      <main className="main">
        <Outlet />
      </main>
      <CommandPalette commands={commands} />
    </div>
  );
}

function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth });
  return (
    <div>
      <h1>Notes</h1>
      {health.isPending && <Skeleton height={20} width={280} />}
      {health.isError && <p>Server unreachable — is `pnpm dev` running?</p>}
      {health.data && (
        <p>
          Connected to Fables v{health.data.version} — db {health.data.db}.
        </p>
      )}
      <Suspense fallback={<Skeleton height={320} />}>
        <EditorDemo />
      </Suspense>
    </div>
  );
}

const Placeholder = ({ title, day }: { title: string; day: number }) => (
  <div>
    <h1>{title}</h1>
    <p>Coming on Day {day} of the build.</p>
  </div>
);

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<HomePage />} />
                <Route path="stories" element={<Placeholder title="Stories" day={6} />} />
                <Route path="graph" element={<Placeholder title="Graph" day={3} />} />
                <Route path="today" element={<Placeholder title="Today" day={3} />} />
                <Route path="playground" element={<PlaygroundPage />} />
                <Route path="*" element={<Placeholder title="Not found" day={1} />} />
              </Route>
            </Routes>
          </QueryClientProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
