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
  put: <T>(path: string, payload: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(payload) }),
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

/* ===== FQL queries (F271–F290) ===== */

/** Paginated note results plus partial-parse warnings (F279). */
export interface FqlQueryResult {
  data: Note[];
  page: Page;
  warnings: string[];
}

export interface FqlValidation {
  valid: boolean;
  warnings: string[];
  error?: { message: string; position: number | null };
}

async function requestFql(path: string): Promise<FqlQueryResult> {
  const res = await fetch(`/api/v1${path}`, { headers: { 'content-type': 'application/json' } });
  const body = (await res.json()) as {
    data?: Note[];
    page?: Page;
    warnings?: string[];
    error?: ApiError;
  };
  if (!res.ok || body.error) {
    throw new ApiRequestError(
      res.status,
      body.error ?? { code: 'INTERNAL', message: 'unknown error', details: null },
    );
  }
  return {
    data: body.data ?? [],
    page: body.page ?? { nextCursor: null, limit: 0 },
    warnings: body.warnings ?? [],
  };
}

export const queryApi = {
  run: (q: string, params: { limit?: number; cursor?: string } = {}) =>
    requestFql(`/query${qs({ q, ...params })}`),
  validate: (q: string) => api.post<FqlValidation>('/query/validate', { q }),
  /** Raw markdown table of the full result set (F288). */
  exportMarkdown: async (q: string): Promise<string> => {
    const res = await fetch(`/api/v1/query/export${qs({ q })}`);
    if (!res.ok) {
      throw new ApiRequestError(res.status, {
        code: 'INTERNAL',
        message: 'export failed',
        details: null,
      });
    }
    return res.text();
  },
};

/* ===== Saved queries (F281–F287) ===== */

export interface SavedQuery {
  id: string;
  name: string;
  fql: string;
  icon: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export const savedQueriesApi = {
  list: () => api.get<SavedQuery[]>('/saved-queries'),
  create: (input: { name: string; fql: string; icon?: string | null; pinned?: boolean }) =>
    api.post<SavedQuery>('/saved-queries', input),
  patch: (
    id: string,
    patch: { name?: string; fql?: string; icon?: string | null; pinned?: boolean },
  ) => api.patch<SavedQuery>(`/saved-queries/${id}`, patch),
  remove: (id: string) => api.delete<{ id: string; deleted: boolean }>(`/saved-queries/${id}`),
  results: (id: string, params: { limit?: number; cursor?: string } = {}) =>
    requestFql(`/saved-queries/${id}/results${qs({ ...params })}`),
};

/* ===== Import (F291–F298) ===== */

export interface ScanFileReport {
  path: string;
  title: string;
  attachments: number;
  collision: boolean;
}

export interface ScanReport {
  path: string;
  files: ScanFileReport[];
  totals: { files: number; attachments: number; collisions: number };
}

export interface ImportFileError {
  file: string;
  message: string;
}

export interface ImportJob {
  id: string;
  path: string;
  status: 'running' | 'done' | 'failed';
  total: number;
  processed: number;
  imported: number;
  merged: number;
  renamed: number;
  skipped: number;
  attachments: number;
  errors: ImportFileError[];
  createdAt: string;
  updatedAt: string;
}

export type ImportCollisionMode = 'skip' | 'rename' | 'merge';

export const importApi = {
  scan: (path: string) => api.post<ScanReport>('/import/scan', { path }),
  run: (input: { path: string; notebookId?: string; collisions: ImportCollisionMode }) =>
    api.post<ImportJob>('/import/run', input),
  job: (id: string) => api.get<ImportJob>(`/import/jobs/${id}`),
};

/* ===== Entities + schemas (F601–F610, web halves F603/F604/F607) ===== */

export type EntityType = 'character' | 'place' | 'item' | 'faction' | 'custom';
export type EntityFieldType = 'number' | 'string' | 'bool' | 'list';

export interface EntityFieldDef {
  name: string;
  fieldType: EntityFieldType;
  default?: number | string | boolean | unknown[];
  required?: boolean;
}

export interface EntityRelationDef {
  name: string;
  targetType: EntityType | null;
}

export interface EntityTypeSchema {
  type: EntityType;
  fields: EntityFieldDef[];
  relations: EntityRelationDef[];
  updatedAt: string;
}

/** name → list of target entity ids. */
export type RelationMap = Record<string, string[]>;

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  fields: Record<string, unknown>;
  noteId: string | null;
  createdAt: string;
  updatedAt: string;
  relations: RelationMap;
}

export interface IncomingRelation {
  id: string;
  name: string;
  sourceId: string;
  sourceName: string;
  sourceType: EntityType;
}

export type EntityDetail = Entity & { incomingRelations: IncomingRelation[] };

export interface EntityMention {
  id: string;
  sourceId: string;
  sourceTitle: string;
  position: number;
  length: number;
  text: string;
}

export interface EntityCreateInput {
  type: EntityType;
  name: string;
  aliases?: string[];
  fields?: Record<string, unknown>;
  relations?: RelationMap;
}

export interface EntityPatch {
  name?: string;
  aliases?: string[];
  fields?: Record<string, unknown>;
  relations?: RelationMap;
}

export interface EntityListParams {
  type?: EntityType;
  q?: string;
  limit?: number;
  cursor?: string;
}

export const entitiesApi = {
  schemas: () => api.get<EntityTypeSchema[]>('/entities/schemas'),
  schema: (type: EntityType) => api.get<EntityTypeSchema>(`/entities/schemas/${type}`),
  putSchema: (
    type: EntityType,
    body: { fields?: EntityFieldDef[]; relations?: EntityRelationDef[] },
  ) => api.put<EntityTypeSchema>(`/entities/schemas/${type}`, body),
  list: (params: EntityListParams = {}) => api.getPaged<Entity>(`/entities${qs({ ...params })}`),
  get: (id: string) => api.get<EntityDetail>(`/entities/${id}`),
  create: (input: EntityCreateInput) => api.post<Entity>('/entities', input),
  patch: (id: string, patch: EntityPatch) => api.patch<Entity>(`/entities/${id}`, patch),
  remove: (id: string) => api.delete<{ id: string; deleted: boolean }>(`/entities/${id}`),
  /** Create-or-fetch the freeform markdown backing note (F603). */
  ensureNote: (id: string) =>
    api.post<{ entity: Entity; note: Note; created: boolean }>(`/entities/${id}/note`),
  mentions: (id: string) => api.get<EntityMention[]>(`/entities/${id}/mentions`),
};

/* ===== Codex (player, F614/F615/F617) ===== */

export interface CodexEntry {
  entryId: string;
  entityId: string;
  type: EntityType;
  name: string;
  noteId: string | null;
  metAt: string;
  encounters: number;
  revealedFields: Record<string, unknown>;
}

export interface CodexData {
  storyId: string;
  playthroughId: string;
  entries: CodexEntry[];
}

export const codexApi = {
  get: (storyId: string, playthroughId: string) =>
    api.get<CodexData>(`/stories/${storyId}/codex${qs({ playthroughId })}`),
};

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

/* ===== Search (F711–F720, F742, F746) ===== */

export interface SearchHighlight {
  start: number;
  end: number;
}

/** Score breakdown from explain=true or scoreComponents in response (F746). */
export interface ScoreComponents {
  fts?: number;
  vector?: number;
  recency?: number;
  links?: number;
  [key: string]: number | undefined;
}

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  highlights: SearchHighlight[];
  score: number;
  scoreComponents?: ScoreComponents;
}

export interface SearchGroup {
  type: string;
  total: number;
  results: SearchResult[];
}

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface SearchData {
  mode: SearchMode;
  query: string;
  degraded?: boolean;
  groups: SearchGroup[];
}

export interface SearchResponse {
  data: SearchData;
  page: Page;
}

export interface SearchParams {
  q: string;
  types?: string;
  mode?: SearchMode;
  limit?: number;
  cursor?: string;
  explain?: boolean;
}

async function requestSearch(params: SearchParams): Promise<SearchResponse> {
  const res = await fetch(`/api/v1/search${qs({ ...params })}`, {
    headers: { 'content-type': 'application/json' },
  });
  const body = (await res.json()) as { data?: SearchData; page?: Page; error?: ApiError };
  if (!res.ok || body.error) {
    throw new ApiRequestError(
      res.status,
      body.error ?? { code: 'INTERNAL', message: 'unknown error', details: null },
    );
  }
  return {
    data: body.data ?? { mode: 'keyword', query: params.q, groups: [] },
    page: body.page ?? { nextCursor: null, limit: 0 },
  };
}

export const searchApi = {
  search: (params: SearchParams) => requestSearch(params),
};

/* ===== Semantic related notes (F751/F754) ===== */

export interface SemanticRelatedResult {
  id: string;
  title: string;
  score: number;
  snippet: string;
  sourceType: string;
}

export interface SemanticRelatedData {
  noteId: string;
  degraded: boolean;
  results: SemanticRelatedResult[];
}

export const relatedApi = {
  semantic: (noteId: string, limit = 8) =>
    api.get<SemanticRelatedData>(`/notes/${noteId}/related/semantic${qs({ limit })}`),
};

/* ===== Embeddings status + backfill (F742/embeddings indicator) ===== */

export interface EmbeddingsProvider {
  id: string;
  dim: number;
  available: boolean;
}

export interface EmbeddingsCoverage {
  coveragePct: number;
  [key: string]: unknown;
}

export interface EmbeddingsQueue {
  queueDepth: number;
  [key: string]: unknown;
}

export interface EmbeddingsStatus {
  provider: EmbeddingsProvider;
  coverage: EmbeddingsCoverage;
  queue: EmbeddingsQueue;
}

export const embeddingsApi = {
  status: () => api.get<EmbeddingsStatus>('/embeddings/status'),
  backfill: () =>
    request<{ message: string; provider: string }>('/embeddings/backfill', { method: 'POST' }),
};

/* ===== Ingest (F761–F770) ===== */

export type IngestSourceType = 'pdf' | 'epub' | 'html' | 'url';
export type IngestJobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface IngestJob {
  id: string;
  sourceType: IngestSourceType;
  status: IngestJobStatus;
  progress: number; // 0–100
  error: string | null;
  noteId: string | null;
  createdAt: string;
}

export const ingestApi = {
  /** POST multipart file OR JSON {url}; returns {jobId} */
  submitFile: async (file: File): Promise<{ jobId: string }> => {
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch('/api/v1/ingest', { method: 'POST', body: form });
    return parse<{ jobId: string }>(res);
  },
  submitUrl: (url: string): Promise<{ jobId: string }> =>
    request<{ jobId: string }>('/ingest', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  listJobs: (): Promise<IngestJob[]> => api.get<IngestJob[]>('/ingest/jobs'),
  getJob: (id: string): Promise<IngestJob> => api.get<IngestJob>(`/ingest/jobs/${id}`),
};

/* ===== Clip (F771–F773) ===== */

export interface ClipResult {
  note: Note;
  duplicate?: boolean;
}

export const clipApi = {
  clip: (url: string, selection?: string): Promise<ClipResult> =>
    api.post<ClipResult>('/clip', { url, ...(selection !== undefined ? { selection } : {}) }),
};

/* ===== Transcribe (F781–F786) ===== */

export type TranscribeJobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface TranscriptSegment {
  start: number; // seconds
  end: number;
  text: string;
}

export interface TranscribeJob {
  id: string;
  status: TranscribeJobStatus;
  transcriptNoteId: string | null;
  available: boolean;
  error: string | null;
}

export const transcribeApi = {
  submit: async (audio: Blob, filename = 'recording.webm'): Promise<{ jobId: string }> => {
    const form = new FormData();
    form.append('audio', audio, filename);
    const res = await fetch('/api/v1/transcribe', { method: 'POST', body: form });
    return parse<{ jobId: string }>(res);
  },
  getJob: (id: string): Promise<TranscribeJob> => api.get<TranscribeJob>(`/transcribe/jobs/${id}`),
};

/* ===== Insights (F791–F800) ===== */

export interface InsightsOverview {
  notes: number;
  notebooks: number;
  entities: number;
  stories: number;
  links: number;
  orphans: number;
  wordsTotal: number;
}

export interface GrowthDay {
  date: string;
  notes: number;
  links: number;
  words: number;
}

export interface HeatmapDay {
  date: string;
  count: number;
}

export interface InsightsStreaks {
  currentStreak: number;
  longestStreak: number;
  heatmap: HeatmapDay[];
}

export interface StaleNote {
  id: string;
  title: string;
  updatedAt: string;
  daysSinceUpdate: number;
}

export interface SuggestedLink {
  id: string;
  sourceId: string;
  sourceTitle: string;
  targetId: string;
  targetTitle: string;
  score: number;
}

export interface ReadingNote {
  id: string;
  title: string;
  wordCount: number;
  readingMinutes: number;
}

export interface DeadEndNote {
  id: string;
  title: string;
  updatedAt: string;
}

export interface HealthCheckItem {
  id: string;
  label: string;
  ok: boolean;
}

export interface VaultHealth {
  score: number;
  checklist: HealthCheckItem[];
}

export const insightsApi = {
  overview: () => api.get<InsightsOverview>('/insights/overview'),
  growth: (from: string, to: string) => api.get<GrowthDay[]>(`/insights/growth${qs({ from, to })}`),
  streaks: () => api.get<InsightsStreaks>('/insights/streaks'),
  stale: (limit = 20) => api.get<StaleNote[]>(`/insights/stale${qs({ limit })}`),
  suggestedLinks: (limit = 20) =>
    api.get<SuggestedLink[]>(`/insights/suggested-links${qs({ limit })}`),
  reading: () => api.get<ReadingNote[]>('/insights/reading'),
  deadEnds: () => api.get<DeadEndNote[]>('/insights/dead-ends'),
  health: () => api.get<VaultHealth>('/insights/health'),
  digest: () => api.post<Note>('/insights/digest'),
};

/* ===== Shares (F1144 Share management UI, F1147 Shared-with-me) ===== */

export type ShareAccessLevel = 'view' | 'comment' | 'edit';

export interface Share {
  id: string;
  /** The id of the shared document (note). */
  docId: string;
  docTitle: string;
  accessLevel: ShareAccessLevel;
  expiresAt: string | null;
  createdAt: string;
}

export interface ShareAuditEntry {
  id: string;
  shareId: string;
  accessedAt: string;
  /** May be absent for anonymous accesses */
  deviceId?: string;
}

export interface SharedWithMeItem {
  shareId: string;
  docId: string;
  docTitle: string;
  accessLevel: ShareAccessLevel;
  sharedAt: string;
  expiresAt: string | null;
}

export const sharesApi = {
  /** List all shares created by this device. */
  list: () => api.get<Share[]>('/shares'),
  /** Revoke a share by id. */
  revoke: (id: string) => api.delete<{ id: string; revoked: boolean }>(`/shares/${id}`),
  /** Fetch the access log for a share. */
  audit: (id: string) => api.get<ShareAuditEntry[]>(`/shares/${id}/audit`),
  /** List items shared with this device (incoming shares). */
  sharedWithMe: () => api.get<SharedWithMeItem[]>('/shared-with-me'),
};
