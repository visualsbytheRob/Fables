/**
 * Story library (F511): every story project as a card with title + build
 * status badge; create opens a dialog, click opens the authoring workspace.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, Input, Plus, useToast } from '@fables/ui';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '../components/Skeleton.js';
import { storiesApi, type StoryProject } from './api.js';
import './stories.css';

function statusLabel(story: StoryProject): { text: string; cls: string } {
  if (story.status === 'broken' || (story.errorCount ?? 0) > 0) {
    return { text: `${story.errorCount ?? ''} error${story.errorCount === 1 ? '' : 's'}`.trim(), cls: 'status-broken' };
  }
  if (story.status === 'valid') return { text: 'compiles', cls: 'status-valid' };
  return { text: 'draft', cls: 'status-draft' };
}

export function StoriesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');

  const storiesQuery = useQuery({ queryKey: ['stories'], queryFn: storiesApi.list });

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ flex: 1 }}>Stories</h1>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> New story
        </Button>
      </div>

      {storiesQuery.isLoading ? <Skeleton height={160} /> : null}
      {storiesQuery.isError ? (
        <p style={{ color: 'var(--text-dim)' }}>
          Could not load stories from the server — check that it is running.
        </p>
      ) : null}

      {storiesQuery.data !== undefined ? (
        storiesQuery.data.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>
            No stories yet. Create one and start writing in Forge.
          </p>
        ) : (
          <div className="story-library-grid">
            {storiesQuery.data.map((story) => {
              const status = statusLabel(story);
              return (
                <button
                  key={story.id}
                  className="story-card"
                  onClick={() => navigate(`/stories/${story.id}/edit`)}
                >
                  <h3>{story.title}</h3>
                  <span className={`story-status ${status.cls}`}>{status.text}</span>
                  <span className="story-card-meta">
                    {story.description !== '' ? `${story.description} · ` : ''}
                    updated {new Date(story.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              );
            })}
          </div>
        )
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
