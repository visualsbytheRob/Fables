import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import etag from '@fastify/etag';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { isAppError, type ErrorCode } from '@fables/core';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { CollabService } from './collab/service.js';
import { ExtendedVaultService } from './vault/extended-service.js';
import { registerVaultDataKeyGetter } from './vault/attachment-crypto.js';
import { AIRuntime } from './ai/runtime.js';
import { AiRequestQueue } from './ai/queue.js';
import { OllamaAdapter } from './ai/ollama.js';
import { LlamaCppAdapter } from './ai/llamacpp.js';
import { ClaudeAdapter } from './ai/claude.js';
import { TtsRuntime } from './audio/tts/runtime.js';
import { PiperAdapter } from './audio/tts/piper.js';
import { ttsSettingsRepo } from './audio/tts/settings.js';
import { usageMeter, type UsageMeter } from './ai/usage-meter.js';
import { aiSettingsRepo } from './ai/settings.js';
import { ImporterRegistry } from './import/framework/index.js';
import { registerBuiltinImporters } from './import/importers.js';
import { ExporterRegistry } from './export/index.js';
import { registerBuiltinExporters } from './export/exporters.js';
import { openDb, type Db } from './db/connection.js';
import { instrumentDb } from './db/instrument.js';
import { migrate } from './db/migrate.js';
import { createIntelligenceService, type IntelligenceService } from './intelligence/index.js';
import { runBootJobs } from './jobs.js';
import type { PluginRegistry } from './plugins/service.js';
import { buildLoggerOptions } from './logging.js';
import { configRoutes } from './routes/config.js';
import { routes } from './routes/index.js';
import { assertSchemaCompatible } from './routes/upgrade.js';
import { registerSecurityHeaders, registerTokenAuth } from './security.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    /** Root of on-disk storage (attachments live under `<dataDir>/attachments`). */
    dataDir: string;
    /** Local intelligence: embeddings + vector search + hybrid ranking. */
    intel: IntelligenceService;
    /** Plugin runtime registry (undefined until boot jobs complete). */
    plugins?: PluginRegistry;
    /** CRDT collaboration service: room management, awareness relay, persistence. */
    collab: CollabService;
    /** Encrypted vault: passphrase unlock + at-rest field encryption (Epic 13).
     *  At runtime this is always an ExtendedVaultService (a strict superset). */
    vault: ExtendedVaultService;
    /** AI runtime: pluggable language-model backends; optional/graceful (Epic 14). */
    ai: AIRuntime;
    /** Concurrency-limited, cancellable AI request queue (F1306). */
    aiQueue: AiRequestQueue;
    /** TTS runtime: pluggable speech engines; optional/graceful (Epic 17). */
    tts: TtsRuntime;
    /** Local AI token-usage meter (F1367). */
    aiUsage: UsageMeter;
    /** Importer registry: source adapters keyed by name (Epic 15, F1409). */
    importers: ImporterRegistry;
    /** Exporter registry: format targets keyed by name (Epic 15, F1471). */
    exporters: ExporterRegistry;
  }
}

const HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export const APP_VERSION = '0.1.0';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions(config) as { level: string },
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: config.env === 'test',
    // Above the JSON-body ceiling our own 1 MB note-body guard enforces (F118).
    bodyLimit: 8 * 1024 * 1024,
  });

  const db = instrumentDb(openDb(config.env === 'test' ? ':memory:' : config.dataDir), app.log);
  const { applied } = migrate(db);
  if (applied.length > 0) app.log.info({ applied }, 'database migrations applied');
  // Downgrade protection (F965): refuse to open a DB created by a newer binary.
  assertSchemaCompatible(db);
  app.decorate('db', db);
  app.decorate('dataDir', config.dataDir);
  const intel = createIntelligenceService(db, process.env['FABLES_EMBEDDING_MODEL']);
  app.decorate('intel', intel);

  // Collab service (F1121–F1140)
  const collab = new CollabService(db, app.log);
  app.decorate('collab', collab);

  // Encrypted vault service (F1211–F1220) — locked until a passphrase unlock.
  // ExtendedVaultService is a strict superset of VaultService; it adds binary
  // blob seal/open (F1214) and data-key exposure for the backup v2 format (F1218).
  const vault = new ExtendedVaultService(db);
  app.decorate('vault', vault);
  // Let the encrypted-attachment module reach the data key without touching the
  // vault's private field (F1214).
  registerVaultDataKeyGetter(vault, () => vault.currentDataKey());

  // AI runtime (Epic 14) — local Ollama is preferred; the Claude cloud adapter
  // is registered too but only becomes available when an API key is configured
  // and is opt-in (F1361–F1365). Absent/unavailable backends mean every AI
  // feature degrades gracefully (F1309). Tests register a mock adapter.
  const ai = new AIRuntime()
    .register(new OllamaAdapter())
    .register(new LlamaCppAdapter())
    .register(new ClaudeAdapter());
  // Apply the persisted global kill switch on boot (F1392) so "AI off" survives
  // restarts — secret-by-default if the user turned everything off.
  ai.setKillSwitch(aiSettingsRepo(db).get().killSwitch);
  app.decorate('ai', ai);
  app.decorate('aiQueue', new AiRequestQueue(2));
  app.decorate('aiUsage', usageMeter(db));

  // TTS runtime (Epic 17) — a local Piper-class engine is preferred; it's only
  // available when a binary + voice models are configured, so speech degrades
  // gracefully to the web layer's Web Speech API (F1604) when absent. The
  // persisted disable flag (F1608) is applied on boot.
  const tts = new TtsRuntime().register(new PiperAdapter());
  tts.setDisabled(ttsSettingsRepo(db).get().disabled);
  app.decorate('tts', tts);

  // Importer registry (Epic 15): built-in source adapters register here; plugins
  // can add more via the importer SDK (F1409).
  app.decorate('importers', registerBuiltinImporters(new ImporterRegistry()));
  app.decorate('exporters', registerBuiltinExporters(new ExporterRegistry()));

  app.addHook('onClose', async () => {
    await collab.shutdown();
    db.close();
  });

  // Boot maintenance: trash auto-purge (F107), orphan tags (F159), attachment GC (F164).
  // Skipped in tests: the in-memory db must never drive deletions in a real dataDir.
  if (config.env !== 'test') runBootJobs(db, config.dataDir, app.log);

  // WebSocket support for collab (F1121)
  await app.register(fastifyWebsocket);

  await app.register(cors, {
    // Single-user app on a tailnet: allow the ts.net origin and localhost dev ports.
    origin: [/^https?:\/\/localhost(:\d+)?$/, /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/],
  });
  await app.register(etag);
  await app.register(compress, { global: true, encodings: ['br', 'gzip'] });
  await app.register(rateLimit, {
    // Generous: this protects against runaway scripts, not adversaries — the
    // tailnet is the actual perimeter.
    max: 600,
    timeWindow: '1 minute',
  });

  // Security headers (F947) — CSP, X-Content-Type-Options, frame-ancestors.
  registerSecurityHeaders(app);

  // Optional token auth (F886/F949) — off when FABLES_TOKEN is unset.
  registerTokenAuth(app, process.env['FABLES_TOKEN']);

  // API version negotiation (F086): clients can pin via x-fables-api-version.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-fables-api-version', '1');
  });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      return reply
        .status(HTTP_STATUS[error.code])
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if ((error as { statusCode?: number }).statusCode === 413) {
      return reply.status(413).send({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'request body too large', details: null },
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL', message: 'internal server error', details: null } });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `no route for ${request.method} ${request.url}`,
        details: null,
      },
    });
  });

  // Every resource module registers under the version prefix.
  for (const route of routes) {
    await app.register(route, { prefix: '/api/v1' });
  }
  await app.register(configRoutes(config), { prefix: '/api/v1' });

  // Serve the built web app when it exists (production mode).
  const webDist = path.resolve(fileURLToPath(import.meta.url), '../../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    // SPA fallback for client-side routes — but API misses must stay JSON 404s.
    app.get('/*', (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.callNotFound();
      return reply.sendFile('index.html');
    });
  }

  return app;
}
