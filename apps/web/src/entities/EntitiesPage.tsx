/**
 * Entity editor (Day 7, F603/F604/F607).
 *
 * One page serving two routes:
 *   /entities             → typed gallery with a type switcher, search, cards,
 *                           empty states, and a "New <type>" create flow (F607,
 *                           F604).
 *   /entities/:entityId   → schema-driven field editor, alias management,
 *                           relation pickers, a freeform markdown body backed by
 *                           a note, incoming relations (read-only), and a delete
 *                           button that warns when notes mention the entity
 *                           (F603).
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Compass,
  Dialog,
  Flag,
  Input,
  MapPin,
  Package,
  Plus,
  Save,
  Search,
  Shapes,
  Textarea,
  Trash2,
  Users,
  X,
  useToast,
} from '@fables/ui';
import type { ComponentType } from 'react';
import {
  entitiesApi,
  notesApi,
  type Entity,
  type EntityCreateInput,
  type EntityDetail,
  type EntityFieldDef,
  type EntityRelationDef,
  type EntityType,
  type EntityTypeSchema,
  type Note,
  type RelationMap,
} from '../api/client.js';
import { Skeleton } from '../components/Skeleton.js';
import { MarkdownPreview } from '../preview/MarkdownPreview.js';
import { defaultsFor, fieldSummary, formatFieldValue, parseFieldInput } from './fieldEditors.js';
import './entities.css';

const ENTITY_TYPES: EntityType[] = ['character', 'place', 'item', 'faction', 'custom'];

const TYPE_ICON: Record<EntityType, ComponentType<{ size?: number; className?: string }>> = {
  character: Users,
  place: MapPin,
  item: Package,
  faction: Flag,
  custom: Compass,
};

const TYPE_LABEL: Record<EntityType, string> = {
  character: 'Character',
  place: 'Place',
  item: 'Item',
  faction: 'Faction',
  custom: 'Custom',
};

function TypeIcon({ type, size = 16 }: { type: EntityType; size?: number }) {
  const Icon = TYPE_ICON[type];
  return <Icon size={size} className="entity-card-icon" />;
}

/* ===== Gallery (F607) ===== */

function EntityCard({
  entity,
  schema,
  onOpen,
}: {
  entity: Entity;
  schema: EntityTypeSchema | undefined;
  onOpen: () => void;
}) {
  const summary = fieldSummary(entity.fields, schema?.fields ?? []);
  return (
    <button className="entity-card" onClick={onOpen}>
      <div className="entity-card-head">
        <TypeIcon type={entity.type} />
        <h3>{entity.name}</h3>
      </div>
      {entity.aliases.length > 0 ? (
        <span className="entity-card-aliases">
          {entity.aliases.length} alias{entity.aliases.length === 1 ? '' : 'es'}
        </span>
      ) : null}
      {summary !== '' ? <span className="entity-card-fields">{summary}</span> : null}
    </button>
  );
}

function CreateDialog({
  type,
  open,
  onClose,
  onCreated,
}: {
  type: EntityType;
  open: boolean;
  onClose: () => void;
  onCreated: (entity: Entity) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [fields, setFields] = useState<Record<string, unknown>>({});

  const schemaQuery = useQuery({
    queryKey: ['entity-schema', type],
    queryFn: () => entitiesApi.schema(type),
    enabled: open,
  });

  // Reseed the form from schema defaults each time the dialog opens (F604).
  const schema = schemaQuery.data;
  useEffect(() => {
    if (open && schema !== undefined) {
      setName('');
      setFields(defaultsFor(schema));
    }
  }, [open, schema]);

  const createMutation = useMutation({
    mutationFn: (input: EntityCreateInput) => entitiesApi.create(input),
    onSuccess: (entity) => {
      void queryClient.invalidateQueries({ queryKey: ['entities'] });
      onCreated(entity);
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'create failed', 'error'),
  });

  const submit = () => {
    if (name.trim() === '') return;
    createMutation.mutate({ type, name: name.trim(), fields });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 320 }}
      >
        <h3 style={{ margin: 0 }}>New {TYPE_LABEL[type].toLowerCase()}</h3>
        {schemaQuery.isLoading ? <Skeleton height={120} /> : null}
        {schemaQuery.isError ? (
          <p style={{ color: 'var(--text-dim)' }}>Could not load the type schema.</p>
        ) : null}
        {schema !== undefined ? (
          <>
            <Input
              autoFocus
              placeholder="Name"
              aria-label="Entity name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {schema.fields.map((def) => (
              <FieldControl
                key={def.name}
                def={def}
                value={fields[def.name]}
                onChange={(value) => setFields((prev) => ({ ...prev, [def.name]: value }))}
              />
            ))}
          </>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={createMutation.isPending || schema === undefined}
          >
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Gallery() {
  const navigate = useNavigate();
  const [type, setType] = useState<EntityType>('character');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ['entities', type, query],
    queryFn: () => entitiesApi.list({ type, ...(query !== '' ? { q: query } : {}) }),
  });
  const schemaQuery = useQuery({
    queryKey: ['entity-schema', type],
    queryFn: () => entitiesApi.schema(type),
  });

  const entities = listQuery.data?.data ?? [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ flex: 1, minWidth: 160, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shapes size={20} /> Entities
        </h1>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> New {TYPE_LABEL[type].toLowerCase()}
        </Button>
      </div>

      <div className="entity-controls">
        <div className="entity-typeswitch" role="tablist" aria-label="Entity type">
          {ENTITY_TYPES.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === type}
              className={t === type ? 'active' : ''}
              onClick={() => setType(t)}
            >
              <TypeIcon type={t} size={14} /> {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="entity-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder={`Search ${TYPE_LABEL[type].toLowerCase()}s…`}
            aria-label="Search entities"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {listQuery.isLoading ? <Skeleton height={160} /> : null}
      {listQuery.isError ? (
        <p className="entity-empty">Could not load entities — check that the server is running.</p>
      ) : null}

      {listQuery.data !== undefined ? (
        entities.length === 0 ? (
          <p className="entity-empty">
            {query !== ''
              ? 'Nothing matches that search.'
              : `No ${TYPE_LABEL[type].toLowerCase()}s yet. Create one to start your world bible.`}
          </p>
        ) : (
          <div className="entity-grid">
            {entities.map((entity) => (
              <EntityCard
                key={entity.id}
                entity={entity}
                schema={schemaQuery.data}
                onOpen={() => navigate(`/entities/${entity.id}`)}
              />
            ))}
          </div>
        )
      ) : null}

      <CreateDialog
        type={type}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(entity) => {
          setCreateOpen(false);
          navigate(`/entities/${entity.id}`);
        }}
      />
    </div>
  );
}

/* ===== Field control (shared by create + detail, F603/F604) ===== */

function FieldControl({
  def,
  value,
  onChange,
}: {
  def: EntityFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = (
    <label htmlFor={`field-${def.name}`}>
      {def.name}
      {def.required === true ? <span className="req">*</span> : null}
    </label>
  );

  if (def.fieldType === 'bool') {
    return (
      <div className="entity-fieldrow">
        {label}
        <input
          id={`field-${def.name}`}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(parseFieldInput('bool', e.target.checked))}
        />
      </div>
    );
  }

  if (def.fieldType === 'list') {
    return (
      <div className="entity-fieldrow">
        {label}
        <Textarea
          id={`field-${def.name}`}
          rows={2}
          placeholder="One per line or comma-separated"
          value={formatListEditorValue(value)}
          onChange={(e) => onChange(parseFieldInput('list', e.target.value))}
        />
      </div>
    );
  }

  return (
    <div className="entity-fieldrow">
      {label}
      <Input
        id={`field-${def.name}`}
        type={def.fieldType === 'number' ? 'number' : 'text'}
        value={formatFieldValue(value)}
        onChange={(e) => onChange(parseFieldInput(def.fieldType, e.target.value))}
      />
    </div>
  );
}

/** List values edit best as newline-joined text in the textarea. */
function formatListEditorValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((x) => String(x)).join('\n');
  return value === null || value === undefined ? '' : String(value);
}

/* ===== Detail editor (F603) ===== */

function EntityDetailView({ entityId }: { entityId: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['entity', entityId],
    queryFn: () => entitiesApi.get(entityId),
  });
  const detail = detailQuery.data;
  const schemaQuery = useQuery({
    queryKey: ['entity-schema', detail?.type],
    queryFn: () => entitiesApi.schema(detail?.type as EntityType),
    enabled: detail !== undefined,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['entity', entityId] });
    void queryClient.invalidateQueries({ queryKey: ['entities'] });
  };

  const patchMutation = useMutation({
    mutationFn: (patch: Parameters<typeof entitiesApi.patch>[1]) =>
      entitiesApi.patch(entityId, patch),
    onSuccess: () => {
      invalidate();
      toast('Saved');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'save failed', 'error'),
  });

  if (detailQuery.isLoading) return <Skeleton height={320} />;
  if (detailQuery.isError || detail === undefined) {
    return (
      <div>
        <Button onClick={() => navigate('/entities')}>← Back</Button>
        <p className="entity-empty">Could not load this entity.</p>
      </div>
    );
  }

  return (
    <EntityDetailBody
      detail={detail}
      schema={schemaQuery.data}
      saving={patchMutation.isPending}
      onSave={(patch) => patchMutation.mutate(patch)}
      onDeleted={() => navigate('/entities')}
      onBack={() => navigate('/entities')}
    />
  );
}

function EntityDetailBody({
  detail,
  schema,
  saving,
  onSave,
  onDeleted,
  onBack,
}: {
  detail: EntityDetail;
  schema: EntityTypeSchema | undefined;
  saving: boolean;
  onSave: (patch: Parameters<typeof entitiesApi.patch>[1]) => void;
  onDeleted: () => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Local working copy of the editable parts; re-seeded when the entity changes.
  const [name, setName] = useState(detail.name);
  const [fields, setFields] = useState<Record<string, unknown>>(detail.fields);
  const [aliases, setAliases] = useState<string[]>(detail.aliases);
  const [relations, setRelations] = useState<RelationMap>(detail.relations);
  const [newAlias, setNewAlias] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setName(detail.name);
    setFields(detail.fields);
    setAliases(detail.aliases);
    setRelations(detail.relations);
  }, [detail]);

  const saveFields = () => onSave({ name: name.trim() || detail.name, fields });
  const saveAliases = (next: string[]) => {
    setAliases(next);
    onSave({ aliases: next });
  };
  const saveRelations = (next: RelationMap) => {
    setRelations(next);
    onSave({ relations: next });
  };

  const addAlias = () => {
    const value = newAlias.trim();
    if (value === '' || aliases.includes(value)) {
      setNewAlias('');
      return;
    }
    saveAliases([...aliases, value]);
    setNewAlias('');
  };

  return (
    <div className="entity-detail">
      <div className="entity-detail-head">
        <Button onClick={onBack}>← Back</Button>
        <h1>{detail.name}</h1>
        <span className="entity-detail-type">
          <TypeIcon type={detail.type} size={14} /> {TYPE_LABEL[detail.type]}
        </span>
        <Button variant="danger" onClick={() => setDeleteOpen(true)}>
          <Trash2 size={14} /> Delete
        </Button>
      </div>

      {/* ── Name + schema fields (F603) ─────────────────────────────────── */}
      <section className="entity-section">
        <h2>Details</h2>
        <div className="entity-fieldrow">
          <label htmlFor="entity-name">name</label>
          <Input
            id="entity-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Entity name"
          />
        </div>
        {(schema?.fields ?? []).map((def) => (
          <FieldControl
            key={def.name}
            def={def}
            value={fields[def.name]}
            onChange={(value) => setFields((prev) => ({ ...prev, [def.name]: value }))}
          />
        ))}
        <Button variant="primary" onClick={saveFields} disabled={saving}>
          <Save size={14} /> Save fields
        </Button>
      </section>

      {/* ── Aliases (F603) ──────────────────────────────────────────────── */}
      <section className="entity-section">
        <h2>Aliases</h2>
        <div className="entity-aliases">
          {aliases.length === 0 ? (
            <span style={{ color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>No aliases</span>
          ) : null}
          {aliases.map((alias) => (
            <span key={alias} className="entity-alias-chip">
              {alias}
              <button
                type="button"
                aria-label={`Remove alias ${alias}`}
                onClick={() => saveAliases(aliases.filter((a) => a !== alias))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="entity-inline-add">
          <Input
            placeholder="Add an alias"
            aria-label="New alias"
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAlias();
              }
            }}
          />
          <Button onClick={addAlias} disabled={newAlias.trim() === ''}>
            <Plus size={14} /> Add
          </Button>
        </div>
      </section>

      {/* ── Relations (F603) ────────────────────────────────────────────── */}
      {(schema?.relations ?? []).length > 0 ? (
        <section className="entity-section">
          <h2>Relations</h2>
          {(schema?.relations ?? []).map((def) => (
            <RelationEditor
              key={def.name}
              def={def}
              targetIds={relations[def.name] ?? []}
              onChange={(ids) => saveRelations({ ...relations, [def.name]: ids })}
            />
          ))}
        </section>
      ) : null}

      {/* ── Incoming relations, read-only (F603) ────────────────────────── */}
      {detail.incomingRelations.length > 0 ? (
        <section className="entity-section">
          <h2>Referenced by</h2>
          <div className="entity-incoming">
            {detail.incomingRelations.map((rel) => (
              <span key={`${rel.sourceId}-${rel.name}`}>
                <strong>{rel.sourceName}</strong> · {rel.name}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Markdown body via backing note (F603) ───────────────────────── */}
      <section className="entity-section">
        <h2>Description</h2>
        <BodyEditor entityId={detail.id} noteId={detail.noteId} />
      </section>

      <DeleteDialog
        open={deleteOpen}
        entityId={detail.id}
        entityName={detail.name}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          void queryClient.invalidateQueries({ queryKey: ['entities'] });
          toast('Entity deleted');
          onDeleted();
        }}
      />
    </div>
  );
}

/* ===== Relation picker (F603) ===== */

function RelationEditor({
  def,
  targetIds,
  onChange,
}: {
  def: EntityRelationDef;
  targetIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');

  // Resolve current target ids to names for the chips.
  const targetsQuery = useQuery({
    queryKey: ['entities-all', def.targetType],
    queryFn: () =>
      entitiesApi.list({ ...(def.targetType !== null ? { type: def.targetType } : {}), limit: 200 }),
  });
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of targetsQuery.data?.data ?? []) map.set(e.id, e.name);
    return map;
  }, [targetsQuery.data]);

  const searchQuery = useQuery({
    queryKey: ['entity-picker', def.targetType, query],
    queryFn: () =>
      entitiesApi.list({
        ...(def.targetType !== null ? { type: def.targetType } : {}),
        ...(query !== '' ? { q: query } : {}),
        limit: 8,
      }),
    enabled: query.trim() !== '',
  });

  const add = (id: string) => {
    if (!targetIds.includes(id)) onChange([...targetIds, id]);
    setQuery('');
  };

  return (
    <div className="entity-relation">
      <div className="entity-relation-name">
        {def.name}
        {def.targetType !== null ? (
          <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> → {def.targetType}</span>
        ) : null}
      </div>
      <div className="entity-relation-targets">
        {targetIds.length === 0 ? (
          <span style={{ color: 'var(--text-dim)', fontSize: 'var(--text-sm)' }}>None</span>
        ) : null}
        {targetIds.map((id) => (
          <span key={id} className="entity-alias-chip">
            {nameById.get(id) ?? id}
            <button
              type="button"
              aria-label={`Remove ${nameById.get(id) ?? id}`}
              onClick={() => onChange(targetIds.filter((t) => t !== id))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="entity-picker">
        <Input
          placeholder="Search entities to link…"
          aria-label={`Add ${def.name} target`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() !== '' && (searchQuery.data?.data ?? []).length > 0 ? (
          <div className="entity-picker-results">
            {(searchQuery.data?.data ?? [])
              .filter((e) => !targetIds.includes(e.id))
              .map((e) => (
                <button key={e.id} type="button" onClick={() => add(e.id)}>
                  {e.name}
                </button>
              ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ===== Markdown body via backing note (F603) ===== */

function BodyEditor({ entityId, noteId }: { entityId: string; noteId: string | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [rev, setRev] = useState<number | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(noteId);

  useEffect(() => {
    setActiveNoteId(noteId);
  }, [noteId]);

  const noteQuery = useQuery({
    queryKey: ['entity-note', activeNoteId],
    queryFn: () => notesApi.get(activeNoteId as string),
    enabled: activeNoteId !== null,
  });
  const note = noteQuery.data;
  useEffect(() => {
    if (note !== undefined) {
      setBody(note.body);
      setRev(note.rev);
    }
  }, [note]);

  const ensureMutation = useMutation({
    mutationFn: () => entitiesApi.ensureNote(entityId),
    onSuccess: (result) => {
      setActiveNoteId(result.note.id);
      setBody(result.note.body);
      setRev(result.note.rev);
      void queryClient.invalidateQueries({ queryKey: ['entity', entityId] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'failed', 'error'),
  });

  const saveMutation = useMutation({
    mutationFn: (input: { id: string; rev: number; body: string }): Promise<Note> =>
      notesApi.patch(input.id, { rev: input.rev, body: input.body }),
    onSuccess: (updated) => {
      setRev(updated.rev);
      toast('Description saved');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'save failed', 'error'),
  });

  if (activeNoteId === null) {
    return (
      <Button onClick={() => ensureMutation.mutate()} disabled={ensureMutation.isPending}>
        <Plus size={14} /> Add description
      </Button>
    );
  }

  if (noteQuery.isLoading) return <Skeleton height={120} />;

  return (
    <div>
      <div className="entity-body-editor">
        <Textarea
          aria-label="Description (markdown)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Describe this entity in markdown…"
        />
        <div className="entity-body-preview">
          <MarkdownPreview source={body} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Button
          variant="primary"
          disabled={rev === null || saveMutation.isPending}
          onClick={() => {
            if (activeNoteId !== null && rev !== null) {
              saveMutation.mutate({ id: activeNoteId, rev, body });
            }
          }}
        >
          <Save size={14} /> Save description
        </Button>
        <span className="entity-save-hint">Markdown · backed by a note</span>
      </div>
    </div>
  );
}

/* ===== Delete with mention warning (F603) ===== */

function DeleteDialog({
  open,
  entityId,
  entityName,
  onClose,
  onDeleted,
}: {
  open: boolean;
  entityId: string;
  entityName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();

  // Fetch mentions only while the dialog is open so the warning is current.
  const mentionsQuery = useQuery({
    queryKey: ['entity-mentions', entityId],
    queryFn: () => entitiesApi.mentions(entityId),
    enabled: open,
  });
  const mentionCount = mentionsQuery.data?.length ?? 0;

  const removeMutation = useMutation({
    mutationFn: () => entitiesApi.remove(entityId),
    onSuccess: onDeleted,
    onError: (e) => toast(e instanceof Error ? e.message : 'delete failed', 'error'),
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 300 }}>
        <h3 style={{ margin: 0 }}>Delete {entityName}?</h3>
        {mentionsQuery.isLoading ? (
          <p style={{ color: 'var(--text-dim)' }}>Checking for mentions…</p>
        ) : mentionCount > 0 ? (
          <p style={{ color: 'var(--danger)' }}>
            {mentionCount} note{mentionCount === 1 ? '' : 's'} mention this entity. Deleting it will
            leave those mentions unresolved.
          </p>
        ) : (
          <p style={{ color: 'var(--text-dim)' }}>This cannot be undone.</p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={removeMutation.isPending}
            onClick={() => removeMutation.mutate()}
          >
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ===== Route entry ===== */

export function EntitiesPage() {
  const { entityId } = useParams<{ entityId: string }>();
  return entityId !== undefined ? <EntityDetailView entityId={entityId} /> : <Gallery />;
}
