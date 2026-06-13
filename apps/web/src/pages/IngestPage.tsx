/**
 * Document ingestion queue UI (F766, F769).
 *
 * Accepts PDF, EPUB, or HTML files via drag-drop or file picker, or a URL
 * input.  POSTs to /api/v1/ingest and polls GET /ingest/jobs for per-item
 * status / progress / errors.  Links to created notes when done.
 */
import { useCallback, useRef, useState } from 'react';
import {
  AlertTriangle,
  Button,
  CircleCheck,
  ExternalLink,
  FileInput,
  Input,
  Loader2,
  useToast,
} from '@fables/ui';
import { Link } from 'react-router-dom';
import { ingestApi, type IngestJob } from '../api/client.js';
import { useIngestJobs } from '../api/hooks.js';
import './ingest.css';

/** Detect source type from file extension (F769). */
function detectSourceType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'epub') return 'epub';
  if (ext === 'html' || ext === 'htm') return 'html';
  return 'unknown';
}

const ACCEPTED_EXTS = '.pdf,.epub,.html,.htm';

export function IngestPage() {
  const { toast } = useToast();
  const jobs = useIngestJobs();
  const [urlInput, setUrlInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submitFile = useCallback(
    (file: File) => {
      const detectedType = detectSourceType(file.name);
      if (detectedType === 'unknown') {
        toast(`Unsupported file type: ${file.name}`, 'error');
        return;
      }
      setSubmitting(true);
      ingestApi.submitFile(file).then(
        () => {
          toast(`Ingesting ${file.name}…`);
          setSubmitting(false);
          void jobs.refetch();
        },
        (err: Error) => {
          toast(`Failed to submit ${file.name}: ${err.message}`, 'error');
          setSubmitting(false);
        },
      );
    },
    [toast, jobs],
  );

  const submitUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    setSubmitting(true);
    ingestApi.submitUrl(url).then(
      () => {
        toast('URL queued for ingestion…');
        setUrlInput('');
        setSubmitting(false);
        void jobs.refetch();
      },
      (err: Error) => {
        toast(`Failed to submit URL: ${err.message}`, 'error');
        setSubmitting(false);
      },
    );
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) submitFile(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) submitFile(file);
    e.target.value = '';
  };

  return (
    <div className="ingest-page">
      <h1>
        <FileInput size={20} /> Document Ingestion
      </h1>

      {/* Drop zone */}
      <section
        className={`ingest-page__dropzone${dragOver ? ' ingest-page__dropzone--over' : ''}`}
        aria-label="Drop zone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
        }}
      >
        <FileInput size={32} className="ingest-page__dropzone-icon" />
        <p>Drop PDF, EPUB, or HTML files here, or click to pick</p>
        <p className="ingest-page__hint">Supports .pdf · .epub · .html</p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTS}
          multiple
          style={{ display: 'none' }}
          onChange={onFileChange}
          aria-label="Pick files"
        />
      </section>

      {/* URL input */}
      <section className="ingest-page__url ui-stack" aria-label="Ingest by URL">
        <h2>Or ingest a URL</h2>
        <div className="ui-row">
          <Input
            className="ingest-page__url-input"
            aria-label="URL to ingest"
            placeholder="https://…"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitUrl();
            }}
          />
          <Button variant="primary" disabled={urlInput.trim() === '' || submitting} onClick={submitUrl}>
            {submitting ? 'Submitting…' : 'Ingest URL'}
          </Button>
        </div>
      </section>

      {/* Job queue */}
      {((jobs.data?.length ?? 0) > 0 || jobs.isLoading) && (
        <section className="ingest-page__queue ui-stack" aria-label="Ingestion queue">
          <h2>Queue</h2>
          {jobs.isLoading ? (
            <p className="ingest-page__hint">Loading…</p>
          ) : (
            <ul className="ingest-page__job-list">
              {(jobs.data ?? []).map((job) => (
                <IngestJobRow key={job.id} job={job} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function IngestJobRow({ job }: { job: IngestJob }) {
  const isRunning = job.status === 'pending' || job.status === 'running';
  const isDone = job.status === 'done';
  const isFailed = job.status === 'failed';

  return (
    <li className="ingest-page__job" data-status={job.status}>
      <div className="ingest-page__job-header">
        <span className="ingest-page__job-type ui-badge">{job.sourceType}</span>
        {isRunning && <Loader2 size={14} className="ingest-page__spin" aria-label="Running" />}
        {isDone && <CircleCheck size={14} className="ingest-page__done" aria-label="Done" />}
        {isFailed && <AlertTriangle size={14} className="ingest-page__fail" aria-label="Failed" />}
        <span className="ingest-page__job-time">
          {new Date(job.createdAt).toLocaleTimeString()}
        </span>
      </div>

      {isRunning && job.progress > 0 && (
        <progress className="ingest-page__bar" max={100} value={job.progress} aria-label="Progress" />
      )}

      {isDone && job.noteId && (
        <Link to={`/notes/${job.noteId}`} className="ingest-page__note-link">
          <ExternalLink size={12} /> Open created note
        </Link>
      )}

      {isFailed && job.error && (
        <p className="ingest-page__job-error" role="alert">
          <AlertTriangle size={12} /> {job.error}
        </p>
      )}
    </li>
  );
}
