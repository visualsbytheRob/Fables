/** Keyboard cheat-sheet overlay (F198): opens on `?` outside inputs. */
import { useEffect, useState } from 'react';
import { Dialog } from '@fables/ui';

const SHORTCUTS: [string, string][] = [
  ['⌘K', 'Command palette'],
  ['⌘P', 'Quick switcher (jump to note)'],
  ['⌘⇧N', 'Quick capture'],
  ['⌘S', 'Force save'],
  ['⌘B / ⌘I / ⌘E', 'Bold / italic / inline code'],
  ['⌘⇧H', 'Cycle heading'],
  ['⌘⇧8 / ⌘⇧7', 'Bullet / numbered list'],
  ['⌘K', 'Insert link (in editor)'],
  ['⌘⌥C', 'Insert code block'],
  ['?', 'This cheat sheet'],
  ['Esc', 'Close dialogs'],
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function CheatSheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !isTypingTarget(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Dialog open={open} onClose={() => setOpen(false)}>
      <div className="ui-stack" style={{ minWidth: 320 }}>
        <h3 style={{ margin: 0 }}>Keyboard shortcuts</h3>
        <table className="cheat-table">
          <tbody>
            {SHORTCUTS.map(([keys, what]) => (
              <tr key={`${keys}-${what}`}>
                <td>
                  <span className="ui-kbd">{keys}</span>
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
