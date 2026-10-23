'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { fmt, fmtDate, orderNo } from '@/lib/format';
import type { JobCard } from '@/lib/types';
import { Card, EmptyState, Seg, StatusBadge, TextInput } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/components/AuthContext';
import { useSettings } from '@/components/SettingsContext';
import { ChangeLog } from '@/components/ChangeLog';
import { AnchoredDropdown } from '@/components/AnchoredDropdown';

function OrderActionMenu({
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
  onUpdated?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hasInvoiced = Boolean(order.invoiceNo) || (order.items || []).some((i) => Boolean(i.invoiced));

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

  const handlePending = async () => {
    setOpen(false);
    const numStr = order.no ?? order.ref;
    setUpdating(true);
    try {
      await api.jobCards.setPending(order._id);
      toast(`Order #${numStr} status set to Pending (Open)`, 'success');
      onUpdated?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to set order status to pending', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const handleReady = async () => {
    setOpen(false);
    const numStr = order.no ?? order.ref;
    setUpdating(true);
    try {
      await api.jobCards.markReady(order._id);
      toast(`Order #${numStr} marked as Ready`, 'success');
      onUpdated?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to mark order as ready', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    setOpen(false);
    const numStr = order.no ?? order.ref;
    if (!window.confirm(`Are you sure you want to delete stitching order #${numStr}?`)) {
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

  return (
    <div ref={anchorRef} className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="btn-soft inline-flex items-center gap-1 !px-2 !py-0.5 text-[11px] font-semibold"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        disabled={deleting || updating}
      >
        <span>Action</span>
        <span className="text-[10px] text-ink-500">▾</span>
      </button>

      <AnchoredDropdown anchorRef={anchorRef} panelRef={panelRef} open={open} width={168} direction="auto">
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

          {canConvert && order.status !== 'deleted' && order.status !== 'delivered' && order.status !== 'converted' && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-800"
              onClick={() => {
                setOpen(false);
                const uninvoiced = (order.items || []).filter((i) => !i.invoiced);
                const isPartially =
                  order.status === 'partially_ready' ||
                  Boolean(order.invoiceNo) ||
                  (order.items || []).some((i) => i.invoiced || i.completed);
                if (isPartially && !uninvoiced.some((i) => i.completed)) {
                  toast(
                    `Order ${order.ref || order.no} has no ready items to invoice. Please mark items as Complete first.`,
                    'warning',
                  );
                  return;
                }
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

          {canEdit && (order.status === 'open' || order.status === 'partially_ready') && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-800"
              onClick={handleReady}
              disabled={updating}
            >
              <span className="text-sm">✓</span>
              <span>Ready</span>
            </button>
          )}

          {canEdit && order.status !== 'deleted' && order.status !== 'delivered' && order.status !== 'converted' && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-blue-700 transition hover:bg-blue-50 hover:text-blue-800"
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

          {canEdit && order.status !== 'open' && order.status !== 'deleted' && !hasInvoiced && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-rose-700 transition hover:bg-rose-50 hover:text-rose-800"
              onClick={handlePending}
              disabled={updating}
            >
              <span className="text-sm">⏳</span>
              <span>Pending</span>
            </button>
          )}

          {canEdit && order.status !== 'deleted' && (
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

function JobCardsInner() {
  const { toast } = useToast();
  const { can, user } = useAuth();
  const { settings } = useSettings();
  const canManage = can('jobcards.create');
  const canConvert = can('jobcards.convert');
  const canEdit = can('jobcards.edit');
  // The log is the owner's view of who touched what — role, not a permission.
  const isSuperAdmin = user?.role === 'super_admin';
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQ = searchParams?.get('q') ?? '';

  const [q, setQ] = useState(initialQ);
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<JobCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [converting, setConverting] = useState(false);
  /** The search and status boxes are out of the way until asked for — but a
      list already narrowed opens showing why. */
  const [filterOpen, setFilterOpen] = useState(Boolean(initialQ));

  const load = useCallback(
    async (query: string, st: string) => {
      setLoading(true);
      try {
        const r = await api.jobCards.list(query, st, 1, 50);
        setRows(r.items);
        setTotal(r.total);
        // A tick means nothing once the rows underneath it have changed.
        setSelected([]);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Failed to load stitching orders', 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load(initialQ, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(q, status), 350);
    return () => clearTimeout(t);
  }, [q, status, load]);

  /** Only an open, partially ready, or ready order can be billed — the rest are done or already invoiced. */
  const convertible = rows.filter((j) => j.status === 'open' || j.status === 'partially_ready' || j.status === 'ready');
  const allPicked = convertible.length > 0 && selected.length === convertible.length;

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function convert(ids: string[]) {
    if (ids.length === 0) return;
    setConverting(true);
    try {
      const r = await api.jobCards.convertBulk(ids, {
        salesman: settings.salesman,
        taxRate: settings.taxRate,
      });
      if (r.converted.length === 1 && r.skipped.length === 0) {
        toast(`Order ${r.converted[0].no} converted to bill B-${r.converted[0].billNo}`);
      } else if (r.converted.length > 0) {
        toast(
          `${r.converted.length} order${r.converted.length === 1 ? '' : 's'} converted to sales` +
            (r.skipped.length ? ` · ${r.skipped.length} skipped` : ''),
          r.skipped.length ? 'info' : 'success',
        );
      }
      // Say why anything was left behind rather than silently dropping it.
      if (r.converted.length === 0 && r.skipped.length > 0) {
        toast(r.skipped[0].reason, 'error');
      }
      await load(q, status);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Convert failed', 'error');
    } finally {
      setConverting(false);
    }
  }

  const filtered = q.trim().length > 0 || status !== '';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="page-title">All Orders</h1>
          <p className="page-sub">{total} records</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            className={`btn-soft ${filterOpen || filtered ? '!border-brand-600 !text-brand-700' : ''}`}
            onClick={() => setFilterOpen((o) => !o)}
            aria-expanded={filterOpen}
          >
            Filter
            {filtered && <span className="h-1.5 w-1.5 rounded-full bg-brand-600" aria-label="filter in force" />}
          </button>
          {canManage && (
            <Link href="/job-cards/new" className="btn-primary">
              ＋ New Order
            </Link>
          )}
        </div>
      </div>

      {filterOpen && (
        <Card className="mb-3 flex flex-wrap items-center gap-3 p-4">
          <TextInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by no, ref, customer, phone…"
            className="max-w-sm"
            autoFocus
          />
          <Seg
            options={[
              { value: '', label: 'All Orders' },
              { value: 'open', label: 'Pending' },
              { value: 'partially_ready', label: 'Partially Ready' },
              { value: 'ready', label: 'Ready' },
              { value: 'closed', label: 'Completed' },
              { value: 'delivered', label: 'Delivered' },
              { value: 'deleted', label: 'Deleted' },
              { value: 'all_history', label: 'All History' },
            ]}
            value={status}
            onChange={setStatus}
          />
          {filtered && (
            <button
              className="btn-ghost !py-1.5 text-xs"
              onClick={() => {
                setQ('');
                setStatus('');
              }}
            >
              Clear
            </button>
          )}
        </Card>
      )}

      {canConvert && selected.length > 0 && (
        <Card className="mb-3 flex flex-wrap items-center gap-3 border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-bold text-brand-800">
            {selected.length} order{selected.length === 1 ? '' : 's'} selected
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button className="btn-soft !py-1.5 text-xs" onClick={() => setSelected([])} disabled={converting}>
              Clear
            </button>
            <button
              className="btn-success !py-1.5 text-xs"
              onClick={() => void convert(selected)}
              disabled={converting}
            >
              {converting ? 'Converting…' : `Convert ${selected.length} to Sales →`}
            </button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-ink-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No stitching orders found" sub="Try a different search or create a new one." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/60">
                  {canConvert && (
                    <th className="th !px-1.5 !py-2 text-[10px] sticky left-0 z-20 w-9 min-w-[36px] max-w-[36px] bg-ink-50 text-center">
                      <input
                        type="checkbox"
                        checked={allPicked}
                        disabled={convertible.length === 0}
                        onChange={(e) => setSelected(e.target.checked ? convertible.map((j) => j._id) : [])}
                        className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                        aria-label="Select all open orders"
                      />
                    </th>
                  )}
                  <th
                    className={`th !px-2 !py-2 text-[10px] sticky z-20 w-24 min-w-[80px] bg-ink-50 border-r border-ink-200/80 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.05)] ${
                      canConvert ? 'left-9' : 'left-0'
                    }`}
                  >
                    Order No
                  </th>
                  <th className="th !px-2 !py-2 text-[10px] min-w-[70px]">Ref</th>
                  <th className="th !px-2 !py-2 text-[10px] min-w-[120px]">Customer</th>
                  <th className="th !px-2 !py-2 text-[10px] min-w-[95px]">Phone</th>
                  <th className="th !px-2 !py-2 text-[10px] min-w-[80px]">Date</th>
                  <th className="th !px-2 !py-2 text-[10px] min-w-[80px]">Delivery</th>
                  <th className="th !px-2 !py-2 text-[10px] text-right min-w-[70px]">Total</th>
                  <th className="th !px-2 !py-2 text-[10px] text-right min-w-[70px]">Advance</th>
                  <th className="th !px-2 !py-2 text-[10px] text-right min-w-[70px]">Balance</th>
                  <th className="th !px-2 !py-2 text-[10px] min-w-[90px]">Status</th>
                  <th className="th !px-2 !py-2 text-[10px] sticky right-0 z-20 w-20 min-w-[75px] bg-ink-50 text-right border-l border-ink-200/80 shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.05)]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {rows.map((j) => {
                  const isDel = j.status === 'deleted';
                  const cellBg = isDel
                    ? 'bg-[#FFF5F5] group-hover:bg-[#FFE8E8]'
                    : 'bg-white group-hover:bg-brand-50';

                  return (
                    <tr
                      key={j._id}
                      onClick={(e) => {
                        const el = e.target as HTMLElement;
                        if (el.closest('a, button, input, label')) return;
                        router.push(`/job-cards/${j._id}`);
                      }}
                      className={`group cursor-pointer transition ${
                        isDel ? 'text-ink-600' : ''
                      }`}
                    >
                      {canConvert && (
                        <td
                          className={`td !px-1.5 !py-1.5 text-xs sticky left-0 z-10 w-9 min-w-[36px] max-w-[36px] text-center transition-colors ${cellBg}`}
                        >
                          <input
                            type="checkbox"
                            checked={selected.includes(j._id)}
                            disabled={j.status !== 'open' && j.status !== 'partially_ready'}
                            onChange={() => toggle(j._id)}
                            className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
                            aria-label={`Select order ${orderNo(j)}`}
                          />
                        </td>
                      )}
                      <td
                        className={`td !px-2 !py-1.5 text-xs sticky z-10 w-24 min-w-[80px] border-r border-ink-200/80 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.05)] transition-colors ${
                          canConvert ? 'left-9' : 'left-0'
                        } ${cellBg}`}
                      >
                        <Link
                          href={`/job-cards/${j._id}`}
                          className={`font-bold hover:underline ${
                            isDel ? 'text-rose-700 line-through' : 'text-brand-700'
                          }`}
                        >
                          {orderNo(j)}
                        </Link>
                      </td>
                      <td className={`td !px-2 !py-1.5 font-mono text-xs text-ink-500 transition-colors ${cellBg}`}>{j.ref}</td>
                      <td className={`td !px-2 !py-1.5 font-semibold text-xs transition-colors max-w-[150px] truncate ${cellBg}`} title={j.partyName || ''}>{j.partyName || '—'}</td>
                      <td className={`td !px-2 !py-1.5 font-mono text-xs transition-colors ${cellBg}`}>{j.phone || '—'}</td>
                      <td className={`td !px-2 !py-1.5 text-xs transition-colors ${cellBg}`}>{fmtDate(j.date)}</td>
                      <td className={`td !px-2 !py-1.5 text-xs transition-colors ${cellBg}`}>{fmtDate(j.deliveryDate)}</td>
                      <td className={`td !px-2 !py-1.5 text-right font-bold text-xs tabular-nums transition-colors ${cellBg}`}>{fmt(j.netAmount)}</td>
                      <td className={`td !px-2 !py-1.5 text-right text-xs tabular-nums text-emerald-600 transition-colors ${cellBg}`}>{fmt(j.advance)}</td>
                      <td className={`td !px-2 !py-1.5 text-right font-bold text-xs tabular-nums text-brass-600 transition-colors ${cellBg}`}>{fmt(j.balance)}</td>
                      <td className={`td !px-2 !py-1.5 text-xs transition-colors ${cellBg}`}>
                        <StatusBadge status={j.status} />
                      </td>
                      <td
                        className={`td !px-2 !py-1.5 text-xs sticky right-0 z-10 w-20 min-w-[75px] text-right border-l border-ink-200/80 shadow-[-2px_0_4px_-1px_rgba(0,0,0,0.05)] transition-colors ${cellBg}`}
                      >
                        <OrderActionMenu
                          order={j}
                          canConvert={canConvert}
                          canEdit={canEdit}
                          onDeleted={() => void load(q, status)}
                          onUpdated={() => void load(q, status)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isSuperAdmin && <ChangeLog />}
    </div>
  );
}

export default function JobCardsPage() {
  return (
    <Suspense>
      <JobCardsInner />
    </Suspense>
  );
}
