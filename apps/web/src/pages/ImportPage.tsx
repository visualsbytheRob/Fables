/**
 * Import progress UI (F297): pick a source type, point at a server-local
 * folder, dry-run scan report (F296 server half), then run the import and
 * watch per-file progress with an error triage list, driven by the async
 * job endpoints (202 + poll).
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Button, Input, Select, Upload, useToast } from '@fables/ui';
import { importApi, type ImportCollisionMode, type ScanReport } from '../api/client.js';
import { useImportJob, useInvalidateNotes, useNotebookTree } from '../api/hooks.js';
import { allNodes } from '../notes/notebookTreeModel.js';
import './import.css';

type SourceType = 'markdown' | 'obsidian';

const SOURCE_HINTS: Record<SourceType, string> = {
  markdown: 'A folder of .md files; subfolders become nested notebooks.',
  obsidian: 'An Obsidian vault — ![[embeds]] and .obsidian config are handled.',
};

export function ImportPage() {
  const { toast } = useToast();
  const invalidate = useInvalidateNotes();
  const tree = useNotebookTree();
  const [source, setSource] = useState<SourceType>('markdown');
  const [path, setPath] = useState('');
  const [collisions, setCollisions] = useState<ImportCollisionMode>('rename');
  const [notebookId, setNotebookId] = useState('');
  const [scan, setScan] = useState<ScanReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [notifiedDone, setNotifiedDone] = useState(false);

  const job = useImportJob(jobId).data ?? null;
  const running = job?.status === 'running';
  const notebooks = useMemo(() => allNodes(tree.data ?? []), [tree.data]);

  // Refresh app data once when a job finishes.
  const jobStatus = job?.status ?? null;
  useEffect(() => {
    if (jobStatus !== null && jobStatus !== 'running' && !notifiedDone) {
      setNotifiedDone(true);
      invalidate();
    }
  }, [jobStatus, notifiedDone, invalidate]);

  const runScan = () => {
    setScanning(true);
    setScanError(null);
    setScan(null);
    setJobId(null);
    importApi.scan(path.trim()).then(
      (report) => {
        setScan(report);
        setScanning(false);
      },
      (err: Error) => {
        setScanError(err.message);
        setScanning(false);
      },
    );
  };

  const runImport = () => {
    setStarting(true);
    setNotifiedDone(false);
    importApi
      .run({
        path: path.trim(),
        collisions,
        ...(notebookId !== '' ? { notebookId } : {}),
      })
      .then(
        (created) => {
          setJobId(created.id);
          setStarting(false);
          toast('Import started');
        },
        (err: Error) => {
          setStarting(false);
          toast(`Import failed to start: ${err.message}`, 'error');
        },
      );
  };

  const progressPct = job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

  return (
    <div className="import-page">
      <h1>
        <Upload size={20} /> Import
      </h1>

      <section className="import-page__setup ui-stack" aria-label="Import source">
        <div className="ui-row">
          <label className="ui-stack import-page__field">
            Source type
            <Select
              aria-label="Source type"
              value={source}
              onChange={(e) => setSource(e.target.value as SourceType)}
            >
              <option value="markdown">Markdown folder</option>
              <option value="obsidian">Obsidian vault</option>
            </Select>
          </label>
          <label className="ui-stack import-page__field import-page__field--grow">
            Folder path on the server
            <Input
              aria-label="Import path"
              placeholder="/Users/you/vault"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
          <Button
            variant="primary"
            disabled={path.trim() === '' || scanning || running}
            onClick={runScan}
          >
            {scanning ? 'Scanning…' : 'Scan (dry run)'}
          </Button>
        </div>
        <p className="import-page__hint">{SOURCE_HINTS[source]}</p>
        {scanError !== null && (
          <p className="import-page__error" role="alert">
            <AlertTriangle size={14} /> {scanError}
          </p>
        )}
      </section>

      {scan && (
        <section className="import-page__report ui-stack" aria-label="Dry-run report">
          <h2>Dry-run report</h2>
          <p className="import-page__totals">
            {scan.totals.files} file{scan.totals.files === 1 ? '' : 's'} · {scan.totals.attachments}{' '}
            attachment{scan.totals.attachments === 1 ? '' : 's'} · {scan.totals.collisions} title
            collision{scan.totals.collisions === 1 ? '' : 's'}
          </p>
          <div className="import-page__scroll">
            <table className="import-page__table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Title</th>
                  <th>Attachments</th>
                  <th>Collision</th>
                </tr>
              </thead>
              <tbody>
                {scan.files.map((file) => (
                  <tr key={file.path}>
                    <td>{file.path}</td>
                    <td>{file.title}</td>
                    <td>{file.attachments || ''}</td>
                    <td>{file.collision ? <span className="ui-badge">collision</span> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ui-row">
            <label className="ui-stack import-page__field">
              On title collision
              <Select
                aria-label="Collision mode"
                value={collisions}
                onChange={(e) => setCollisions(e.target.value as ImportCollisionMode)}
              >
                <option value="rename">Rename (keep both)</option>
                <option value="merge">Merge into existing</option>
                <option value="skip">Skip</option>
              </Select>
            </label>
            <label className="ui-stack import-page__field">
              Target notebook
              <Select
                aria-label="Target notebook"
                value={notebookId}
                onChange={(e) => setNotebookId(e.target.value)}
              >
                <option value="">From folder structure</option>
                {notebooks.map((nb) => (
                  <option key={nb.id} value={nb.id}>
                    {nb.name}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              variant="primary"
              disabled={starting || running || scan.totals.files === 0}
              onClick={runImport}
            >
              {starting ? 'Starting…' : `Import ${scan.totals.files} files`}
            </Button>
          </div>
        </section>
      )}

      {job && (
        <section className="import-page__progress ui-stack" aria-label="Import progress">
          <h2>
            {job.status === 'running' && 'Importing…'}
            {job.status === 'done' && 'Import complete'}
            {job.status === 'failed' && 'Import failed'}
          </h2>
          <progress
            className="import-page__bar"
            max={job.total || 1}
            value={job.processed}
            aria-label="Import progress"
          />
          <p className="import-page__totals" data-testid="import-counters">
            {job.processed}/{job.total} processed ({progressPct}%) · {job.imported} imported ·{' '}
            {job.merged} merged · {job.renamed} renamed · {job.skipped} skipped · {job.attachments}{' '}
            attachments
          </p>
          {job.errors.length > 0 && (
            <div className="import-page__errors" role="alert" aria-label="Import errors">
              <h3>
                <AlertTriangle size={14} /> {job.errors.length} file
                {job.errors.length === 1 ? '' : 's'} failed
              </h3>
              <ul>
                {job.errors.map((err) => (
                  <li key={err.file}>
                    <code>{err.file}</code> — {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
