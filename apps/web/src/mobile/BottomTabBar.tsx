/**
 * Bottom tab bar on phone widths (F877): Notes / Stories / Search / Today.
 * Only renders when viewport ≤ 640px (checked at runtime via matchMedia).
 */
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import './mobile.css';

function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => {
    // Guard for SSR / jsdom where matchMedia is absent.
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(max-width: 640px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 640px)');
    const handler = (e: MediaQueryListEvent) => setIsPhone(e.matches);
    mq.addEventListener('change', handler);
    setIsPhone(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isPhone;
}

export function BottomTabBar() {
  const isPhone = useIsPhone();
  if (!isPhone) return null;

  return (
    <nav className="bottom-tab-bar" aria-label="Phone navigation">
      <NavLink
        to="/"
        end
        className={({ isActive }) => `tab-item${isActive ? ' tab-item--active' : ''}`}
      >
        <span className="tab-item__icon" aria-hidden>
          📝
        </span>
        <span className="tab-item__label">Notes</span>
      </NavLink>
      <NavLink
        to="/stories"
        className={({ isActive }) => `tab-item${isActive ? ' tab-item--active' : ''}`}
      >
        <span className="tab-item__icon" aria-hidden>
          📖
        </span>
        <span className="tab-item__label">Stories</span>
      </NavLink>
      <NavLink
        to="/today"
        className={({ isActive }) => `tab-item${isActive ? ' tab-item--active' : ''}`}
      >
        <span className="tab-item__icon" aria-hidden>
          📅
        </span>
        <span className="tab-item__label">Today</span>
      </NavLink>
      <NavLink
        to="/insights"
        className={({ isActive }) => `tab-item${isActive ? ' tab-item--active' : ''}`}
      >
        <span className="tab-item__icon" aria-hidden>
          ✨
        </span>
        <span className="tab-item__label">Insights</span>
      </NavLink>
    </nav>
  );
}
