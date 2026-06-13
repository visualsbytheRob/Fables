/**
 * useStoryCollab (F1151–F1160): lazy hook to enable collab on a story project.
 *
 * Returns the StoryCollabSession (or null when inactive) along with the
 * per-file Y.Text getter and the shared playthrough state.
 *
 * Lazy: imports yjs only when enable() is called.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoryCollabSession, StoryRole } from './storyCollab.js';
import type { CollabProvider } from './CollabProvider.js';
import type * as Y from 'yjs';

interface StoryCollabHandle {
  session: StoryCollabSession | null;
  active: boolean;
  role: StoryRole;
  enable: () => void;
  disable: () => void;
  setRole: (r: StoryRole) => void;
}

export function useStoryCollab(storyId: string): StoryCollabHandle {
  const [active, setActive] = useState(false);
  const [role, setRoleState] = useState<StoryRole>('author');
  const [session, setSession] = useState<StoryCollabSession | null>(null);
  const sessionRef = useRef<{
    session: StoryCollabSession;
    doc: Y.Doc;
    provider: CollabProvider;
  } | null>(null);

  // Cleanup on storyId change or unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.provider.destroy();
        sessionRef.current.doc.destroy();
        sessionRef.current = null;
      }
    };
  }, [storyId]);

  const enable = useCallback(async () => {
    if (sessionRef.current) return;

    const [Y, { Awareness }, { CollabProvider }, { StoryCollabSession }, { loadIdentity }] =
      await Promise.all([
        import('yjs'),
        import('y-protocols/awareness'),
        import('./CollabProvider.js'),
        import('./storyCollab.js'),
        import('./index.js'),
      ]);

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const id = loadIdentity();

    const provider = new CollabProvider({
      docId: `story:${storyId}`,
      doc,
      awareness,
    });

    awareness.setLocalState({
      user: { name: id.name, color: id.color },
      active: true,
      storyRole: 'author' as StoryRole,
    });

    const sess = new StoryCollabSession(doc, awareness);
    sessionRef.current = { session: sess, doc, provider };
    setSession(sess);
    setActive(true);
  }, [storyId]);

  const disable = useCallback(() => {
    if (!sessionRef.current) return;
    sessionRef.current.provider.destroy();
    sessionRef.current.doc.destroy();
    sessionRef.current = null;
    setSession(null);
    setActive(false);
    setRoleState('author');
  }, []);

  const setRole = useCallback((r: StoryRole) => {
    setRoleState(r);
    if (sessionRef.current) {
      sessionRef.current.session.setRole(r);
    }
  }, []);

  return { session, active, role, enable, disable, setRole };
}
