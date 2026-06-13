/**
 * Story-project API client (F511, server lane F501–F510). The server persists
 * projects, files, build diagnostics and saves; everything here is additive —
 * editing, diagnostics, the scene graph and playtest all run client-side on
 * the open buffers even when no server is reachable.
 */
import { api } from '../api/client.js';

export type StoryStatus = 'draft' | 'valid' | 'broken';

export interface StoryProject {
  id: string;
  title: string;
  description: string;
  entryFile: string;
  status: StoryStatus;
  errorCount?: number;
  warningCount?: number;
  builtAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryFile {
  id: string;
  storyId: string;
  path: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

/** Server-side build snapshot (compile-on-save persists diagnostics). */
export interface StoryBuild {
  status: StoryStatus;
  errorCount: number;
  warningCount: number;
  builtAt: string | null;
  diagnostics: unknown[];
}

export const storiesApi = {
  list: () => api.get<StoryProject[]>('/stories'),
  get: (id: string) => api.get<StoryProject>(`/stories/${id}`),
  create: (input: { title: string; description?: string }) =>
    api.post<StoryProject>('/stories', input),
  patch: (id: string, patch: { title?: string; description?: string; entryFile?: string }) =>
    api.patch<StoryProject>(`/stories/${id}`, patch),
  /** Deletion is title-confirmed server-side: saves and releases cascade with it. */
  remove: (id: string, confirmTitle: string) =>
    api.delete<{ id: string; deleted: boolean }>(
      `/stories/${id}?confirm=${encodeURIComponent(confirmTitle)}`,
    ),

  /** The list endpoint omits `source`; hydrate each file so buffers load complete. */
  files: async (id: string): Promise<StoryFile[]> => {
    const metas = await api.get<Omit<StoryFile, 'source'>[]>(`/stories/${id}/files`);
    return Promise.all(metas.map((m) => api.get<StoryFile>(`/stories/${id}/files/${m.id}`)));
  },
  createFile: (id: string, input: { path: string; source?: string }) =>
    api
      .post<{ file: StoryFile; build: StoryBuild }>(`/stories/${id}/files`, input)
      .then((r) => r.file),
  /** Save a file's source via PATCH; the server recompiles and persists diagnostics. */
  saveFile: (id: string, fileId: string, source: string) =>
    api
      .patch<{ file: StoryFile; build: StoryBuild }>(`/stories/${id}/files/${fileId}`, { source })
      .then((r) => r.file),
  removeFile: (id: string, fileId: string) =>
    api.delete<{ id: string; deleted: boolean }>(`/stories/${id}/files/${fileId}`),

  build: (id: string) => api.get<StoryBuild>(`/stories/${id}/build`),
};
