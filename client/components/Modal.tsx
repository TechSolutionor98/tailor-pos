'use client';

import React, { useEffect } from 'react';

export function Modal({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  wide,
  size,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);

  if (!open) return null;

  const widthClass =
    size === '2xl'
      ? 'max-w-5xl'
      : size === 'xl'
      ? 'max-w-4xl'
      : size === 'sm'
      ? 'max-w-md'
      : wide || size === 'lg'
      ? 'max-w-3xl'
      : 'max-w-lg';

  return (
    <div className="no-print fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className={`relative w-full ${widthClass} ${className} card max-h-[92vh] overflow-hidden !rounded-b-none sm:!rounded-b-xl`}
      >
        <div className="flex items-start justify-between border-b border-ink-100 px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-lg font-extrabold tracking-tight text-ink-900">{title}</h3>
            {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost !px-2.5 text-lg leading-none">
            ✕
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-4 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
