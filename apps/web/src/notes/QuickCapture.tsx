/**
 * Quick capture (F191): global Mod-Shift-N opens a small modal that posts a
 * new note straight into the default capture notebook (F145), falling back
 * to the first notebook when none is set.
 */
import { useEffect, useState } from 'react';
import { Button, Dialog, Select, Textarea, useToast } from '@fables/ui';
import { useCreateNote, useNotebookTree } from '../api/hooks.js';
import { allNodes } from './notebookTreeModel.js';
import { loadDefaultNotebook } from './prefs.js';

export function QuickCapture({ onCreated }: { onCreated?: (noteId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [notebookId, setNotebookId] = useState('');
  const { toast } = useToast();
  const tree = useNotebookTree();
  const createNote = useCreateNote();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const notebooks = allNodes(tree.data ?? []);
  const effectiveNotebook =
    notebookId !== ''
      ? notebookId
      : (() => {
          const preferred = loadDefaultNotebook();
          if (preferred && notebooks.some((n) => n.id === preferred)) return preferred;
          return notebooks[0]?.id ?? '';
        })();

  const submit = () => {
    if (text.trim() === '' || effectiveNotebook === '') return;
    const [firstLine = '', ...rest] = text.trim().split('\n');
    createNote.mutate(
      {
        notebookId: effectiveNotebook,
        title: firstLine.replace(/^#+\s*/, '').slice(0, 200),
        body: rest.join('\n').trimStart() || text.trim(),
      },
      {
        onSuccess: (note) => {
          toast('Captured');
          setText('');
          setOpen(false);
          onCreated?.(note.id);
        },
        onError: (err) => toast(`Capture failed: ${err.message}`, 'error'),
      },
    );
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)}>
      <div className="ui-stack" style={{ minWidth: 360 }}>
        <h3 style={{ margin: 0 }}>Quick capture</h3>
        <Textarea
          autoFocus
          rows={5}
          placeholder="First line becomes the title…"
          aria-label="Capture text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
        />
        <Select
          aria-label="Capture notebook"
          value={effectiveNotebook}
          onChange={(e) => setNotebookId(e.target.value)}
        >
          {notebooks.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </Select>
        <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={text.trim() === ''} onClick={submit}>
            Capture (⌘↵)
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
