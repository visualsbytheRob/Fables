/**
 * @fables/plugin-sdk — typed interfaces for Fables plugin authors.
 *
 * Import from this package to get full TypeScript support when writing
 * Fables plugins. The SDK has zero runtime dependencies: all types are
 * erased at compile time, and the runtime bridge is provided by the host.
 */

export * from './manifest.js';
export * from './rpc.js';
export * from './events.js';
export * from './host-api.js';
