'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  kind: ToastKind;
  msg: string;
}

const ToastCtx = createContext<{ toast: (msg: string, kind?: ToastKind) => void }>({
  toast: () => {},
});

export const useToast = () => useContext(ToastCtx);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((msg: string, kind: ToastKind = 'success') => {
    const id = nextId++;
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-xl ${
              t.kind === 'success'
                ? 'bg-brand-700'
                : t.kind === 'error'
                  ? 'bg-rose-600'
                  : t.kind === 'warning'
                    ? 'bg-amber-600'
                    : 'bg-brand-700'
            }`}
          >
            <span>
              {t.kind === 'success' ? '✓' : t.kind === 'error' ? '✕' : t.kind === 'warning' ? '⚠️' : 'ℹ'}
            </span>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
