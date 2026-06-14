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
];
