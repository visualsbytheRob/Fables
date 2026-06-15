import { migration001Notes } from './001-notes.js';
import { migration002Stories } from './002-stories.js';
import { migration003NoteRevisions } from './003-note-revisions.js';
import { migration004Attachments } from './004-attachments.js';
import { migration005Links } from './005-links.js';
import { migration006SavedQueries } from './006-saved-queries.js';
import { migration007ImportJobs } from './007-import-jobs.js';
import { migration008StoryProjects } from './008-story-projects.js';
import { migration009Entities } from './009-entities.js';
import { migration010World } from './010-world.js';
import { migration011Fts } from './011-fts.js';
import { migration012Embeddings } from './012-embeddings.js';
import { migration013IngestJobs } from './013-ingest-jobs.js';
import { migration014Sync } from './014-sync.js';
import { migration015Analytics } from './015-analytics.js';
import { migration016Plugins } from './016-plugins.js';
import { migration017PluginDistribution } from './017-plugin-distribution.js';
import { migration018Crdt } from './018-crdt.js';
import { migration019Shares } from './019-shares.js';
import { migration020Vault } from './020-vault.js';
import { migration021SecurityAudit } from './021-security-audit.js';
import { migration022Compliance } from './022-compliance.js';
import { migration023Retention } from './023-retention.js';
import { migration024AiUsage } from './024-ai-usage.js';
import { migration025AiActions } from './025-ai-actions.js';
import { migration026AiSettings } from './026-ai-settings.js';
import { migration027ImportFramework } from './027-import-framework.js';
import { migration028Canvas } from './028-canvas.js';
import { migration029CanvasEdges } from './029-canvas-edges.js';
import { migration030Tts } from './030-tts.js';
import { migration031Casting } from './031-casting.js';
import { migration032AudioSettings } from './032-audio-settings.js';
import { migration033RecordingTakes } from './033-recording-takes.js';
import { migration034Playback } from './034-playback.js';
import { migration035Cards } from './035-cards.js';
import { migration036Decks } from './036-decks.js';
import { migration037LearningSettings } from './037-learning-settings.js';
import { migration038Feedback } from './038-feedback.js';
import { migration039GeneratedAssets } from './039-generated-assets.js';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** Ordered, append-only. Never edit a shipped migration — add a new one. */
export const migrations: Migration[] = [
  migration001Notes,
  migration002Stories,
  migration003NoteRevisions,
  migration004Attachments,
  migration005Links,
  migration006SavedQueries,
  migration007ImportJobs,
  migration008StoryProjects,
  migration009Entities,
  migration010World,
  migration011Fts,
  migration012Embeddings,
  migration013IngestJobs,
  migration014Sync,
  migration015Analytics,
  migration016Plugins,
  migration017PluginDistribution,
  migration018Crdt,
  migration019Shares,
  migration020Vault,
  migration021SecurityAudit,
  migration022Compliance,
  migration023Retention,
  migration024AiUsage,
  migration025AiActions,
  migration026AiSettings,
  migration027ImportFramework,
  migration028Canvas,
  migration029CanvasEdges,
  migration030Tts,
  migration031Casting,
  migration032AudioSettings,
  migration033RecordingTakes,
  migration034Playback,
  migration035Cards,
  migration036Decks,
  migration037LearningSettings,
  migration038Feedback,
  migration039GeneratedAssets,
];
