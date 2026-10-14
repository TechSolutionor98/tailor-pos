'use client';

import React from 'react';
import { Icon } from '@/components/icons';

export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function SectionTitle({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-extrabold tracking-tight text-ink-900">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Clicking into a figure selects it, so the next keystroke replaces it rather
 * than landing beside the zero already sitting there.
 *
 * Deferred a frame on purpose: the click that gives the box focus then places
 * the caret, which would undo a selection made here and now. The check on the
 * way out is for a fast tab-through, where the caret has already moved on and
 * stealing it back would be worse than doing nothing.
 */
export function selectOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  requestAnimationFrame(() => {
    if (document.activeElement === el) el.select();
  });
}

/**
 * Scrolling the page with the pointer over a focused number box used to
 * change the figure in it — a rate quietly going from 3970 to 3975 on the way
 * past. Letting go of focus stops that: the page scrolls as it should, and
 * the box keeps the number that was typed into it.
 */
export function blurOnWheel(e: React.WheelEvent<HTMLInputElement>) {
  if (document.activeElement === e.currentTarget) e.currentTarget.blur();
}

export const TextInput = React.forwardRef<HTMLInputElement, InputProps>(function TextInput(
  { className = '', onFocus, onWheel, ...props },
  ref,
) {
  const isNumber = props.type === 'number';
  return (
    <input
      ref={ref}
      {...props}
      onFocus={(e) => {
        onFocus?.(e);
        // Only figures: a name or an address is read before it is edited, and
        // wiping it on a stray click is how a correction becomes a retype.
        if (isNumber) selectOnFocus(e);
      }}
      onWheel={(e) => {
        onWheel?.(e);
        if (isNumber) blurOnWheel(e);
      }}
      className={`input ${className}`}
    />
  );
});

export const NumberInput = React.forwardRef<HTMLInputElement, InputProps>(function NumberInput(
  { className = '', onFocus, onWheel, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="number"
      step="any"
      min="0"
      {...props}
      onFocus={(e) => {
        onFocus?.(e);
        selectOnFocus(e);
      }}
      onWheel={(e) => {
        onWheel?.(e);
        blurOnWheel(e);
      }}
      className={`input text-left tabular-nums ${className}`}
    />
  );
});

export const DateInput = React.forwardRef<HTMLInputElement, InputProps>(function DateInput(
  { className = '', ...props },
  ref,
) {
  return <input ref={ref} type="date" {...props} className={`input ${className}`} />;
});

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = '', children, ...props },
  ref,
) {
  return (
    <select ref={ref} {...props} className={`input ${className}`}>
      {children}
    </select>
  );
});

export function Checkbox({
  label,
  checked,
  onChange,
  className = '',
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-ink-700 ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
      />
      {label}
    </label>
  );
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={o.value === value ? 'seg-btn-active' : 'seg-btn'}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink-200 bg-ink-50/60 px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <Icon name="sparkle" className="h-5 w-5" />
      </div>
      <p className="text-sm font-bold text-ink-700">{title}</p>
      {sub && <p className="mt-1 text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'open'
      ? 'badge-open'
      : status === 'closed'
        ? 'badge-closed'
        : status === 'deleted'
          ? 'badge-deleted'
          : 'badge-converted';
  return <span className={cls}>{status}</span>;
}
