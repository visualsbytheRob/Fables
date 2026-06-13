/**
 * Story library (F571–F579): typographic cover grid with progress badges, a
 * continue-reading rail from the latest autosaved playthroughs, sort/filter,
 * search across title/blurb/author/tags, and an archived shelf. Reading
 * state (stats, endings, archive flags) lives client-side in localStorage.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, Input, Play, Plus, Search, useToast } from '@fables/ui';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '../components/Skeleton.js';
import { loadRecents } from '../player/prefs.js';
import { storiesApi, type StoryProject } from './api.js';
import {
  coverBackground,
  libraryEntries,
  libraryView,
  type LibraryEntry,
  type LibraryFilter,
  type LibrarySort,
} from './library.js';
import './stories.css';

/** Typographic cover: configured color/emoji, else hue + initials (F572). */
export function StoryCover({ story, size = 'grid' }: { story: StoryProject; size?: 'grid' | 'hero' }) {
  const emoji = story.settings?.cover.emoji;
  const initials = story.title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div
      className={`story-cover story-cover--${size}`}
      style={{ background: coverBackground(story) }}
      aria-hidden="true"
    >
      <span className="story-cover-mark">{emoji != null && emoji !== '' ? emoji : initials}</span>
      <span className="story-cover-title">{story.title}</span>
    </div>
  );
}

const BADGE_LABEL: Record<LibraryEntry['badge'], string> = {
  new: 'unread',
  'in-progress': 'in progress',
  finished: 'finished',
};

function StoryCard({ entry, onOpen }: { entry: LibraryEntry; onOpen: () => void }) {
  const { story, badge, endingsFound } = entry;
  return (
    <button className="story-card story-card--cover" onClick={onOpen}>
      <StoryCover story={story} />
      <h3>{story.title}</h3>
      <span className={`story-status badge-${badge}`}>{BADGE_LABEL[badge]}</span>
      <span className="story-card-meta">
        {entry.meta.author !== '' ? `${entry.meta.author} · ` : ''}
        {endingsFound > 0 ? `${endingsFound} ending${endingsFound === 1 ? '' : 's'} found · ` : ''}
        updated {new Date(story.updatedAt).toLocaleDateString()}
      </span>
    </button>
  );
}

export function StoriesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [showArchived, setShowArchived] = useState(false);

  const storiesQuery = useQuery({ queryKey: ['stories'], queryFn: storiesApi.list });

  const entries = useMemo(
    () => libraryEntries(storiesQuery.data ?? []),
    [storiesQuery.data],
  );
  const view = useMemo(
    () => libraryView(entries, { query, filter, sort }),
    [entries, query, filter, sort],
  );
  const recents = useMemo(() => {
    const byId = new Map(entries.map((e) => [e.story.id, e]));
    return loadRecents()
      .map((r) => ({ recent: r, entry: byId.get(r.storyId) }))
      .filter((r) => r.entry !== undefined)
      .slice(0, 5);
  }, [entries]);

  const createMutation = useMutation({
    mutationFn: (input: { title: string }) => storiesApi.create(input),
    onSuccess: (story) => {
      void queryClient.invalidateQueries({ queryKey: ['stories'] });
      setCreateOpen(false);
      setTitle('');
      navigate(`/stories/${story.id}/edit`);
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'create failed'),
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ flex: 1, minWidth: 160 }}>Library</h1>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> New story
        </Button>
      </div>

      <div className="story-library-controls">
        <div className="story-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search title, blurb, author, tags…"
            aria-label="Search library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter by progress"
          value={filter}
          onChange={(e) => setFilter(e.target.value as LibraryFilter)}
        >
          <option value="all">All</option>
          <option value="in-progress">In progress</option>
          <option value="finished">Finished</option>
          <option value="new">Unread</option>
        </select>
        <select
          aria-label="Sort stories"
          value={sort}
          onChange={(e) => setSort(e.target.value as LibrarySort)}
        >
          <option value="recent">Recently updated</option>
          <option value="played">Recently played</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>

      {recents.length > 0 && query === '' && filter === 'all' ? (
        <section aria-label="Continue reading">
          <h2 className="story-shelf-heading">Continue reading</h2>
          <div className="story-continue-rail">
            {recents.map(({ recent, entry }) => (
              <button
                key={recent.storyId}
                className="story-continue-card"
                onClick={() => navigate(`/stories/${recent.storyId}/play`)}
              >
                <StoryCover story={(entry as LibraryEntry).story} />
                <span className="story-continue-meta">
                  <strong>{recent.title}</strong>
                  <small>
                    turn {recent.turn}
                    {recent.scene !== '' ? ` · ${recent.scene}` : ''}
                  </small>
                  <span className="story-continue-cta">
                    <Play size={12} /> Continue
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {storiesQuery.isLoading ? <Skeleton height={160} /> : null}
      {storiesQuery.isError ? (
        <p style={{ color: 'var(--text-dim)' }}>
          Could not load stories from the server — check that it is running.
        </p>
      ) : null}

      {storiesQuery.data !== undefined ? (
        view.shelf.length === 0 && view.archived.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>
            {entries.length === 0
              ? 'No stories yet. Create one and start writing in Forge.'
              : 'Nothing matches that search.'}
          </p>
        ) : (
          <div className="story-library-grid">
            {view.shelf.map((entry) => (
              <StoryCard
                key={entry.story.id}
                entry={entry}
                onOpen={() => navigate(`/stories/${entry.story.id}`)}
              />
            ))}
          </div>
        )
      ) : null}

      {view.archived.length > 0 ? (
        <section aria-label="Archived stories">
          <button
            className="story-shelf-heading story-shelf-toggle"
            onClick={() => setShowArchived((s) => !s)}
            aria-expanded={showArchived}
          >
            Archived ({view.archived.length}) {showArchived ? '▾' : '▸'}
          </button>
          {showArchived ? (
            <div className="story-library-grid">
              {view.archived.map((entry) => (
                <StoryCard
                  key={entry.story.id}
                  entry={entry}
                  onOpen={() => navigate(`/stories/${entry.story.id}`)}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() !== '') createMutation.mutate({ title: title.trim() });
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 300 }}
        >
          <h3 style={{ margin: 0 }}>New story</h3>
          <Input
            autoFocus
            placeholder="Story title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Story title"
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button type="button" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={createMutation.isPending}>
              Create
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
