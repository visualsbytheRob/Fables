/** Lightweight context menu (F175 et al): fixed-position, Escape/outside-click to close. */
import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';

export interface MenuItem {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number | string }>;
  danger?: boolean;
  run: () => void;
}

export interface MenuState {
  x: number;
  y: number;
  items: (MenuItem | 'sep')[];
}

export function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  // Keep on screen: clamp against viewport when we know it.
  const maxX = typeof window === 'undefined' ? menu.x : Math.min(menu.x, window.innerWidth - 200);
  const maxY =
    typeof window === 'undefined'
      ? menu.y
      : Math.min(menu.y, window.innerHeight - 40 * menu.items.length);

  return (
    <div ref={ref} className="ui-menu" role="menu" style={{ left: maxX, top: Math.max(8, maxY) }}>
      {menu.items.map((item, i) =>
        item === 'sep' ? (
          <div key={`sep-${i}`} className="ui-menu__sep" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`ui-menu__item${item.danger ? ' ui-menu__item--danger' : ''}`}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.icon && <item.icon size={14} />}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
