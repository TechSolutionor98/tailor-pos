'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmt, fmtDate } from '@/lib/format';
import type { Sale } from '@/lib/types';
import { Card, EmptyState, Seg, StatusBadge, TextInput } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/components/AuthContext';

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
                  <th className="th" />
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
                    <td className="td">
                      <Link href={`/sales/${s._id}`} className="text-xs font-bold text-brand-600 hover:underline">
                        View →
                      </Link>
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
