/** Typed API client. Same-origin in production; Vite proxies /api in dev. */

export interface ApiError {
  code: string;
  message: string;
  details: Record<string, unknown> | null;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

export const isConflictError = (error: unknown): error is ApiRequestError =>
  error instanceof ApiRequestError && error.code === 'CONFLICT';

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data?: T; error?: ApiError };
  if (!res.ok || body.error) {
    throw new ApiRequestError(
      res.status,
      body.error ?? { code: 'INTERNAL', message: 'unknown error', details: null },
    );
  }
  return body.data as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    headers: { 'content-type': 'application/json', ...init?.headers },
    ...init,
  });
  return parse<T>(res);
}

/** Envelope page metadata for paginated lists. */
export interface Page {
  nextCursor: string | null;
  limit: number;
}

export interface Paginated<T> {
  data: T[];
  page: Page;
}

async function requestPaged<T>(path: string): Promise<Paginated<T>> {
  const res = await fetch(`/api/v1${path}`, { headers: { 'content-type': 'application/json' } });
  const body = (await res.json()) as { data?: T[]; page?: Page; error?: ApiError };
  if (!res.ok || body.error) {
    throw new ApiRequestError(
      res.status,
      body.error ?? { code: 'INTERNAL', message: 'unknown error', details: null },
    );
  }
  return { data: body.data ?? [], page: body.page ?? { nextCursor: null, limit: 0 } };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  getPaged: <T>(path: string) => requestPaged<T>(path),
  post: <T>(path: string, payload?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: payload === undefined ? null : JSON.stringify(payload),
    }),
  patch: <T>(path: string, payload: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(payload) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

/* ===== Health ===== */

export interface HealthData {
  status: string;
  version: string;
  uptimeSeconds: number;
  db: string;
}

export const fetchHealth = () => api.get<HealthData>('/health');

/* ===== Domain types (mirrors @fables/core + server repos) ===== */

export interface Note {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  pinned: boolean;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-concurrency revision counter, bumped on every write. */
  rev: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export interface TagWithCount extends Tag {
  noteCount: number;
}

export type NoteWithTags = Note & { tags: Tag[] };

export interface Notebook {
  id: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookTreeNode extends Notebook {
  noteCount: number;
  children: NotebookTreeNode[];
}

export interface Attachment {
  id: string;
  noteId: string | null;
  filename: string;
  mime: string;
  size: number;
  hash: string;
  createdAt: string;
}

export interface NoteRevisionMeta {
  noteId: string;
  rev: number;
  title: string;
  wordCount: number;
  charCount: number;
  contentHash: string;
  createdAt: string;
}

export type NoteRevision = NoteRevisionMeta & { body: string };

export interface DiffOp {
  op: 'equal' | 'add' | 'del';
  text: string;
}

export interface RevisionDiff {
  noteId: string;
  from: number;
  to: number;
  ops: DiffOp[];
}

export type NoteSort = 'updated' | 'created' | 'title';

/* ===== Notes ===== */

export interface ListNotesParams {
  sort?: NoteSort;
  notebookId?: string;
  limit?: number;
  cursor?: string;
}

export interface NotePatch {
  rev: number;
  title?: string;
  body?: string;
  pinned?: boolean;
  notebookId?: string;
}

export const notesApi = {
  list: (params: ListNotesParams = {}) => api.getPaged<Note>(`/notes${qs({ ...params })}`),
  get: (id: string) => api.get<NoteWithTags>(`/notes/${id}`),
  create: (input: { notebookId: string; title?: string; body?: string }) =>
    api.post<Note>('/notes', input),
  patch: (id: string, patch: NotePatch) => api.patch<Note>(`/notes/${id}`, patch),
  remove: (id: string) => api.delete<Note>(`/notes/${id}`),
  restore: (id: string) => api.post<Note>(`/notes/${id}/restore`),
  duplicate: (id: string) => api.post<Note>(`/notes/${id}/duplicate`),
  bulk: (input: {
    action: 'move' | 'tag' | 'delete';
    noteIds: string[];
    notebookId?: string;
    tag?: string;
  }) => api.post<{ action: string; affected: number }>('/notes/bulk', input),
};

/* ===== Trash ===== */

export const trashApi = {
  list: (params: { limit?: number; cursor?: string } = {}) =>
    api.getPaged<Note>(`/trash${qs({ ...params })}`),
  empty: () => api.post<{ purged: number }>('/trash/empty'),
};

/* ===== Notebooks ===== */

export const notebooksApi = {
  list: (includeArchived = false) =>
    api.get<Notebook[]>(`/notebooks${qs({ includeArchived: includeArchived || undefined })}`),
  tree: (includeArchived = false) =>
    api.get<NotebookTreeNode[]>(
      `/notebooks/tree${qs({ includeArchived: includeArchived || undefined })}`,
    ),
  get: (id: string) => api.get<Notebook>(`/notebooks/${id}`),
  create: (input: {
    name: string;
    parentId?: string | null;
    icon?: string | null;
    color?: string | null;
  }) => api.post<Notebook>('/notebooks', input),
  patch: (
    id: string,
    patch: {
      name?: string;
      parentId?: string | null;
      icon?: string | null;
      color?: string | null;
      archived?: boolean;
    },
  ) => api.patch<Notebook>(`/notebooks/${id}`, patch),
  remove: (id: string, moveNotesTo?: string) =>
    api.delete<{ id: string }>(`/notebooks/${id}${qs({ moveNotesTo })}`),
};

/* ===== Tags ===== */

export const tagsApi = {
  list: () => api.get<TagWithCount[]>('/tags'),
  create: (input: { name: string; color?: string | null }) => api.post<Tag>('/tags', input),
  patch: (id: string, patch: { name?: string; color?: string | null }) =>
    api.patch<Tag>(`/tags/${id}`, patch),
  remove: (id: string) => api.delete<{ id: string; deleted: boolean }>(`/tags/${id}`),
  merge: (id: string, targetId: string) =>
    api.post<{ target: Tag; mergedNotes: number }>(`/tags/${id}/merge-into/${targetId}`),
  cleanup: () => api.post<{ removed: number }>('/tags/cleanup'),
};

/* ===== Revisions ===== */

export const revisionsApi = {
  list: (noteId: string) => api.get<NoteRevisionMeta[]>(`/notes/${noteId}/revisions`),
  get: (noteId: string, rev: number) => api.get<NoteRevision>(`/notes/${noteId}/revisions/${rev}`),
  restore: (noteId: string, rev: number) =>
    api.post<Note>(`/notes/${noteId}/revisions/${rev}/restore`),
  /** Diff transforming revision `against` into revision `rev`. */
  diff: (noteId: string, rev: number, against: number) =>
    api.get<RevisionDiff>(`/notes/${noteId}/revisions/${rev}/diff${qs({ against })}`),
};

/* ===== Links: backlinks + unlinked mentions (F211–F230) ===== */

export interface LinkSnippet {
  text: string;
  highlightStart: number;
  highlightEnd: number;
}

export interface IncomingLinkItem {
  id: string;
  /** UTF-16 offset of the link/mention in the source body. */
  position: number;
  length: number;
  text: string;
  heading: string | null;
  blockId: string | null;
  snippet: LinkSnippet;
}

export interface IncomingLinkGroup {
  note: { id: string; title: string; notebookId: string; updatedAt: string };
  count: number;
  links: IncomingLinkItem[];
}

export interface IncomingLinks {
  noteId: string;
  total: number;
  sources: IncomingLinkGroup[];
}

export const linksApi = {
  backlinks: (noteId: string) => api.get<IncomingLinks>(`/notes/${noteId}/backlinks`),
  mentions: (noteId: string) => api.get<IncomingLinks>(`/notes/${noteId}/mentions`),
  /** Convert one mention (by id) or every mention into a real wikilink. */
  convertMentions: (noteId: string, input: { mentionId?: string; all?: boolean }) =>
    api.post<{ converted: number }>(`/notes/${noteId}/mentions/link`, input),
};

/* ===== Graph (F231–F240) ===== */

export type GraphLinkKind = 'wikilink' | 'mention' | 'binding' | 'relation';

export interface GraphNode {
  id: string;
  type: 'note';
  title: string;
  notebookId: string;
  degree: number;
  orphan: boolean;
  community: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: GraphLinkKind;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { nodes: number; edges: number; orphans: number; communities: number };
}

export interface GraphFilterParams {
  notebookId?: string;
  tag?: string;
  /** Link kinds to include; the server defaults to wikilinks only. */
  kinds?: GraphLinkKind[];
  since?: string;
}

/** Builds the query-param record the graph endpoints accept (F246). */
export function buildGraphParams(
  filter: GraphFilterParams,
  extra: Record<string, string | number | undefined> = {},
): Record<string, string | number | undefined> {
  return {
    notebookId: filter.notebookId || undefined,
    tag: filter.tag || undefined,
    kinds: filter.kinds && filter.kinds.length > 0 ? filter.kinds.join(',') : undefined,
    since: filter.since || undefined,
    ...extra,
  };
}

export const graphApi = {
  full: (filter: GraphFilterParams = {}) =>
    api.get<GraphData>(`/graph${qs(buildGraphParams(filter))}`),
  local: (noteId: string, hops: number, filter: GraphFilterParams = {}) =>
    api.get<GraphData>(`/notes/${noteId}/graph${qs(buildGraphParams(filter, { hops }))}`),
};

/* ===== Attachments ===== */

/** Public URL an attachment streams from (img src / link href). */
export const attachmentUrl = (id: string): string => `/api/v1/attachments/${id}`;

export const attachmentsApi = {
  list: (params: { limit?: number; cursor?: string } = {}) =>
    api.getPaged<Attachment>(`/attachments${qs({ ...params })}`),
  remove: (id: string) =>
    api.delete<{ id: string; deleted: boolean; fileDeleted: boolean }>(`/attachments/${id}`),
  /** Multipart upload; field order matters — noteId must precede the file. */
  upload: async (file: File, noteId?: string): Promise<Attachment> => {
    const form = new FormData();
    if (noteId !== undefined) form.append('noteId', noteId);
    form.append('file', file, file.name);
    const res = await fetch('/api/v1/attachments', { method: 'POST', body: form });
    return parse<Attachment>(res);
  },
};
