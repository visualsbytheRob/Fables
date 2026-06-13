/**
 * Intelligence service singleton (F721–F750).
 *
 * Holds the EmbeddingProvider, EmbeddingQueue, and VectorStore in one place.
 * The Fastify app decorates itself with `app.intel` via the intelligence plugin.
 */

import type { Db } from '../db/connection.js';
import { EmbeddingQueue } from './embedding-queue.js';
import { defaultHashProvider, resolveProvider, type EmbeddingProvider } from './embedding-provider.js';
import { VectorStore } from './vector-store.js';

export interface IntelligenceService {
  provider: EmbeddingProvider;
  queue: EmbeddingQueue;
  store: VectorStore;
}

export function createIntelligenceService(
  db: Db,
  modelPath?: string,
): IntelligenceService {
  const provider = modelPath ? resolveProvider(modelPath) : defaultHashProvider;
  const queue = new EmbeddingQueue(db, provider);
  const store = new VectorStore(db, provider);
  return { provider, queue, store };
}
