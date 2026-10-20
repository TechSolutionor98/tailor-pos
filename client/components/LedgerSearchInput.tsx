'use client';

import { useEffect, useRef, useState } from 'react';
import { AnchoredDropdown } from '@/components/AnchoredDropdown';
import { api } from '@/lib/api';
import type { Ledger } from '@/lib/types';

/**
 * Type-to-find a ledger, in one box.
 *
 * Unlike LedgerSearchModal this sits inline, so it can be used from inside
 * another dialog without stacking two overlays. Picking a row hands the whole
 * ledger back; typing afterwards clears the pick, because a half-edited name
 * no longer identifies anybody.
 */
export function LedgerSearchInput({
  value,
  phone,
  onChange,
  onPick,
  onCreate,
  placeholder = 'Search by name, phone, book #, or order #…',
  disabled,
  autoFocus,
  className = '',
}: {
  value: string;
  phone?: string;
  onChange: (v: string) => void;
  onPick: (l: Ledger) => void;
  /** Offered at the foot of the list when the typed name is on nobody's file. */
  onCreate?: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Ledger[]>([]);
  /** The text the rows above were fetched for, so a stale list is never
      mistaken for "nobody by that name". */
  const [answered, setAnswered] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const typed = value.trim();
  const empty = open && answered === typed && typed.length > 0 && rows.length === 0;

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  useEffect(() => {
    if (!open || disabled) return;
    let dropped = false;
    const t = setTimeout(async () => {
      const asked = value.trim();
      try {
        const r = await api.ledgers.list(value, 1, 8);
        if (dropped) return;
        setRows(r.items);
        setAnswered(asked);
      } catch {
        if (dropped) return;
        setRows([]);
        setAnswered(asked);
      }
    }, 250);
    return () => {
      dropped = true;
      clearTimeout(t);
    };
  }, [value, open, disabled]);

  function create() {
    setOpen(false);
    onCreate?.(typed);
  }

  return (
    <div ref={wrapRef} className="relative flex items-center w-full min-w-0">
      <input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          // Suggestions follow what is being typed rather than greeting an
          // empty box with the first eight names on file.
          setOpen(e.target.value.trim().length > 0);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (rows.length > 0) {
            e.preventDefault();
            onPick(rows[0]);
            setOpen(false);
          } else if (empty && onCreate) {
            e.preventDefault();
            create();
          }
        }}
        className={`input w-full ${phone ? 'pr-36' : ''} ${className}`}
      />
      {phone && (
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-1 rounded bg-brand-50/90 px-2 py-0.5 font-mono text-xs font-bold text-brand-700 border border-brand-200/60 shadow-xs">
          <span>📞</span>
          <span>{phone}</span>
        </div>
      )}
      <AnchoredDropdown
        anchorRef={wrapRef}
        panelRef={panelRef}
        open={open && (rows.length > 0 || empty)}
        width={360}
      >
        <>
          {rows.map((l) => (
            <button
              key={l._id}
              type="button"
              onClick={() => {
                onPick(l);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-brand-50 transition"
            >
              <div className="flex flex-col min-w-0">
                <span className="font-semibold text-ink-900 truncate">{l.name}</span>
                {(l.latestBookNo != null || l.latestOrderNo != null) && (
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] font-mono text-ink-500">
                    {l.latestBookNo != null && (
                      <span className="rounded bg-brand-50 px-1 py-0.2 text-brand-700 font-semibold border border-brand-200/60">
                        Book #{l.latestBookNo}
                      </span>
                    )}
                    {l.latestOrderNo != null && (
                      <span className="rounded bg-ink-100 px-1 py-0.2 text-ink-700 font-semibold">
                        Order #{l.latestOrderNo}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <span className="font-mono text-xs text-ink-600 shrink-0 font-medium">
                {l.phone || '—'}
              </span>
            </button>
          ))}
          {/* A name nobody is filed under is usually a new walk-in, not a typo,
              so the way to put them on file is offered right where the search
              failed instead of sending the counter off to find a ＋ button. */}
          {empty && (
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="truncate text-[12px] font-semibold text-rose-600">
                “{typed}” Not Available
              </span>
              {onCreate && (
                <button
                  type="button"
                  onClick={create}
                  className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-700 px-2.5 py-1 text-[12px] font-bold text-white transition hover:bg-emerald-800 shadow-sm"
                >
                  + Add New
                </button>
              )}
            </div>
          )}
          {rows.length > 0 && (
            <p className="border-t border-ink-100 px-3 py-1.5 text-[10px] text-ink-400">
              Enter to pick first match
            </p>
          )}
        </>
      </AnchoredDropdown>
    </div>
  );
}
