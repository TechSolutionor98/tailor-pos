'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { fmt, fmtDate, orderNo } from '@/lib/format';
import type { JobCard } from '@/lib/types';
import { Card, EmptyState, Seg, StatusBadge, TextInput } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/components/AuthContext';
import { AnchoredDropdown } from '@/components/AnchoredDropdown';

function ReadyOrdersActionMenu({
  order,
  canConvert,
  canEdit,
  onDeleted,
  onUpdated,
}: {
  order: JobCard;
  canConvert: boolean;
  canEdit: boolean;
  onDeleted: () => void;
  onUpdated: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const changeStatus = async (newStatus: string) => {
    setOpen(false);
    if (newStatus === order.status) return;
    setUpdatingStatus(true);
    try {
      await api.jobCards.updateStatus(order._id, newStatus);
      const label =
        newStatus === 'open'
          ? 'Pending'
          : newStatus === 'partially_ready'
          ? 'Partially Ready'
          : newStatus === 'ready'
          ? 'Ready'
          : newStatus === 'delivered'
          ? 'Delivered'
          : newStatus === 'closed'
          ? 'Completed'
          : newStatus;
      toast(`Order #${order.no ?? order.ref} status changed to ${label}`, 'success');
      onUpdated();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to update status', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleDelete = async () => {
    setOpen(false);
    const numStr = order.no ?? order.ref;
    if (!window.confirm(`Are you sure you want to delete order #${numStr}?`)) {
      return;
    }
    setDeleting(true);
    try {
      await api.jobCards.delete(order._id);
      toast(`Order #${numStr} deleted successfully`, 'success');
      onDeleted();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to delete order', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const hasInvoiced = Boolean(order.invoiceNo) || (order.items || []).some((i) => Boolean(i.invoiced));
  const statusOptions = [
    { value: 'ready', label: 'Ready', dot: 'bg-emerald-500' },
    { value: 'partially_ready', label: 'Partially Ready', dot: 'bg-amber-500' },
    ...(hasInvoiced ? [] : [{ value: 'open', label: 'Pending', dot: 'bg-blue-500' }]),
    { value: 'delivered', label: 'Delivered', dot: 'bg-indigo-500' },
  ];

  return (
    <div ref={anchorRef} className="relative inline-block text-right" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="btn-soft inline-flex items-center gap-1 !px-2.5 !py-1 text-xs font-semibold"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        disabled={deleting || updatingStatus}
      >
        <span>Action</span>
        <span className="text-[10px] text-ink-500">▾</span>
      </button>

      <AnchoredDropdown anchorRef={anchorRef} panelRef={panelRef} open={open} width={200} direction="auto" align="right">
        <div className="py-1 text-ink-800">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium transition hover:bg-brand-50 hover:text-brand-800"
            onClick={() => {
              setOpen(false);
              router.push(`/job-cards/${order._id}`);
            }}
          >
            <span className="text-sm">✏️</span>
            <span>{order.status === 'deleted' ? 'View' : 'Edit'}</span>
          </button>

          {canConvert && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-800"
              onClick={() => {
                setOpen(false);
                router.push(`/sales/new?fromJobCard=${order._id}`);
              }}
              title="Shift this stitching order into New Sale"
            >
              <span className="text-sm">⚡</span>
              <span>Move to Sale</span>
            </button>
          )}

          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium transition hover:bg-brand-50 hover:text-brand-800"
            onClick={() => {
              setOpen(false);
              router.push(`/job-cards/${order._id}/invoice?print=1`);
            }}
          >
            <span className="text-sm">🖨</span>
            <span>Print</span>
          </button>

          {canEdit && order.status !== 'deleted' && order.status !== 'delivered' && order.status !== 'converted' && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-amber-700 transition hover:bg-amber-50 hover:text-amber-800"
              onClick={() => {
                setOpen(false);
                router.push(`/job-cards/${order._id}?action=partially_ready#order-items-section`);
              }}
              title="Open order to mark individual products as completed"
            >
              <span className="text-sm">✂️</span>
              <span>Partially Ready</span>
            </button>
          )}

          {canEdit && (
            <>
              <div className="my-1 border-t border-ink-100" />
              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-400">
                Change Status
              </div>

              {statusOptions.map((s) => {
                const isActive = order.status === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    disabled={updatingStatus || isActive}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium transition ${
                      isActive
                        ? 'bg-brand-50 text-brand-800 font-semibold cursor-default'
                        : 'hover:bg-brand-50 hover:text-brand-800'
                    }`}
                    onClick={() => void changeStatus(s.value)}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                      <span>{s.label}</span>
                    </span>
                    {isActive && <span className="text-[10px] text-brand-600 font-bold">✓</span>}
                  </button>
                );
              })}
            </>
          )}

          {canEdit && (
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

function ReadyOrdersInner() {
  const { toast } = useToast();
  const { can } = useAuth();
  const canManage = can('jobcards.create');
  const canConvert = can('jobcards.convert');
  const canEdit = can('jobcards.edit');
  const router = useRouter();

  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'all' | 'ready' | 'partially_ready'>('all');
  const [rows, setRows] = useState<JobCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (query: string, m: 'all' | 'ready' | 'partially_ready') => {
      setLoading(true);
      try {
        const statusParam = m === 'all' ? 'ready_orders' : m;
        const r = await api.jobCards.list(query, statusParam, 1, 50);
        setRows(r.items);
        setTotal(r.total);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Failed to load ready orders', 'error');
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

  const stats = useMemo(() => {
    const ready = rows.filter((r) => r.status === 'ready').length;
    const partial = rows.filter((r) => r.status === 'partially_ready').length;
    const totalBalance = rows.reduce(
      (s, r) => s + (Number(r.balance) > 0 ? Number(r.balance) : 0),
      0,
    );
    const totalNet = rows.reduce((s, r) => s + (Number(r.netAmount) || 0), 0);
    return { ready, partial, totalBalance, totalNet };
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <span>Ready Orders</span>
            <span className="rounded-full bg-brand-100/80 px-2.5 py-0.5 text-xs font-black text-brand-800 font-heading">
              {total}
            </span>
          </h1>
          <p className="page-sub">
            Track finished tailoring and partially stitched garments ready for customer collection.
          </p>
        </div>
        {canManage && (
          <Link
            href="/job-cards/new"
            className="btn-primary !px-4 !py-2 text-sm font-bold shadow-md hover:shadow-lg transition-all"
          >
            ＋ New Order
          </Link>
        )}
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-ink-200/80 bg-white p-4 shadow-card transition-all hover:shadow-lift">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-500 font-heading">
              Total Listed
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink-100/70 text-ink-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </span>
          </div>
          <div className="mt-2 text-2xl font-black text-ink-950 font-heading">{total}</div>
          <p className="mt-0.5 text-[11px] font-medium text-ink-500">Orders in this view</p>
        </div>

        <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-white to-emerald-50/40 p-4 shadow-card transition-all hover:shadow-lift">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 font-heading">
              Fully Ready
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </span>
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-700 font-heading">
            {stats.ready}
          </div>
          <p className="mt-0.5 text-[11px] font-medium text-emerald-600/80">
            Finished & ready for pickup
          </p>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-white to-amber-50/40 p-4 shadow-card transition-all hover:shadow-lift">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800 font-heading">
              Partially Ready
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
          </div>
          <div className="mt-2 text-2xl font-black text-amber-700 font-heading">
            {stats.partial}
          </div>
          <p className="mt-0.5 text-[11px] font-medium text-amber-600/80">
            Some items still stitching
          </p>
        </div>

        <div className="rounded-2xl border border-rose-200/80 bg-gradient-to-br from-white to-rose-50/40 p-4 shadow-card transition-all hover:shadow-lift">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-800 font-heading">
              Balance to Collect
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-100 text-rose-800">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </span>
          </div>
          <div className="mt-2 text-2xl font-black text-rose-600 font-heading tabular-nums">
            {fmt(stats.totalBalance)}{' '}
            <span className="text-xs font-bold text-rose-500 font-sans">AED</span>
          </div>
          <p className="mt-0.5 text-[11px] font-medium text-rose-500/80">Pending customer balance</p>
        </div>
      </div>

      {/* Search & Segments Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200/80 bg-white p-3.5 shadow-card">
        <div className="relative min-w-[260px] flex-1 max-w-md">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-ink-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by order no, customer, phone, ref…"
            className="input !pl-9 !pr-8 text-sm"
            autoFocus
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-xs text-ink-400 hover:text-ink-700"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Seg
            options={[
              { value: 'all' as const, label: `All (${total})` },
              { value: 'ready' as const, label: `Ready (${stats.ready})` },
              { value: 'partially_ready' as const, label: `Partially Ready (${stats.partial})` },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      </div>

      {/* Main Table Card */}
      <div className="rounded-2xl border border-ink-200/80 bg-white shadow-card overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-ink-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="No ready orders found"
              sub="Orders marked Ready or Partially Ready will appear here."
            />
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left table-auto">
              <thead>
                <tr className="border-b border-ink-200/80 bg-[#FAFCFB] text-[11px] font-bold uppercase tracking-wider text-ink-500 font-heading">
                  <th className="px-3 py-2.5 text-left">Order</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-left">Delivery</th>
                  <th className="px-3 py-2.5 text-left">Customer</th>
                  <th className="px-3 py-2.5 text-left">Phone</th>
                  <th className="px-3 py-2.5 text-left">Ref</th>
                  <th className="px-3 py-2.5 text-right">Net</th>
                  <th className="px-3 py-2.5 text-right">Advance</th>
                  <th className="px-3 py-2.5 text-right">Balance</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100/70">
                {rows.map((j) => {
                  const isReady = j.status === 'ready';
                  const isDelivered = j.status === 'delivered' || j.status === 'converted';
                  const balanceNum = Number(j.balance) || 0;
                  return (
                    <tr
                      key={j._id}
                      onClick={(e) => {
                        const el = e.target as HTMLElement;
                        if (el.closest('a, button, input, label')) return;
                        router.push(`/job-cards/${j._id}`);
                      }}
                      className="group cursor-pointer transition-colors duration-150 hover:bg-brand-50/40"
                    >
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/job-cards/${j._id}`}
                          className="inline-flex items-center font-mono font-bold text-brand-800 bg-brand-50 border border-brand-200/80 px-2 py-0.5 rounded text-xs shadow-sm hover:bg-brand-100 hover:border-brand-400 transition"
                          onClick={(e) => e.stopPropagation()}
                        >
                          #{orderNo(j)}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-600 whitespace-nowrap">{fmtDate(j.date)}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-700 whitespace-nowrap">
                        {fmtDate(j.deliveryDate)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100/80 text-brand-800 font-bold text-[10px] uppercase font-heading">
                            {j.partyName ? j.partyName.trim()[0] : 'C'}
                          </span>
                          <span className="font-bold text-ink-900 text-xs sm:text-sm truncate max-w-[130px]">{j.partyName || '—'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-ink-600 whitespace-nowrap">
                        {j.phone || '—'}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-ink-400 whitespace-nowrap">
                        {j.ref || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-extrabold text-ink-950 font-heading text-xs tabular-nums whitespace-nowrap">
                        {fmt(j.netAmount)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-emerald-700 font-heading text-xs tabular-nums whitespace-nowrap">
                        {fmt(j.advance)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-black font-heading text-xs tabular-nums whitespace-nowrap">
                        {balanceNum > 0 ? (
                          <span className="text-rose-600 font-black">
                            {fmt(j.balance)}
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-bold text-[11px]">
                            Paid
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {isReady ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-800 shadow-sm font-heading">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span>Ready</span>
                          </span>
                        ) : isDelivered ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-0.5 text-[10px] font-extrabold text-blue-800 shadow-sm font-heading">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                            <span>Delivered</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[10px] font-extrabold text-amber-900 shadow-sm font-heading">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            <span>Partially Ready</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <ReadyOrdersActionMenu
                          order={j}
                          canConvert={canConvert && !isDelivered}
                          canEdit={canEdit}
                          onDeleted={() => void load(q, mode)}
                          onUpdated={() => void load(q, mode)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReadyOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-3 p-6">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-ink-100" />
          <div className="h-12 w-full animate-pulse rounded-xl bg-ink-100" />
        </div>
      }
    >
      <ReadyOrdersInner />
    </Suspense>
  );
}
