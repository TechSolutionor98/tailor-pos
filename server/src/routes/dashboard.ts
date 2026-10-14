import { Router } from 'express';
import { Sale } from '../models/Sale';
import { JobCard } from '../models/JobCard';
import { Ledger } from '../models/Ledger';
import { Product } from '../models/Product';
import { asyncHandler } from '../middleware';
import { r2 } from '../utils/money';
import { requireAuth, requirePerm } from '../auth/guard';

export const dashboardRouter = Router();

// Every endpoint below requires a signed-in user.
dashboardRouter.use(requireAuth);

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The dashboard's date filter. `from`/`to` are plain YYYY-MM-DD days; anything
 * missing or unparseable falls back to "this month so far", which is what the
 * page shows on a cold load.
 */
function resolveRange(from?: unknown, to?: unknown) {
  const now = new Date();
  const parse = (v: unknown): Date | null => {
    if (typeof v !== 'string' || !v.trim()) return null;
    const d = new Date(`${v.slice(0, 10)}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  let start = parse(from) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  let end = parse(to) ?? now;
  // A backwards range is a slip, not an empty result — read it either way round.
  if (start > end) [start, end] = [end, start];

  return { start: startOfDay(start), end: endOfDay(end) };
}

// GET /dashboard/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
dashboardRouter.get(
  '/summary',
  requirePerm('dashboard.view'),
  asyncHandler(async (req, res) => {
    const { start, end } = resolveRange(req.query.from, req.query.to);
    const billRange = { billDate: { $gte: start, $lte: end } };
    // Drafts and deleted orders are left out of active order counts on the dashboard.
    const cardRange = { date: { $gte: start, $lte: end }, status: { $nin: ['draft', 'deleted'] } };

    const [
      salesAgg,
      orderAgg,
      paymentAgg,
      totalCustomers,
      recentJobCards,
      recentSales,
      lowStock,
    ] = await Promise.all([
      // Sales and sales returns in one pass, split by the isReturn flag.
      Sale.aggregate([
        { $match: billRange },
        {
          $group: {
            _id: '$isReturn',
            total: { $sum: '$netAmount' },
            count: { $sum: 1 },
          },
        },
      ]),
      // Orders by status, so new / pending / delivered all come from one query.
      JobCard.aggregate([
        { $match: cardRange },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      // Money actually collected in the window, split by how it came in.
      JobCard.aggregate([
        { $unwind: '$payments' },
        { $match: { 'payments.date': { $gte: start, $lte: end } } },
        { $group: { _id: '$payments.mode', total: { $sum: '$payments.amount' } } },
      ]),
      Ledger.countDocuments({ type: 'customer' }),
      JobCard.find(cardRange).sort({ no: -1 }).limit(6).lean(),
      Sale.find(billRange).sort({ billNo: -1 }).limit(6).lean(),
      Product.find({ stockQty: { $lt: 10 } }).sort({ stockQty: 1 }).limit(8).lean(),
    ]);

    const salesRow = salesAgg.find((r) => r._id !== true);
    const returnRow = salesAgg.find((r) => r._id === true);
    // Returns are stored as positive bills flagged isReturn, so subtract them.
    const gross = salesRow?.total ?? 0;
    const returns = Math.abs(returnRow?.total ?? 0);

    const orderCount = (status: string) =>
      orderAgg.find((r) => r._id === status)?.count ?? 0;

    const payment = (mode: string) =>
      r2(paymentAgg.find((r) => r._id === mode)?.total ?? 0);

    const payments = {
      cash: payment('cash'),
      bank: payment('bank'),
      card: payment('card'),
      credit: payment('credit'),
    };

    res.json({
      range: { from: isoDay(start), to: isoDay(end) },
      sales: {
        gross: r2(gross),
        returns: r2(returns),
        net: r2(gross - returns),
        billCount: salesRow?.count ?? 0,
        returnCount: returnRow?.count ?? 0,
      },
      orders: {
        newOrders: orderAgg.reduce((sum, r) => sum + r.count, 0),
        pending: orderCount('open'),
        delivered: orderCount('closed') + orderCount('converted'),
      },
      payments: {
        ...payments,
        total: r2(payments.cash + payments.bank + payments.card + payments.credit),
      },
      totalCustomers,
      recentJobCards,
      recentSales,
      lowStock,
    });
  }),
);
