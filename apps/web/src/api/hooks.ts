/**
 * TanStack Query hooks over the typed client (F141, F151, F161, F171).
 * Query keys are centralized so mutations can invalidate precisely.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attachmentsApi,
  graphApi,
  importApi,
  linksApi,
  notebooksApi,
  notesApi,
  queryApi,
  revisionsApi,
  savedQueriesApi,
  tagsApi,
  trashApi,
  type GraphFilterParams,
  type ListNotesParams,
  type Note,
  type NotePatch,
  type NoteSort,
} from './client.js';

export const queryKeys = {
  notes: (notebookId?: string, sort?: NoteSort) =>
    ['notes', notebookId ?? 'all', sort ?? 'updated'] as const,
  allNotes: ['notes'] as const,
  note: (id: string) => ['note', id] as const,
  notebookTree: (includeArchived: boolean) => ['notebooks', 'tree', includeArchived] as const,
  notebooks: ['notebooks'] as const,
  tags: ['tags'] as const,
  revisions: (noteId: string) => ['revisions', noteId] as const,
  diff: (noteId: string, rev: number, against: number) => ['diff', noteId, rev, against] as const,
  attachments: ['attachments'] as const,
  trash: ['trash'] as const,
  backlinks: (noteId: string) => ['backlinks', noteId] as const,
  mentions: (noteId: string) => ['mentions', noteId] as const,
  allLinks: ['backlinks'] as const,
  allMentions: ['mentions'] as const,
  graph: (filter: GraphFilterParams) => ['graph', 'full', filter] as const,
  localGraph: (noteId: string, hops: number, filter: GraphFilterParams) =>
    ['graph', 'local', noteId, hops, filter] as const,
  allGraphs: ['graph'] as const,
  fqlQuery: (q: string) => ['fql', 'query', q] as const,
  fqlEmbed: (q: string, limit: number) => ['fql', 'embed', q, limit] as const,
  allFql: ['fql'] as const,
  savedQueries: ['saved-queries'] as const,
  importJob: (id: string) => ['import-job', id] as const,
};

/** Everything note-related that a write may touch. */
export function useInvalidateNotes() {
  const qc = useQueryClient();
  return (noteId?: string) => {
    void qc.invalidateQueries({ queryKey: queryKeys.allNotes });
    void qc.invalidateQueries({ queryKey: queryKeys.notebooks });
    void qc.invalidateQueries({ queryKey: queryKeys.tags });
    void qc.invalidateQueries({ queryKey: queryKeys.trash });
    void qc.invalidateQueries({ queryKey: queryKeys.allLinks });
    void qc.invalidateQueries({ queryKey: queryKeys.allMentions });
    void qc.invalidateQueries({ queryKey: queryKeys.allGraphs });
    void qc.invalidateQueries({ queryKey: queryKeys.allFql });
    if (noteId !== undefined) {
      void qc.invalidateQueries({ queryKey: queryKeys.note(noteId) });
      void qc.invalidateQueries({ queryKey: queryKeys.revisions(noteId) });
    }
  };
}

/* ===== Queries ===== */

const PAGE_SIZE = 100;

export function useNotesInfinite(params: { notebookId?: string; sort?: NoteSort }) {
  return useInfiniteQuery({
    queryKey: queryKeys.notes(params.notebookId, params.sort),
    queryFn: ({ pageParam }) => {
      const listParams: ListNotesParams = { limit: PAGE_SIZE };
      if (params.notebookId !== undefined) listParams.notebookId = params.notebookId;
      if (params.sort !== undefined) listParams.sort = params.sort;
      if (pageParam !== '') listParams.cursor = pageParam;
      return notesApi.list(listParams);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });
}

export function useNote(id: string | null) {
  return useQuery({
    queryKey: queryKeys.note(id ?? 'none'),
    queryFn: () => notesApi.get(id as string),
    enabled: id !== null,
  });
}

export function useNotebookTree(includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.notebookTree(includeArchived),
    queryFn: () => notebooksApi.tree(includeArchived),
  });
}

export function useTags() {
  return useQuery({ queryKey: queryKeys.tags, queryFn: tagsApi.list });
}

export function useRevisions(noteId: string | null) {
  return useQuery({
    queryKey: queryKeys.revisions(noteId ?? 'none'),
    queryFn: () => revisionsApi.list(noteId as string),
    enabled: noteId !== null,
  });
}

export function useRevisionDiff(noteId: string, rev: number | null, against: number | null) {
  return useQuery({
    queryKey: queryKeys.diff(noteId, rev ?? -1, against ?? -1),
    queryFn: () => revisionsApi.diff(noteId, rev as number, against as number),
    enabled: rev !== null && against !== null && rev !== against,
  });
}

export function useAttachments() {
  return useQuery({
    queryKey: queryKeys.attachments,
    queryFn: () => attachmentsApi.list({ limit: 200 }),
  });
}

export function useTrash() {
  return useQuery({ queryKey: queryKeys.trash, queryFn: () => trashApi.list({ limit: 200 }) });
}

/** Walks the keyset cursor to collect every note (capped at `maxPages`). */
export async function fetchAllNotes(notebookId?: string, maxPages = 20): Promise<Note[]> {
  const all: Note[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await notesApi.list({
      limit: 200,
      ...(notebookId !== undefined ? { notebookId } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    all.push(...page.data);
    if (page.page.nextCursor === null) break;
    cursor = page.page.nextCursor;
  }
  return all;
}

/**
 * Full note index for wikilink autocomplete + title resolution (F203/F204).
 * Key starts with 'notes' so note writes invalidate it automatically.
 */
export function useNoteIndex(enabled = true) {
  return useQuery({
    queryKey: ['notes', 'title-index'],
    queryFn: () => fetchAllNotes(),
    enabled,
    staleTime: 15_000,
  });
}

export function useBacklinks(noteId: string | null) {
  return useQuery({
    queryKey: queryKeys.backlinks(noteId ?? 'none'),
    queryFn: () => linksApi.backlinks(noteId as string),
    enabled: noteId !== null,
  });
}

export function useMentions(noteId: string | null) {
  return useQuery({
    queryKey: queryKeys.mentions(noteId ?? 'none'),
    queryFn: () => linksApi.mentions(noteId as string),
    enabled: noteId !== null,
  });
}

export function useGraph(filter: GraphFilterParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.graph(filter),
    queryFn: () => graphApi.full(filter),
    enabled,
  });
}

export function useLocalGraph(noteId: string | null, hops: number, filter: GraphFilterParams = {}) {
  return useQuery({
    queryKey: queryKeys.localGraph(noteId ?? 'none', hops, filter),
    queryFn: () => graphApi.local(noteId as string, hops, filter),
    enabled: noteId !== null,
  });
}

/* ===== Mutations ===== */

export function useCreateNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (input: { notebookId: string; title?: string; body?: string }) =>
      notesApi.create(input),
    onSuccess: () => invalidate(),
  });
}

export function usePatchNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NotePatch }) => notesApi.patch(id, patch),
    onSuccess: (note) => invalidate(note.id),
  });
}

export function useDeleteNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (id: string) => notesApi.remove(id),
    onSuccess: (note) => invalidate(note.id),
  });
}

export function useRestoreNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (id: string) => notesApi.restore(id),
    onSuccess: (note) => invalidate(note.id),
  });
}

export function useDuplicateNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (id: string) => notesApi.duplicate(id),
    onSuccess: () => invalidate(),
  });
}

export function useBulkNotes() {
  const invalidate = useInvalidateNotes();
  return useMutation({ mutationFn: notesApi.bulk, onSuccess: () => invalidate() });
}

export function useCreateNotebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notebooksApi.create,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.notebooks }),
  });
}

export function usePatchNotebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof notebooksApi.patch>[1] }) =>
      notebooksApi.patch(id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.notebooks }),
  });
}

export function useDeleteNotebook() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({ id, moveNotesTo }: { id: string; moveNotesTo?: string }) =>
      notebooksApi.remove(id, moveNotesTo),
    onSuccess: () => invalidate(),
  });
}

export function usePatchTag() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof tagsApi.patch>[1] }) =>
      tagsApi.patch(id, patch),
    onSuccess: () => invalidate(),
  });
}

export function useMergeTags() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({ id, targetId }: { id: string; targetId: string }) => tagsApi.merge(id, targetId),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteTag() {
  const invalidate = useInvalidateNotes();
  return useMutation({ mutationFn: tagsApi.remove, onSuccess: () => invalidate() });
}

/** Convert one mention ({ mentionId }) or all ({ all: true }) into wikilinks (F223–F225). */
export function useConvertMentions(noteId: string) {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (input: { mentionId?: string; all?: boolean }) =>
      linksApi.convertMentions(noteId, input),
    onSuccess: () => invalidate(noteId),
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: attachmentsApi.remove,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.attachments }),
  });
}

/* ===== FQL + saved queries (F278–F290) ===== */

/** Runs an FQL query for the note-list pane (F278); paginates like notes. */
export function useFqlQuery(q: string | null) {
  return useInfiniteQuery({
    queryKey: queryKeys.fqlQuery(q ?? ''),
    queryFn: ({ pageParam }) =>
      queryApi.run(q as string, {
        limit: PAGE_SIZE,
        ...(pageParam !== '' ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
    enabled: q !== null && q.trim() !== '',
    retry: false,
  });
}

/**
 * Embed-block query (F283/F285): cached for a minute so a dashboard note full
 * of embeds doesn't hammer the server on every preview re-render; the embed's
 * refresh control calls `refetch`, and note writes invalidate ['fql'].
 */
export function useFqlEmbed(q: string, limit: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.fqlEmbed(q, limit),
    queryFn: () => queryApi.run(q, { limit }),
    staleTime: 60_000,
    enabled,
    retry: false,
  });
}

export function useSavedQueries() {
  return useQuery({ queryKey: queryKeys.savedQueries, queryFn: savedQueriesApi.list });
}

export function useCreateSavedQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: savedQueriesApi.create,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.savedQueries }),
  });
}

export function usePatchSavedQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Parameters<typeof savedQueriesApi.patch>[1];
    }) => savedQueriesApi.patch(id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.savedQueries }),
  });
}

export function useDeleteSavedQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: savedQueriesApi.remove,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.savedQueries }),
  });
}

/* ===== Import jobs (F297) ===== */

/** Polls an import job once a second while it's running. */
export function useImportJob(id: string | null) {
  return useQuery({
    queryKey: queryKeys.importJob(id ?? 'none'),
    queryFn: () => importApi.job(id as string),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1000 : false),
  });
}
