/**
 * Importer registry (F1409): the dispatch table that lets built-in importers and
 * plugins register source adapters by name. Routes resolve `/import/:source/...`
 * through here, so adding a new importer is just one `register` call — no route
 * changes. The `input` is source-specific (a path, an uploaded file id, …) and
 * validated by the adapter factory.
 */

import { validation } from '@fables/core';
import type { SourceAdapter } from './types.js';

export type AdapterFactory = (input: unknown) => SourceAdapter;

export interface ImporterInfo {
  /** Source name, e.g. 'notion'. */
  name: string;
  /** One-line human description for the importer picker. */
  description: string;
}

export class ImporterRegistry {
  private readonly factories = new Map<string, AdapterFactory>();
  private readonly infos = new Map<string, ImporterInfo>();

  register(info: ImporterInfo, factory: AdapterFactory): this {
    this.factories.set(info.name, factory);
    this.infos.set(info.name, info);
    return this;
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  /** Build an adapter for a source, validating the source name. */
  create(name: string, input: unknown): SourceAdapter {
    const factory = this.factories.get(name);
    if (!factory) throw validation(`unknown import source "${name}"`, { source: name });
    return factory(input);
  }

  list(): ImporterInfo[] {
    return [...this.infos.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
