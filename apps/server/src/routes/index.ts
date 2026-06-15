import type { FastifyPluginAsync } from 'fastify';
import { analyticsRoutes } from './analytics.js';
import { complianceRoutes } from './compliance.js';
import { attachmentsRoutes } from './attachments.js';
import { pluginsRoutes } from './plugins.js';
import { pluginsDistributionRoutes } from './plugins-distribution.js';
import { backupRoutes } from './backup.js';
import { upgradeRoutes } from './upgrade.js';
import { clipRoutes } from './clip.js';
import { codexRoutes } from './codex.js';
import { crossrefRoutes } from './crossref.js';
import { debugRoutes } from './debug.js';
import { effectsRoutes } from './effects.js';
import { embeddingsRoutes } from './embeddings.js';
import { entitiesRoutes } from './entities.js';
import { graphRoutes } from './graph.js';
import { healthRoutes } from './health.js';
import { importExportRoutes } from './import-export.js';
import { importFrameworkRoutes } from './import-framework.js';
import { exportRoutes } from './export.js';
import { ingestRoutes } from './ingest.js';
import { insightsRoutes } from './insights.js';
import { knowledgeRoutes } from './knowledge.js';
import { linksRoutes } from './links.js';
import { notebooksRoutes } from './notebooks.js';
import { notesRoutes } from './notes.js';
import { queryRoutes } from './query.js';
import { revisionsRoutes } from './revisions.js';
import { savedQueriesRoutes } from './saved-queries.js';
import { searchRoutes } from './search.js';
import { storiesRoutes } from './stories.js';
import { storyFilesRoutes } from './story-files.js';
import { storySavesRoutes } from './story-saves.js';
import { tagsRoutes } from './tags.js';
import { timelineRoutes } from './timeline.js';
import { transclusionRoutes } from './transclusion.js';
import { syncRoutes } from './sync.js';
import { collabRoutes } from './collab.js';
import { sharesRoutes } from './shares.js';
import { vaultRoutes } from './vault.js';
import { aiRoutes } from './ai.js';
import { aiStoryRoutes } from './ai-story.js';
import { aiCharacterRoutes } from './ai-character.js';
import { aiActionsRoutes } from './ai-actions.js';
import { transcribeRoutes } from './transcribe.js';
import { trashRoutes } from './trash.js';
import { worldRoutes } from './world.js';
import { canvasRoutes } from './canvas.js';
import { ttsRoutes } from './tts.js';
import { castingRoutes } from './casting.js';
import { narrationRoutes } from './narration.js';
import { soundscapeRoutes } from './soundscape.js';
import { readalongRoutes } from './readalong.js';
import { studioRoutes } from './studio.js';
import { audiobookRoutes } from './audiobook.js';
import { playbackRoutes } from './playback.js';
import { audioA11yRoutes } from './audio-a11y.js';
import { cardRoutes } from './cards.js';
import { learningStoryRoutes } from './learning-story.js';
import { deckRoutes } from './decks.js';
import { learningInsightsRoutes } from './learning-insights.js';
import { learningEdgeRoutes } from './learning-edge.js';
import { learningHabitsRoutes } from './learning-habits.js';
import { ankiRoutes } from './anki.js';
import { fablepackRoutes } from './fablepack.js';
import { releaseRoutes } from './releases.js';
import { interopRoutes } from './interop.js';
import { feedbackRoutes } from './feedback.js';

/** Every resource module exports a plugin and registers here — one line per resource. */
export const routes: FastifyPluginAsync[] = [
  healthRoutes,
  debugRoutes,
  notesRoutes,
  linksRoutes,
  graphRoutes,
  revisionsRoutes,
  trashRoutes,
  notebooksRoutes,
  tagsRoutes,
  attachmentsRoutes,
  queryRoutes,
  savedQueriesRoutes,
  importExportRoutes,
  importFrameworkRoutes,
  exportRoutes,
  storiesRoutes,
  storyFilesRoutes,
  storySavesRoutes,
  entitiesRoutes,
  codexRoutes,
  effectsRoutes,
  knowledgeRoutes,
  timelineRoutes,
  crossrefRoutes,
  transclusionRoutes,
  worldRoutes,
  canvasRoutes,
  ttsRoutes,
  castingRoutes,
  narrationRoutes,
  soundscapeRoutes,
  readalongRoutes,
  studioRoutes,
  audiobookRoutes,
  playbackRoutes,
  audioA11yRoutes,
  cardRoutes,
  learningStoryRoutes,
  deckRoutes,
  learningInsightsRoutes,
  learningEdgeRoutes,
  learningHabitsRoutes,
  ankiRoutes,
  fablepackRoutes,
  releaseRoutes,
  interopRoutes,
  feedbackRoutes,
  searchRoutes,
  embeddingsRoutes,
  insightsRoutes,
  ingestRoutes,
  clipRoutes,
  transcribeRoutes,
  syncRoutes,
  collabRoutes,
  sharesRoutes,
  vaultRoutes,
  aiRoutes,
  aiStoryRoutes,
  aiCharacterRoutes,
  aiActionsRoutes,
  backupRoutes,
  analyticsRoutes,
  complianceRoutes,
  upgradeRoutes,
  pluginsRoutes,
  pluginsDistributionRoutes,
];
