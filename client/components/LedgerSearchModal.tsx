'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Ledger } from '@/lib/types';
import { LedgerFormModal } from '@/components/LedgerFormModal';
import { Modal } from './Modal';
import { TextInput } from './ui';
import { useToast } from './Toast';
import { useAuth } from './AuthContext';

export function LedgerSearchModal({
  open,
  onClose,
  onSelect,
  startIn = 'search',
  seedName = '',
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (ledger: Ledger) => void;
  /** 'newCustomer' skips the search and opens straight on the create form. */
  startIn?: 'search' | 'newCustomer';
  /** Pre-fills the name when opening on the create form. */
  seedName?: string;
}) {
  const { toast } = useToast();
  const { can } = useAuth();
  const canManage = can('ledgers.manage');

  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Ledger[]>([]);
  const [picked, setPicked] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(false);

  // The counter often meets a customer who is not on file yet, so a new one
  // can be created here without abandoning the order. Only a customer: this
  // dialog is opened from an order and from a bill, and neither is ever made
  // out to a supplier. Suppliers are added on their own screen.
  const [creating, setCreating] = useState(false);
  /** The name the create form is opened with. */
  const [seed, setSeed] = useState('');

  useEffect(() => {
    if (!open) return;
    setQ('');
    setPicked(null);
    if (startIn === 'newCustomer') {
      setSeed(seedName.trim());
      setCreating(true);
      return;
    }
    setCreating(false);
    void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function load(query: string) {
    setLoading(true);
    try {
      const r = await api.ledgers.list(query, 1, 100);
      setRows(r.items);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load ledgers', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || creating) return;
    const t = setTimeout(() => void load(q), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, creating]);

  function startCreate() {
    // Carry whatever was typed in the search box into the name.
    setSeed(q.trim());
    setCreating(true);
  }

  // Creating is the shared ledger form, not a thinner copy of it: someone
  // added mid-order is a full record like any other. It replaces this dialog
  // while it is up, so the two are never stacked on top of each other.
  if (creating) {
    return (
      <LedgerFormModal
        open={open}
        onClose={onClose}
        onSaved={(l) => {
          // Straight onto the order — that is why they opened this.
          onSelect(l);
          onClose();
        }}
        type="customer"
        seedName={seed}
        sub="Saved to your ledgers and added to this order"
        footerExtra={
          startIn === 'newCustomer' ? undefined : (
            <button className="btn-soft" onClick={() => setCreating(false)}>
              Back to search
            </button>
          )
        }
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Find Ledger"
      sub="Search by name or phone, then press OK"
      wide
      footer={
        <>
          <button className="btn-soft" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-success"
            disabled={!picked}
            onClick={() => {
              if (picked) {
                onSelect(picked);
                onClose();
              }
            }}
          >
            OK
          </button>
        </>
      }
    >
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <TextInput
              autoFocus
              placeholder="Search by name, phone, book #, or order #…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="min-w-0 flex-1"
            />
            {canManage && (
              <button className="btn-soft shrink-0" onClick={startCreate}>
                ＋ New customer
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border border-ink-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]">
                <thead className="bg-ink-50">
                  <tr>
                    <th className="th">Phone</th>
                    <th className="th">Ledger Name</th>
                    <th className="th">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {loading && (
                    <tr>
                      <td colSpan={3} className="td text-center text-ink-400">
                        Searching…
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    rows.map((l) => (
                      <tr
                        key={l._id}
                        onClick={() => setPicked(l)}
                        onDoubleClick={() => {
                          onSelect(l);
                          onClose();
                        }}
                        className={`cursor-pointer transition ${
                          picked?._id === l._id ? 'bg-brand-50' : 'hover:bg-ink-50'
                        }`}
                      >
                        <td className="td font-mono text-[13px]">{l.phone || '—'}</td>
                        <td className="td font-semibold">
                          <div>{l.name}</div>
                          {(l.latestBookNo != null || l.latestOrderNo != null) && (
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono text-ink-500 font-normal">
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
                            </div>
                          )}
                        </td>
                        <td className="td">
                          <span className="badge bg-ink-100 text-ink-600">{l.type}</span>
                        </td>
                      </tr>
                    ))}
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="td text-center">
                        <p className="text-ink-500">
                          No ledger matches {q.trim() ? `“${q.trim()}”` : 'that search'}.
                        </p>
                        {canManage && (
                          <button
                            className="btn-primary mt-3 !py-1.5 text-xs"
                            onClick={startCreate}
                          >
                            ＋ Add {q.trim() ? `“${q.trim()}”` : 'a new customer'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
    </Modal>
  );
}
