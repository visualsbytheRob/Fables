/**
 * useCollabExtensions: lazy-loads the collab stack (yjs/y-codemirror) only
 * when the user enables collaboration, keeping them off the initial JS chunk.
 *
 * The import('./index.js') call is what Vite splits into a separate chunk.
 *
 * Returns:
 *   - active / connState / peers / identity / isPrivate — presence state
 *   - extensions  — CodeMirror Extension[] to pass as extraExtensions ([] when off)
 *   - enable / disable / setIdentity / setPrivate — controls
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Extension } from '@uiw/react-codemirror';
import type { Awareness } from 'y-protocols/awareness';
import type * as CollabIndex from './index.js';

type ConnState = 'off' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface PresenceIdentity {
  name: string;
  color: string;
}

export interface PresencePeer {
  clientId: number;
  user: { name: string; color: string };
  active: boolean;
}

interface Session {
  destroy: () => void;
  awareness: Awareness;
}

export interface LazyCollabHandle {
  active: boolean;
  connState: ConnState;
  extensions: Extension[];
  peers: PresencePeer[];
  identity: PresenceIdentity;
  isPrivate: boolean;
  awareness: Awareness | null;
  enable: () => void;
  disable: () => void;
  setIdentity: (id: PresenceIdentity) => void;
  setPrivate: (v: boolean) => void;
}

function loadPrivacySync(): boolean {
  try {
    return localStorage.getItem('fables.collab.private') === 'true';
  } catch {
    return false;
  }
}

function loadIdentitySync(): PresenceIdentity {
  try {
    const raw = localStorage.getItem('fables.collab.identity');
    if (raw) {
      const p = JSON.parse(raw) as Partial<PresenceIdentity>;
      if (p.name && p.color) return p as PresenceIdentity;
    }
  } catch {
    // ignore
  }
  return { name: 'Me', color: '#5c7ce0' };
}

export function useCollabExtensions(docId: string): LazyCollabHandle {
  const [active, setActive] = useState(false);
  const [connState, setConnState] = useState<ConnState>('off');
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [identity, setIdentityState] = useState<PresenceIdentity>(loadIdentitySync);
  const [isPrivate, setIsPrivateState] = useState(loadPrivacySync);
  const [awareness, setAwareness] = useState<Awareness | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const modRef = useRef<typeof CollabIndex | null>(null);

  // Cleanup on docId change or unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.destroy();
        sessionRef.current = null;
      }
    };
  }, [docId]);

  const enable = useCallback(async () => {
    if (sessionRef.current) return;

    // Lazy-load the entire collab stack — Vite splits this into a separate chunk
    if (!modRef.current) {
      modRef.current = await import('./index.js');
    }
    const { CollabProvider, buildCollabExtension, loadIdentity, loadPrivacy } = modRef.current;
    const Y = await import('yjs');
    const { Awareness: AwarenessClass } = await import('y-protocols/awareness');

    const id = loadIdentity();
    const priv = loadPrivacy();
    setIdentityState(id);
    setIsPrivateState(priv);

    const doc = new Y.Doc();
    const aw = new AwarenessClass(doc);
    const yText = doc.getText('body');

    const provider = new CollabProvider({
      docId,
      doc,
      awareness: aw,
      onStateChange: (s) => setConnState(s as ConnState),
    });

    const userState = priv
      ? { name: 'Anonymous', color: '#888888', active: true }
      : { name: id.name, color: id.color, active: true };
    aw.setLocalState({ user: userState, active: true });

    const myId = aw.clientID;
    const updatePeers = () => {
      const next: PresencePeer[] = [];
      aw.getStates().forEach((state, cid) => {
        if (cid === myId) return;
        const user = (state as Record<string, unknown>).user as
          | { name: string; color: string }
          | undefined;
        if (!user?.name) return;
        next.push({
          clientId: cid,
          user,
          active: (state as Record<string, unknown>).active !== false,
        });
      });
      setPeers(next);
    };

    aw.on('change', updatePeers);

    const ext = buildCollabExtension({ yText, awareness: aw });
    setExtensions([ext]);
    setAwareness(aw);
    setActive(true);
    setConnState('connecting');

    // Idle/away detection (F1135)
    const IDLE_MS = 60_000;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const markActive = () => {
      aw.setLocalStateField('active', true);
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => aw.setLocalStateField('active', false), IDLE_MS);
    };
    window.addEventListener('mousemove', markActive, { passive: true });
    window.addEventListener('keydown', markActive, { passive: true });
    markActive();

    sessionRef.current = {
      awareness: aw,
      destroy: () => {
        window.removeEventListener('mousemove', markActive);
        window.removeEventListener('keydown', markActive);
        if (idleTimer) clearTimeout(idleTimer);
        provider.destroy();
        doc.destroy();
      },
    };
  }, [docId]);

  const disable = useCallback(() => {
    if (!sessionRef.current) return;
    sessionRef.current.destroy();
    sessionRef.current = null;
    setActive(false);
    setConnState('off');
    setExtensions([]);
    setPeers([]);
    setAwareness(null);
  }, []);

  const setIdentity = useCallback((id: PresenceIdentity) => {
    setIdentityState(id);
    modRef.current?.saveIdentity(id);
    if (sessionRef.current && !loadPrivacySync()) {
      sessionRef.current.awareness.setLocalStateField('user', {
        name: id.name,
        color: id.color,
        active: true,
      });
    }
  }, []);

  const setPrivate = useCallback((v: boolean) => {
    setIsPrivateState(v);
    modRef.current?.savePrivacy(v);
    if (sessionRef.current) {
      const id = loadIdentitySync();
      const user = v
        ? { name: 'Anonymous', color: '#888888', active: false }
        : { name: id.name, color: id.color, active: true };
      sessionRef.current.awareness.setLocalStateField('user', user);
    }
  }, []);

  return {
    active,
    connState,
    extensions,
    peers,
    identity,
    isPrivate,
    awareness,
    enable,
    disable,
    setIdentity,
    setPrivate,
  };
}
