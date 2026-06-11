import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

interface ToastContextValue {
  toast: (message: string, kind?: Toast['kind']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const TOAST_TTL_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_TTL_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="ui-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`ui-toast${t.kind === 'error' ? ' ui-toast--error' : ''}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
