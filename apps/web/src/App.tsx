import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { fetchHealth } from './api/client.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { Skeleton } from './components/Skeleton.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function Shell() {
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">Fables</div>
        <NavLink to="/" end>
          Notes
        </NavLink>
        <NavLink to="/stories">Stories</NavLink>
        <NavLink to="/graph">Graph</NavLink>
        <NavLink to="/today">Today</NavLink>
      </nav>
      <main className="main">
        <Outlet />
      </main>
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
          Connected to Fables v{health.data.version} — db {health.data.db}. The notes experience
          lands on Day 2.
        </p>
      )}
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
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<HomePage />} />
            <Route path="stories" element={<Placeholder title="Stories" day={6} />} />
            <Route path="graph" element={<Placeholder title="Graph" day={3} />} />
            <Route path="today" element={<Placeholder title="Today" day={3} />} />
            <Route path="*" element={<Placeholder title="Not found" day={1} />} />
          </Route>
        </Routes>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
