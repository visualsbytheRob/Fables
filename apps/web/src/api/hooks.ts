/**
 * TanStack Query hooks over the typed client (F141, F151, F161, F171).
 * Query keys are centralized so mutations can invalidate precisely.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attachmentsApi,
  notebooksApi,
  notesApi,
  revisionsApi,
  tagsApi,
  trashApi,
  type ListNotesParams,
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
};

/** Everything note-related that a write may touch. */
export function useInvalidateNotes() {
  const qc = useQueryClient();
  return (noteId?: string) => {
    void qc.invalidateQueries({ queryKey: queryKeys.allNotes });
    void qc.invalidateQueries({ queryKey: queryKeys.notebooks });
    void qc.invalidateQueries({ queryKey: queryKeys.tags });
    void qc.invalidateQueries({ queryKey: queryKeys.trash });
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

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: attachmentsApi.remove,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.attachments }),
  });
}
