/**
 * Collab tests (F1120, F1140):
 *
 * Tests proving two in-process Y.Docs converge via direct Y.js APIs (no lib0
 * imports needed — we use Y.encodeStateAsUpdate / Y.applyUpdate for convergence
 * proofs, and y-protocols/awareness for the awareness protocol tests).
 *
 * A separate MockTransport section tests the CollabProvider's message handling
 * by mocking WebSocket and inspecting what it sends.
 *
 * No real WebSocket or browser required.
 */

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { CollabProvider } from './CollabProvider.js';

// ---- F1120: Two clients converging ----

describe('F1120 — two-client convergence', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let textA: Y.Text;
  let textB: Y.Text;

  beforeEach(() => {
    docA = new Y.Doc();
    docB = new Y.Doc();
    textA = docA.getText('body');
    textB = docB.getText('body');
  });

  afterEach(() => {
    docA.destroy();
    docB.destroy();
  });

  it('F1120a: A→B sync using Y.encodeStateAsUpdate / Y.applyUpdate', () => {
    textA.insert(0, 'Hello world');

    // Apply A's full state to B
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    expect(textB.toString()).toBe('Hello world');
  });

  it('F1120b: incremental updates flow from A to B', () => {
    const updates: Uint8Array[] = [];
    docA.on('update', (update: Uint8Array) => updates.push(update));

    textA.insert(0, 'Fox');
    textA.insert(3, ' and Lantern');

    for (const upd of updates) {
      Y.applyUpdate(docB, upd);
    }

    expect(textB.toString()).toBe('Fox and Lantern');
  });

  it('F1120c: concurrent edits merge without conflict (CRDT convergence)', () => {
    // A and B each make edits independently
    textA.insert(0, 'Hello');
    textB.insert(0, 'World');

    // Exchange full state → both converge
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    expect(textA.toString()).toBe(textB.toString());
    expect(textA.toString()).toContain('Hello');
    expect(textA.toString()).toContain('World');
  });

  it('F1120d: state vector handshake — only missing updates are exchanged', () => {
    textA.insert(0, 'Step1');

    // Apply A's state to B so B is up to date
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // A makes another edit
    textA.insert(5, ' Step2');

    // Encode only the delta since B's state vector
    const svB = Y.encodeStateVector(docB);
    const delta = Y.encodeStateAsUpdate(docA, svB);

    Y.applyUpdate(docB, delta);

    expect(textB.toString()).toBe('Step1 Step2');
  });

  it('F1117: task-list toggle propagates via Y.Text', () => {
    textA.insert(0, '- [ ] Task one\n- [ ] Task two');
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Toggle first task on A
    const before = textA.toString();
    const toggled = before.replace('- [ ] Task one', '- [x] Task one');
    textA.delete(0, before.length);
    textA.insert(0, toggled);

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    expect(textB.toString()).toContain('- [x] Task one');
    expect(textB.toString()).toContain('- [ ] Task two');
  });

  it('F1115: UndoManager scoped to local origin does not undo remote edits', () => {
    const undoManager = new Y.UndoManager(textA, {
      // null origin = local edits (default CodeMirror dispatch origin)
      trackedOrigins: new Set([null]),
    });

    // Local edit (tracked by UndoManager)
    textA.insert(0, 'local');

    // Remote edit: origin ≠ null → not tracked by UndoManager
    docA.transact(() => {
      textA.insert(textA.length, ' remote');
    }, 'remote-origin');

    expect(textA.toString()).toBe('local remote');

    // Undo should revert only the local tracked edit
    undoManager.undo();

    // 'local' is undone; 'remote' remains
    expect(textA.toString()).toBe(' remote');
  });
});

// ---- F1140: Awareness protocol tests ----

describe('F1140 — awareness protocol', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let awarenessA: Awareness;
  let awarenessB: Awareness;

  beforeEach(() => {
    docA = new Y.Doc();
    docB = new Y.Doc();
    awarenessA = new Awareness(docA);
    awarenessB = new Awareness(docB);
  });

  afterEach(() => {
    awarenessA.destroy();
    awarenessB.destroy();
    docA.destroy();
    docB.destroy();
  });

  it('F1140a: user state propagates from A to B', () => {
    awarenessA.setLocalStateField('user', { name: 'Alice', color: '#e05c5c' });

    applyAwarenessUpdate(awarenessB, encodeAwarenessUpdate(awarenessA, [docA.clientID]), null);

    const state = awarenessB.getStates().get(docA.clientID) as Record<string, unknown>;
    expect(state?.user).toMatchObject({ name: 'Alice', color: '#e05c5c' });
  });

  it('F1140b: removed states are nil on peers after disconnect', () => {
    awarenessA.setLocalStateField('user', { name: 'Alice', color: '#e05c5c' });
    applyAwarenessUpdate(awarenessB, encodeAwarenessUpdate(awarenessA, [docA.clientID]), null);

    // Simulate A disconnecting
    removeAwarenessStates(awarenessA, [docA.clientID], 'disconnect');
    applyAwarenessUpdate(awarenessB, encodeAwarenessUpdate(awarenessA, [docA.clientID]), null);

    const state = awarenessB.getStates().get(docA.clientID);
    expect(state == null || Object.keys(state as object).length === 0).toBe(true);
  });

  it('F1135: idle (active=false) propagates to peers', () => {
    awarenessA.setLocalState({ user: { name: 'Bob', color: '#5c7ce0' }, active: false });

    applyAwarenessUpdate(awarenessB, encodeAwarenessUpdate(awarenessA, [docA.clientID]), null);

    const state = awarenessB.getStates().get(docA.clientID) as Record<string, unknown>;
    expect(state?.active).toBe(false);
  });

  it('F1136/F1137: private mode sends anonymous identity', () => {
    awarenessA.setLocalState({ user: { name: 'Anonymous', color: '#888888' }, active: false });

    applyAwarenessUpdate(awarenessB, encodeAwarenessUpdate(awarenessA, [docA.clientID]), null);

    const state = awarenessB.getStates().get(docA.clientID) as Record<string, unknown>;
    const user = state?.user as Record<string, unknown>;
    expect(user?.name).toBe('Anonymous');
  });

  it('F1132: peer list building excludes self clientID', () => {
    awarenessA.setLocalStateField('user', { name: 'Alice', color: '#e05c5c' });
    awarenessB.setLocalStateField('user', { name: 'Bob', color: '#5c7ce0' });

    // B sees A
    applyAwarenessUpdate(awarenessB, encodeAwarenessUpdate(awarenessA, [docA.clientID]), null);

    const myId = awarenessB.clientID;
    const peers: string[] = [];
    awarenessB.getStates().forEach((state, clientId) => {
      if (clientId === myId) return;
      const user = (state as Record<string, unknown>).user as { name: string } | undefined;
      if (user?.name) peers.push(user.name);
    });

    expect(peers).toHaveLength(1);
    expect(peers[0]).toBe('Alice');
  });
});

// ---- F1119: Graceful degradation ----

describe('F1119 — graceful degradation', () => {
  it('Y.Doc accepts local edits when no provider is connected', () => {
    const doc = new Y.Doc();
    const text = doc.getText('body');

    text.insert(0, 'Local edit without collab');
    expect(text.toString()).toBe('Local edit without collab');
    doc.destroy();
  });
});

// ---- CollabProvider (mocked WebSocket) ----

describe('CollabProvider — WebSocket mocked (F1111–F1124)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Creates a mock WebSocket that captures sent messages and exposes an _emit helper. */
  function makeMockWs() {
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    const sent: Uint8Array[] = [];
    const ws = {
      binaryType: 'arraybuffer',
      readyState: 0 as number, // CONNECTING (1=OPEN, 3=CLOSED)
      send: vi.fn((data: Uint8Array | ArrayBuffer) => {
        // Normalize to Uint8Array with own buffer so slice offset is 0
        const arr = data instanceof Uint8Array ? data.slice() : new Uint8Array(data);
        sent.push(arr);
      }),
      close: vi.fn(() => {
        ws.readyState = 3; // CLOSED
        listeners['close']?.forEach((fn) => fn({}));
      }),
      addEventListener: vi.fn((event: string, fn: (e: unknown) => void) => {
        (listeners[event] ??= []).push(fn);
      }),
      _emit(event: string, data?: unknown) {
        listeners[event]?.forEach((fn) => fn(data ?? {}));
      },
      _sent: sent,
    };
    return ws;
  }

  it('F1111: sends MSG_SYNC=0 on open (sync step1)', () => {
    const ws = makeMockWs();
    vi.stubGlobal('WebSocket', vi.fn(() => { ws.readyState = 1; return ws; }));

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new CollabProvider({ docId: 'test', doc, awareness });

    ws._emit('open');

    expect(ws._sent.length).toBeGreaterThan(0);
    // First byte of first sent message is MSG_SYNC = 0
    const firstMsg = ws._sent[0];
    expect(firstMsg).toBeDefined();
    const firstByte = firstMsg![0];
    expect(firstByte).toBe(0);

    provider.destroy();
    doc.destroy();
    awareness.destroy();
  });

  it('F1131: sends MSG_AWARENESS=1 after open', () => {
    const ws = makeMockWs();
    vi.stubGlobal('WebSocket', vi.fn(() => { ws.readyState = 1; return ws; }));

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField('user', { name: 'Tester', color: '#abc' });

    const provider = new CollabProvider({ docId: 'test', doc, awareness });
    ws._emit('open');

    const hasAwareness = ws._sent.some((buf) => new Uint8Array(buf)[0] === 1);
    expect(hasAwareness).toBe(true);

    provider.destroy();
    doc.destroy();
    awareness.destroy();
  });

  it('F1119: destroy() closes WS and removes local awareness state', () => {
    const ws = makeMockWs();
    vi.stubGlobal('WebSocket', vi.fn(() => { ws.readyState = 1; return ws; }));

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField('user', { name: 'Tester', color: '#abc' });

    const provider = new CollabProvider({ docId: 'test2', doc, awareness });
    ws._emit('open');

    provider.destroy();

    expect(ws.close).toHaveBeenCalled();
    const state = awareness.getStates().get(doc.clientID);
    expect(state == null || Object.keys(state as object).length === 0).toBe(true);

    doc.destroy();
    awareness.destroy();
  });

  it('F1124: onStateChange fires: connecting → connected → disconnected', () => {
    const ws = makeMockWs();
    vi.stubGlobal('WebSocket', vi.fn(() => { ws.readyState = 1; return ws; }));

    const states: string[] = [];
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new CollabProvider({
      docId: 'test3',
      doc,
      awareness,
      onStateChange: (s) => states.push(s),
    });

    expect(states).toContain('connecting');

    ws._emit('open');
    expect(states).toContain('connected');

    ws._emit('close');
    expect(states).toContain('disconnected');

    provider.destroy();
    doc.destroy();
    awareness.destroy();
  });
});
