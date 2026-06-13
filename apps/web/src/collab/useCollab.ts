/**
 * useCollab (F1111–F1119, F1131–F1140):
 *
 * React hook that lazily creates a Y.Doc + Awareness + CollabProvider for a
 * given docId and returns the yText handle + presence state.
 *
 * Collab is opt-in (F1119): call enable() to start, disable() to fall back
 * to pure local editing.
 *
 * Idle/away detection (F1135): marks awareness inactive after 60 s.
 * Privacy toggle (F1137): when private, sends anonymous identity.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { CollabProvider, type ConnState, type CollabUser } from './CollabProvider.js';
import {
  loadIdentity,
  loadPrivacy,
  saveIdentity,
  savePrivacy,
  type PresenceIdentity,
} from './identity.js';

export interface PeerState {
  clientId: number;
  user: CollabUser;
  active: boolean;
}

export interface CollabHandle {
  /** Y.Text for the note body. Null when collab is off. */
  yText: Y.Text | null;
  awareness: Awareness | null;
  connState: ConnState | 'off';
  peers: PeerState[];
  active: boolean;
  identity: PresenceIdentity;
  isPrivate: boolean;
  enable: () => void;
  disable: () => void;
  setIdentity: (id: PresenceIdentity) => void;
  setPrivate: (v: boolean) => void;
}

const IDLE_MS = 60_000;

// One Y.Doc + Awareness per docId while collab is active
interface Session {
  doc: Y.Doc;
  awareness: Awareness;
  provider: CollabProvider;
}

export function useCollab(docId: string): CollabHandle {
  const [active, setActive] = useState(false);
  const [connState, setConnState] = useState<ConnState | 'off'>('off');
  const [peers, setPeers] = useState<PeerState[]>([]);
  const [identity, setIdentityState] = useState<PresenceIdentity>(loadIdentity);
  const [isPrivate, setIsPrivateState] = useState(loadPrivacy);

  const sessionRef = useRef<Session | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync peer list from awareness
  const syncPeers = useCallback((awareness: Awareness) => {
    const myId = awareness.clientID;
    const next: PeerState[] = [];
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === myId) return;
      const user = (state as Record<string, unknown>).user as CollabUser | undefined;
      if (!user?.name) return;
      next.push({
        clientId,
        user,
        active: (state as Record<string, unknown>).active !== false,
      });
    });
    setPeers(next);
  }, []);

  const teardown = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.provider.destroy();
      sessionRef.current.doc.destroy();
      sessionRef.current = null;
    }
    setActive(false);
    setConnState('off');
    setPeers([]);
  }, []);

  // Tear down on docId change
  useEffect(() => {
    return () => {
      teardown();
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [docId, teardown]);

  const enable = useCallback(() => {
    if (sessionRef.current) return; // already active
    const id = loadIdentity();
    const priv = loadPrivacy();

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new CollabProvider({
      docId,
      doc,
      awareness,
      onStateChange: setConnState,
    });

    // Set local user on awareness
    const user = priv
      ? { name: 'Anonymous', color: '#888888', active: true }
      : { name: id.name, color: id.color, active: true };
    awareness.setLocalState({ user, active: true });

    awareness.on('change', () => syncPeers(awareness));
    syncPeers(awareness);

    sessionRef.current = { doc, awareness, provider };
    setActive(true);
    setConnState('connecting');
  }, [docId, syncPeers]);

  const disable = useCallback(() => {
    teardown();
  }, [teardown]);

  const setIdentity = useCallback(
    (id: PresenceIdentity) => {
      setIdentityState(id);
      saveIdentity(id);
      if (sessionRef.current && !loadPrivacy()) {
        sessionRef.current.awareness.setLocalStateField('user', {
          name: id.name,
          color: id.color,
          active: true,
        });
      }
    },
    [],
  );

  const setPrivate = useCallback((v: boolean) => {
    setIsPrivateState(v);
    savePrivacy(v);
    if (sessionRef.current) {
      const id = loadIdentity();
      const user = v
        ? { name: 'Anonymous', color: '#888888', active: false }
        : { name: id.name, color: id.color, active: true };
      sessionRef.current.awareness.setLocalStateField('user', user);
    }
  }, []);

  // F1135: idle/away detection
  useEffect(() => {
    if (!active) return;
    const markActive = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      sessionRef.current?.awareness.setLocalStateField('active', true);
      idleTimer.current = setTimeout(() => {
        sessionRef.current?.awareness.setLocalStateField('active', false);
      }, IDLE_MS);
    };
    window.addEventListener('mousemove', markActive, { passive: true });
    window.addEventListener('keydown', markActive, { passive: true });
    markActive();
    return () => {
      window.removeEventListener('mousemove', markActive);
      window.removeEventListener('keydown', markActive);
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
    };
  }, [active]);

  const session = sessionRef.current;
  return {
    yText: session ? session.doc.getText('body') : null,
    awareness: session?.awareness ?? null,
    connState: active ? connState : 'off',
    peers,
    active,
    identity,
    isPrivate,
    enable,
    disable,
    setIdentity,
    setPrivate,
  };
}
