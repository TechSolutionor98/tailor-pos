'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { fmt, fmtDate } from '@/lib/format';
import type { Sale } from '@/lib/types';
import { Card, EmptyState, Seg, StatusBadge, TextInput } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/components/AuthContext';
import { AnchoredDropdown } from '@/components/AnchoredDropdown';

function SaleActionMenu({
  sale,
  canManage,
  onDeleted,
}: {
  sale: Sale;
  canManage: boolean;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const handleDelete = async () => {
    setOpen(false);
    if (!window.confirm(`Are you sure you want to delete invoice #${sale.billNo}?`)) {
      return;
    }
    setDeleting(true);
    try {
      await api.sales.delete(sale._id);
      toast(`Invoice #${sale.billNo} deleted successfully`, 'success');
      onDeleted();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to delete invoice', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div ref={anchorRef} className="relative inline-block text-right" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="btn-soft inline-flex items-center gap-1 !px-2.5 !py-1 text-xs font-semibold"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        disabled={deleting}
      >
        <span>Action</span>
        <span className="text-[10px] text-ink-500">▾</span>
      </button>

      <AnchoredDropdown anchorRef={anchorRef} panelRef={panelRef} open={open} width={168} direction="auto" align="right">
        <div className="py-1 text-ink-800">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium transition hover:bg-brand-50 hover:text-brand-800"
            onClick={() => {
              setOpen(false);
              router.push(`/sales/${sale._id}`);
            }}
          >
            <span className="text-sm">✏️</span>
            <span>View / Edit</span>
          </button>

          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium transition hover:bg-brand-50 hover:text-brand-800"
            onClick={() => {
              setOpen(false);
              router.push(`/sales/${sale._id}?print=1`);
            }}
          >
            <span className="text-sm">🖨</span>
            <span>Print</span>
          </button>

          {canManage && (
            <>
              <div className="my-1 border-t border-ink-100" />
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-rose-600 transition hover:bg-rose-50 hover:text-rose-700"
                onClick={handleDelete}
              >
                <span className="text-sm">🗑</span>
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      </AnchoredDropdown>
    </div>
  );
}

export default function SalesPage() {
  const { can } = useAuth();
  const canManage = can('sales.create');
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'all' | 'sales' | 'returns'>('all');
  const [rows, setRows] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (query: string, m: string) => {
      setLoading(true);
      try {
        const isReturn = m === 'all' ? undefined : m === 'returns';
        const r = await api.sales.list(query, 1, 50, isReturn);
        setRows(r.items);
        setTotal(r.total);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Failed to load sales', 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(q, mode), 350);
    return () => clearTimeout(t);
  }, [q, mode, load]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="page-title">Sales / Return</h1>
          <p className="page-sub">{total} bills</p>
        </div>
        {canManage && (
          <Link href="/sales/new" className="btn-primary ml-auto">
            ＋ New Sale
          </Link>
        )}
      </div>

      <Card className="mb-3 flex flex-wrap items-center gap-3 p-4">
        <TextInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by bill no, customer, phone, job ref…"
          className="max-w-sm"
        />
        <Seg
          options={[
            { value: 'all' as const, label: 'All' },
            { value: 'sales' as const, label: 'Sales' },
            { value: 'returns' as const, label: 'Returns' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-ink-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No bills found" sub="Create your first sales bill." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/60">
                  <th className="th">Inv No</th>
                  <th className="th">Date</th>
                  <th className="th">Customer</th>
                  <th className="th">Type</th>
                  <th className="th">Ref / Job</th>
                  <th className="th text-right">Net Amount</th>
                  <th className="th text-right">Advance</th>
                  <th className="th text-right">Balance</th>
                  <th className="th text-center">Status</th>
                  <th className="th text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {rows.map((s) => (
                  <tr key={s._id} className="transition hover:bg-brand-50/50">
                    <td className="td">
                      <Link href={`/sales/${s._id}`} className="font-extrabold text-brand-700 hover:underline">
                        {s.billNo}
                      </Link>
                    </td>
                    <td className="td">{fmtDate(s.billDate)}</td>
                    <td className="td font-semibold">{s.partyName || '—'}</td>
                    <td className="td capitalize text-ink-500">{s.saleType} · {s.paymentType}</td>
                    <td className="td font-mono text-xs text-ink-500">{s.refNo || s.jobCardRef || '—'}</td>
                    <td className="td text-right font-bold tabular-nums">
                      <span className={s.isReturn ? 'text-rose-600' : ''}>
                        {s.isReturn ? `-${fmt(s.netAmount)}` : fmt(s.netAmount)}
                      </span>
                    </td>
                    <td className="td text-right tabular-nums text-emerald-600">{fmt(s.advanceAmount)}</td>
                    <td className="td text-right font-bold tabular-nums text-brass-600">{fmt(s.balance)}</td>
                    <td className="td text-center">
                      {s.isReturn ? (
                        <StatusBadge status="return" />
                      ) : s.orderStatus ? (
                        <StatusBadge status={s.orderStatus} />
                      ) : (
                        <StatusBadge status="delivered" />
                      )}
                    </td>
                    <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                      <SaleActionMenu
                        sale={s}
                        canManage={canManage}
                        onDeleted={() => void load(q, mode)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
