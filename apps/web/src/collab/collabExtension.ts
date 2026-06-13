/**
 * collabExtension (F1111–F1116):
 *
 * Builds the CodeMirror Extension that binds a Y.Text to the editor via
 * yCollab from y-codemirror.next.  Includes:
 *   - ySync: bi-directional Y.Text ↔ CodeMirror document sync (F1111)
 *   - yRemoteSelections: remote cursors + selection highlights (F1112/F1113)
 *   - Y.UndoManager: local-user-scoped undo/redo (F1115)
 *   - yUndoManagerKeymap: Ctrl/Cmd-Z / Shift-Ctrl/Cmd-Z bindings (F1115)
 *
 * F1116 (cursor stability during remote edits): ySync handles this internally
 * by mapping local selections through remote updates.
 *
 * F1117 (conflict-free task-list toggling): CRDT semantics guarantee
 * convergence; toggleTaskAtLine continues to work — it operates on the local
 * doc string, the change propagates through Y.Text automatically.
 *
 * F1118 (latency budget): yCollab applies remote updates synchronously on the
 * next JS microtask after the WS message arrives; no extra latency introduced.
 *
 * Imports use @uiw/react-codemirror re-exports (the only listed CM dep)
 * and yjs / y-codemirror.next (listed in apps/web/package.json).
 */

import type { Extension } from '@uiw/react-codemirror';
import { Prec, keymap } from '@uiw/react-codemirror';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';

export interface CollabExtensionOptions {
  yText: Y.Text;
  awareness: Awareness;
}

/**
 * Returns a CodeMirror Extension for collaborative editing.
 *
 * Call this once per (yText, awareness) pair.  When collab is toggled off,
 * simply stop providing these extensions (replace with []).
 */
export function buildCollabExtension({ yText, awareness }: CollabExtensionOptions): Extension {
  // Y.UndoManager scoped to the local user's edits (F1115).
  // null origin = local CodeMirror dispatch (tracked); CollabProvider's origin is 'this'
  // which is a non-null object, so remote updates are excluded.
  const undoManager = new Y.UndoManager(yText, {
    trackedOrigins: new Set([null]),
  });

  return [
    // yCollab bundles ySync (doc binding) + yRemoteSelections (cursors/highlights)
    yCollab(yText, awareness, { undoManager }),
    // F1115: undo/redo keybindings at high priority so they override CM defaults
    Prec.high(keymap.of(yUndoManagerKeymap)),
  ];
}
