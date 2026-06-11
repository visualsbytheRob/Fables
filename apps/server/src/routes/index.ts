import type { FastifyPluginAsync } from 'fastify';
import { debugRoutes } from './debug.js';
import { healthRoutes } from './health.js';

/** Every resource module exports a plugin and registers here — one line per resource. */
export const routes: FastifyPluginAsync[] = [healthRoutes, debugRoutes];
