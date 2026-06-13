/**
 * Story detail page (F576): cover, blurb, reading stats, endings found and
 * the Play/Edit entry points, plus metadata editing (F573), archive (F578),
 * source-bundle/manifest export (F581/F586) and Web Share (F590).
 *
 * Blurb edits persist server-side as the story description and cover
 * color/emoji as story settings; author/tags/content notes/archived are
 * client-side until the server settings schema grows fields for them.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, Download, Input, Pencil, Play, Share2, Textarea, useToast } from '@fables/ui';
import { useNavigate, useParams } from 'react-router-dom';
import { Skeleton } from '../components/Skeleton.js';
import { downloadText, shareText, storyBundle, storyManifest } from '../player/exporters.js';
import {
  formatDuration,
  loadEndings,
  loadLibraryMeta,
  loadStats,
  saveLibraryMeta,
  type LibraryMeta,
} from '../player/prefs.js';
import { slugify } from '../player/tags.js';
import { storiesApi, type StoryProject } from './api.js';
import { StoryCover } from './StoriesPage.js';
import './stories.css';

function MetadataDialog({
  story,
  meta,
  onClose,
  onSaved,
}: {
  story: StoryProject;
  meta: LibraryMeta;
  onClose: () => void;
  onSaved: (meta: LibraryMeta) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [blurb, setBlurb] = useState(story.description);
  const [author, setAuthor] = useState(meta.author);
  const [tags, setTags] = useState(meta.tags.join(', '));
  const [contentNotes, setContentNotes] = useState(meta.contentNotes);
  const [coverColor, setCoverColor] = useState(story.settings?.cover.color ?? '');
  const [coverEmoji, setCoverEmoji] = useState(story.settings?.cover.emoji ?? '');

  const save = useMutation({
    mutationFn: () =>
      storiesApi.patch(story.id, {
        description: blurb,
        settings: {
          cover: { color: coverColor === '' ? null : coverColor, emoji: coverEmoji === '' ? null : coverEmoji },
        },
      }),
    onSuccess: () => {
      const nextMeta: LibraryMeta = {
        ...meta,
        author: author.trim(),
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== ''),
        contentNotes: contentNotes.trim(),
      };
      saveLibraryMeta(story.id, nextMeta);
      onSaved(nextMeta);
      void queryClient.invalidateQueries({ queryKey: ['story', story.id] });
      void queryClient.invalidateQueries({ queryKey: ['stories'] });
      toast('Story details saved');
      onClose();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'save failed'),
  });

  return (
    <Dialog open onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 320, maxWidth: 420 }}
      >
        <h3 style={{ margin: 0 }}>Edit story details</h3>
        <label>
          Blurb
          <Textarea
            aria-label="Blurb"
            value={blurb}
            rows={3}
            onChange={(e) => setBlurb(e.target.value)}
          />
        </label>
        <label>
          Author
          <Input aria-label="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <label>
          Tags (comma-separated)
          <Input aria-label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label>
          Content notes
          <Input
            aria-label="Content notes"
            value={contentNotes}
            onChange={(e) => setContentNotes(e.target.value)}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 1 }}>
            Cover color
            <Input
              aria-label="Cover color"
              placeholder="#4a3722 or hsl(…)"
              value={coverColor}
              onChange={(e) => setCoverColor(e.target.value)}
            />
          </label>
          <label style={{ width: 110 }}>
            Cover emoji
            <Input
              aria-label="Cover emoji"
              placeholder="🦊"
              value={coverEmoji}
              onChange={(e) => setCoverEmoji(e.target.value)}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function StoryDetailPage() {
  const { storyId = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [meta, setMeta] = useState(() => loadLibraryMeta(storyId));

  const storyQuery = useQuery({
    queryKey: ['story', storyId],
    queryFn: () => storiesApi.get(storyId),
  });

  if (storyQuery.isLoading) return <Skeleton height={320} />;
  const story = storyQuery.data;
  if (story === undefined) {
    return (
      <div>
        <h1>Story not found</h1>
        <Button onClick={() => navigate('/stories')}>Back to library</Button>
      </div>
    );
  }

  const stats = loadStats(storyId);
  const endings = loadEndings(storyId);

  const exportBundle = async () => {
    const files = await storiesApi.files(storyId);
    downloadText(
      `${slugify(story.title)}.fables-bundle.json`,
      JSON.stringify(storyBundle(story, files), null, 2),
      'application/json',
    );
  };
  const exportManifest = async () => {
    const files = await storiesApi.files(storyId);
    downloadText(
      `${slugify(story.title)}.manifest.json`,
      JSON.stringify(storyManifest(story, files), null, 2),
      'application/json',
    );
  };

  return (
    <div className="story-detail">
      <div className="story-detail-hero">
        <StoryCover story={story} size="hero" />
        <div className="story-detail-head">
          <h1>{story.title}</h1>
          {meta.author !== '' ? <p className="story-detail-author">by {meta.author}</p> : null}
          {story.description !== '' ? <p>{story.description}</p> : null}
          {meta.tags.length > 0 ? (
            <div className="story-detail-tags">
              {meta.tags.map((tag) => (
                <span key={tag} className="story-status">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {meta.contentNotes !== '' ? (
            <p className="story-detail-notes">Content notes: {meta.contentNotes}</p>
          ) : null}
          <div className="story-detail-actions">
            <Button variant="primary" onClick={() => navigate(`/stories/${storyId}/play`)}>
              <Play size={14} /> Play
            </Button>
            <Button onClick={() => navigate(`/stories/${storyId}/edit`)}>
              <Pencil size={14} /> Edit
            </Button>
            <Button onClick={() => setEditOpen(true)}>Details…</Button>
          </div>
        </div>
      </div>

      <section className="story-detail-section" aria-label="Reading stats">
        <h2>Your reading</h2>
        <p>
          {formatDuration(stats.secondsRead)} read · {stats.choicesMade} choices made ·{' '}
          {stats.runsFinished} of {stats.runsStarted} playthroughs finished
        </p>
        <h2>Endings found{endings.length > 0 ? ` (${endings.length})` : ''}</h2>
        {endings.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>None yet — go find one.</p>
        ) : (
          <div className="story-detail-tags">
            {endings.map((ending) => (
              <span key={ending.id} className="story-status badge-finished">
                {ending.label}
                {ending.timesReached > 1 ? ` ×${ending.timesReached}` : ''}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="story-detail-section" aria-label="Export and sharing">
        <h2>Export &amp; share</h2>
        <div className="story-detail-actions">
          <Button onClick={() => void exportBundle()}>
            <Download size={14} /> Source bundle
          </Button>
          <Button onClick={() => void exportManifest()}>
            <Download size={14} /> Manifest
          </Button>
          <Button
            onClick={() => {
              void shareText({
                title: story.title,
                text: `Read “${story.title}” on Fables`,
                url: `${window.location.origin}/stories/${storyId}/play`,
              }).then((how) => {
                if (how === 'copied') toast('Link copied');
              });
            }}
          >
            <Share2 size={14} /> Share
          </Button>
          <Button
            onClick={() => {
              const next = { ...meta, archived: !meta.archived };
              saveLibraryMeta(storyId, next);
              setMeta(next);
              toast(next.archived ? 'Story archived' : 'Story unarchived');
            }}
          >
            {meta.archived ? 'Unarchive' : 'Archive'}
          </Button>
        </div>
      </section>

      {editOpen ? (
        <MetadataDialog
          story={story}
          meta={meta}
          onClose={() => setEditOpen(false)}
          onSaved={setMeta}
        />
      ) : null}
    </div>
  );
}
