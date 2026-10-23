'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmt, fmtAEDTile, fmtDate, orderNo, todayISO } from '@/lib/format';
import type { DashboardSummary } from '@/lib/types';
import { Donut, DonutKey, type DonutSlice } from '@/components/Donut';
import { Card, SectionTitle, EmptyState, StatusBadge } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { useToast } from '@/components/Toast';

/**
 * Chart hues, validated for colour-blind separation and contrast against the
 * white card surface. Teal is the brand accent; the rest are fixed slots — a
 * mode always keeps its own colour, whatever the filter leaves on screen.
 */
const VIZ = {
  sales: '#11836C',
  returns: '#d03b3b',
  cash: '#11836C',
  bank: '#2a78d6',
  card: '#eb6834',
  credit: '#4a3aa7',
} as const;

/** First of the current month — the range the dashboard opens on. */
function monthStartISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** The shell every top-row card shares: a title, an icon chip, and a body. */
function PanelCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-ink-200 bg-white p-4 shadow-card transition hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-500">{title}</p>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { toast } = useToast();
  const [from, setFrom] = useState(monthStartISO);
  const [to, setTo] = useState(todayISO);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (nextFrom: string, nextTo: string) => {
      setLoading(true);
      try {
        setData(await api.dashboard.summary(nextFrom, nextTo));
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not load dashboard', 'error');
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    load(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const paymentSlices: DonutSlice[] = data
    ? [
        { label: 'Cash', value: data.payments.cash, color: VIZ.cash },
        { label: 'Bank', value: data.payments.bank, color: VIZ.bank },
        { label: 'Card', value: data.payments.card, color: VIZ.card },
        { label: 'Credit', value: data.payments.credit, color: VIZ.credit },
      ]
    : [];

  const salesSlices: DonutSlice[] = data
    ? [
        { label: 'Sales', value: data.sales.gross, color: VIZ.sales },
        { label: 'Sales return', value: data.sales.returns, color: VIZ.returns },
      ]
    : [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">A live overview of your tailoring business.</p>
        </div>

        <div className="flex items-end gap-2">
          <span className="pb-2 text-xs font-semibold text-ink-500">Date filter</span>
          <label className="sr-only" htmlFor="dash-from">
            From date
          </label>
          <input
            id="dash-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="input input-sm w-[9.5rem]"
          />
          <label className="sr-only" htmlFor="dash-to">
            To date
          </label>
          <input
            id="dash-to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="input input-sm w-[9.5rem]"
          />
        </div>
      </div>

      {loading ? (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-ink-200" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <PanelCard title="Sales" icon="coins">
              <div className="flex items-center gap-3">
                <ul className="flex-1 space-y-1.5">
                  <li className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: VIZ.sales }}
                    />
                    <span className="text-[15px] font-bold leading-tight text-ink-900">
                      {fmtAEDTile(data.sales.gross)}
                    </span>
                    <span className="text-xs font-medium text-ink-500">sales</span>
                  </li>
                  <li className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: VIZ.returns }}
                    />
                    <span className="text-[15px] font-bold leading-tight text-ink-900">
                      {fmtAEDTile(data.sales.returns)}
                    </span>
                    <span className="text-xs font-medium text-ink-500">sales return</span>
                  </li>
                  <li className="mt-1 whitespace-nowrap border-t border-ink-100 pt-1.5">
                    <p className="text-[17px] font-bold leading-tight tracking-[-0.01em] text-ink-950">
                      {fmtAEDTile(data.sales.net)}
                    </p>
                    <p className="text-xs font-medium text-ink-500">
                      total sales · {data.sales.billCount} bills
                    </p>
                  </li>
                </ul>
                <Donut data={salesSlices} label="Sales against returns" className="h-[72px] w-[72px]" />
              </div>
            </PanelCard>

            <PanelCard title="Orders" icon="trending">
              <dl className="space-y-1.5">
                {[
                  ['New Orders', data.orders.newOrders],
                  ['Pending Orders', data.orders.pending],
                  ['Delivered', data.orders.delivered],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-baseline gap-2">
                    <dd className="min-w-[2.25rem] text-[17px] font-bold leading-tight text-ink-950">
                      {value}
                    </dd>
                    <dt className="whitespace-nowrap text-xs font-medium text-ink-500">{label}</dt>
                  </div>
                ))}
              </dl>
            </PanelCard>

            <PanelCard title="Payments" icon="scissors">
              <div className="flex items-center gap-3">
                <DonutKey slices={paymentSlices} format={fmtAEDTile} className="flex-1" />
                <Donut data={paymentSlices} label="Payments by mode" className="h-[72px] w-[72px]" />
              </div>
            </PanelCard>

            <PanelCard title="Customers" icon="users">
              <p className="text-[28px] font-bold leading-none tracking-[-0.02em] text-ink-950">
                {data.totalCustomers}
              </p>
              <p className="mt-2 text-xs font-medium text-ink-500">ledgers on file</p>
            </PanelCard>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
            <Card className="p-5 xl:col-span-2">
              <SectionTitle
                title="Total Orders"
                sub="Latest orders in the workshop"
                right={
                  <Link href="/job-cards" className="btn-soft !py-1.5 text-xs">
                    View all →
                  </Link>
                }
              />
              {data.recentJobCards.length === 0 ? (
                <EmptyState
                  title="No stitching orders in this period"
                  sub="Widen the date filter, or create a stitching order to get started."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-ink-100">
                        <th className="th">Invoice No</th>
                        <th className="th">Ref</th>
                        <th className="th">Customer</th>
                        <th className="th">Delivery</th>
                        <th className="th text-right">Net Amt</th>
                        <th className="th">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-50">
                      {data.recentJobCards.map((j) => (
                        <tr key={j._id} className="hover:bg-ink-50/70">
                          <td className="td font-bold text-brand-700">
                            <Link href={`/job-cards/${j._id}`}>{orderNo(j)}</Link>
                          </td>
                          <td className="td font-mono text-xs">{j.ref}</td>
                          <td className="td font-medium">{j.partyName || '—'}</td>
                          <td className="td">{fmtDate(j.deliveryDate)}</td>
                          <td className="td text-right font-bold tabular-nums">{fmt(j.netAmount)}</td>
                          <td className="td">
                            <StatusBadge status={j.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-5 xl:row-span-2 xl:self-start">
              <SectionTitle
                title="Low Stock"
                sub="Products below 10 units"
                right={
                  <Link href="/products" className="btn-soft !py-1.5 text-xs">
                    Inventory →
                  </Link>
                }
              />
              {data.lowStock.length === 0 ? (
                <EmptyState title="Stock looks healthy" sub="Nothing is running low right now." />
              ) : (
                <ul className="space-y-2.5">
                  {data.lowStock.map((p) => (
                    <li
                      key={p._id}
                      className="flex items-center justify-between rounded-xl bg-ink-50 px-3.5 py-2.5"
                    >
                      <div>
                        <p className="text-sm font-bold text-ink-800">
                          <span className="mr-2 font-mono text-xs text-brand-600">{p.code}</span>
                          {p.name}
                        </p>
                        <p className="text-[11px] text-ink-500 capitalize">{p.category}</p>
                      </div>
                      <span
                        className={`badge ${p.stockQty <= 0 ? 'bg-rose-100 text-rose-700' : 'bg-brass-100 text-brass-700'}`}
                      >
                        {p.stockQty} left
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5 xl:col-span-2">
              <SectionTitle
                title="Total Sales"
                sub="Latest bills raised"
                right={
                  <Link href="/sales" className="btn-soft !py-1.5 text-xs">
                    View all →
                  </Link>
                }
              />
              {data.recentSales.length === 0 ? (
                <EmptyState
                  title="No bills in this period"
                  sub="Widen the date filter, or raise a sale to get started."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-ink-100">
                        <th className="th">No</th>
                        <th className="th">Ref</th>
                        <th className="th">Customer</th>
                        <th className="th">Date</th>
                        <th className="th text-right">Net Amt</th>
                        <th className="th">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-50">
                      {data.recentSales.map((s) => (
                        <tr key={s._id} className="hover:bg-ink-50/70">
                          <td className="td font-bold text-brand-700">
                            <Link href={`/sales/${s._id}`}>{s.billNo}</Link>
                          </td>
                          <td className="td font-mono text-xs">{s.jobCardRef || '—'}</td>
                          <td className="td font-medium">{s.partyName || '—'}</td>
                          <td className="td">{fmtDate(s.billDate)}</td>
                          <td className="td text-right font-bold tabular-nums">{fmt(s.netAmount)}</td>
                          <td className="td">
                            <span className={s.isReturn ? 'badge bg-rose-100 text-rose-700 border border-rose-300' : 'badge bg-emerald-50 text-emerald-800 border border-emerald-300'}>
                              {s.isReturn ? 'return' : 'sale'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      ) : (
        <div className="mt-3">
          <EmptyState
            title="Could not reach the API"
            sub="Make sure the server is running (npm run dev in server/) and MongoDB is up."
          />
        </div>
      )}
    </div>
  );
}
