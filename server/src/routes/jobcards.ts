import { Router } from 'express';
import { Types } from 'mongoose';
import { JobCard } from '../models/JobCard';
import { MeasurementProfile } from '../models/MeasurementProfile';
import { Sale } from '../models/Sale';
import { Counter, nextSeq, peekSeq } from '../models/Counter';
import { asyncHandler, HttpError } from '../middleware';
import { requireAuth, requirePerm } from '../auth/guard';
import { diffSnapshots, recordAudit, snapshotJobCard } from '../utils/audit';
import {
  advanceSplit,
  jobCardTotals,
  lineAmount,
  num,
  r2,
} from '../utils/money';

/**
 * Prefix for an order's reference. Orders raised before this changed still
 * carry their older 'fm-' and 'rf-' refs, and search matches any of them.
 */
const REF_PREFIX = 'Ref';

function validObjectIdStr(id?: unknown): string | undefined {
  if (!id || typeof id !== 'string') return undefined;
  const s = id.trim();
  return Types.ObjectId.isValid(s) ? s : undefined;
}

/** Drop blank material rows and coerce the numbers. */
function cleanMaterials(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m: any) => m && (m.code || m.productName || num(m.qty) || num(m.rate)))
    .map((m: any) => ({
      code: m.code || '',
      productName: m.productName || '',
      qty: num(m.qty),
      rate: num(m.rate),
    }));
}

/** Drop blank rows and coerce every measurement value to a trimmed string. */
function cleanMeasurementSets(input: JobCardBody['measurementSets'], partyName?: string) {
  if (!Array.isArray(input)) return undefined;
  const cleaned = input
    .map((set) => {
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(set?.values ?? {})) {
        if (v === null || v === undefined) continue;
        const str = String(v).trim();
        if (str) values[k] = str;
      }
      // Left blank by anyone who was not asked; stored as null rather than 0,
      // which would read as a newborn.
      const rawAge = (set as { age?: unknown })?.age;
      const age =
        rawAge === undefined || rawAge === null || rawAge === ''
          ? null
          : Math.max(0, num(rawAge));
      const materials = cleanMaterials((set as { materials?: unknown })?.materials);
      const name = String(set?.name ?? '').trim();
      return {
        // Kept as the client generated it, so the order lines that point at
        // this person still find them after a round trip.
        uid: (set as { uid?: string })?.uid || undefined,
        profileId: validObjectIdStr(set?.profileId),
        name,
        stitchingStyle: set?.stitchingStyle ? String(set.stitchingStyle).trim() : undefined,
        age,
        fabric: set?.fabric,
        size: set?.size,
        qty: Math.max(0, num(set?.qty, 1)),
        values,
        materials,
      };
    })
    // a row with nothing typed into it at all is an empty slot
    .filter(
      (set) =>
        set.name ||
        set.age !== null ||
        (set.fabric ?? '').trim() ||
        (set.size ?? '').trim() ||
        Object.keys(set.values).length > 0 ||
        set.materials.length > 0,
    );

  return cleaned.map((set, idx) => ({
    ...set,
    name: set.name || (idx === 0 ? (partyName?.trim() || 'Person 1') : `Person ${idx + 1}`),
  }));
}

export const jobCardRouter = Router();

// Every endpoint below requires a signed-in user.
jobCardRouter.use(requireAuth);

const DEFAULT_TAX_RATE = 5;

function searchFilter(q?: string, ledgerId?: string) {
  const trimmed = (q || '').trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = trimmed ? new RegExp(escaped, 'i') : null;

  let queryOr: Record<string, unknown>[] | null = null;
  if (trimmed && rx) {
    const isShortNumber = /^\d{1,2}$/.test(trimmed);
    queryOr = [
      { ref: rx },
      { partyName: rx },
    ];
    if (!isShortNumber) {
      queryOr.push({ phone: rx }, { invoiceNo: rx });
    }
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum) && trimmed !== '') {
      queryOr.push({ no: asNum }, { bookNo: asNum });
    }
    const digitMatches = trimmed.match(/\d+/g);
    if (digitMatches) {
      for (const d of digitMatches) {
        const n = Number(d);
        if (Number.isFinite(n)) {
          queryOr.push({ no: n }, { bookNo: n });
        }
      }
    }
  }

  if (ledgerId && Types.ObjectId.isValid(ledgerId)) {
    const custOr: Record<string, unknown>[] = [
      { ledgerId: new Types.ObjectId(ledgerId) },
    ];
    if (!queryOr) {
      return { $or: custOr };
    }
    return {
      $and: [
        { $or: custOr },
        { $or: queryOr },
      ],
    };
  }

  if (queryOr) {
    return { $or: queryOr };
  }
  return {};
}

interface JobCardBody {
  status?: string;
  additionalCharges?: number;
  additionalChargesType?: 'percent' | 'fixed';
  additionalChargesInput?: number;
  discountType?: 'percent' | 'fixed';
  discountInput?: number;
  bookNo?: number;
  ref?: string;
  date?: string;
  deliveryDate?: string;
  partyName?: string;
  phone?: string;
  ledgerId?: string;
  isNewCustomer?: boolean;
  accountsAc?: string;
  invoiceNo?: string;
  items?: {
    code?: string;
    productName?: string;
    qty?: number;
    rate?: number;
    personUid?: string;
    completed?: boolean;
    invoiced?: boolean;
    invoiceNo?: string;
  }[];
  discount?: number;
  taxRate?: number;
  measurements?: Record<string, string>;
  fabric?: string;
  size?: string;
  measurementSets?: {
    uid?: string;
    profileId?: string;
    name?: string;
    stitchingStyle?: string;
    age?: number | null;
    fabric?: string;
    size?: string;
    qty?: number;
    values?: Record<string, string>;
    /** Unticked on the form for a one-off who should not be kept on file. */
    remember?: boolean;
  }[];
  materialsUsed?: { code?: string; productName?: string; qty?: number; rate?: number }[];
  materialTotal?: number;
  jobCost?: number;
  paymentMode?: 'cash' | 'bank' | 'card';
  bank?: string;
  creditCardNo?: string;
}

/** Build the computed portions of a stitching order from the request body. */
function buildComputed(body: JobCardBody) {
  const taxRate = body.taxRate !== undefined ? num(body.taxRate, DEFAULT_TAX_RATE) : DEFAULT_TAX_RATE;
  const items = (body.items ?? [])
    .filter((i) => i && (i.code || i.productName || num(i.qty) || num(i.rate)))
    .map((i) => ({
      code: i.code || '',
      productName: i.productName || '',
      qty: num(i.qty),
      rate: num(i.rate),
      amount: lineAmount(num(i.qty), num(i.rate)),
      personUid: i.personUid || undefined,
      completed: Boolean(i.completed),
      invoiced: Boolean(i.invoiced),
      invoiceNo: i.invoiceNo || undefined,
    }));
  const rawTotal = r2(items.reduce((s, i) => s + (i.amount || 0), 0));
  const extraInput = num(body.additionalChargesInput, num(body.additionalCharges));
  const extraCharges =
    body.additionalChargesType === 'percent'
      ? r2((rawTotal * extraInput) / 100)
      : r2(extraInput);
  const dInput = num(body.discountInput, num(body.discount));
  const discountAmt =
    body.discountType === 'percent'
      ? r2((rawTotal * dInput) / 100)
      : r2(dInput);
  const totals = jobCardTotals(items, discountAmt, taxRate, extraCharges);
  // Legacy orders kept one shared list; materials now sit on each person.
  const materialsUsed = cleanMaterials(body.materialsUsed);
  const perPerson = (cleanMeasurementSets(body.measurementSets, body.partyName) ?? []).flatMap(
    (set) => set.materials,
  );
  const materialTotal =
    body.materialTotal !== undefined
      ? r2(num(body.materialTotal))
      : r2(
          [...materialsUsed, ...perPerson].reduce((s, m) => s + m.qty * m.rate, 0),
        );
  return { items, totals, materialsUsed, materialTotal, taxRate };
}

/**
 * Put everyone measured on this order on the customer's file.
 *
 * This belongs with the order rather than in a second call from the browser:
 * the two must either both happen or neither, and a browser that has already
 * moved on to the invoice cannot be relied on to make the second trip. The
 * same name under the same customer is one person, so re-ordering updates
 * their sizes instead of filing them twice.
 */
async function filePeople(
  ledgerId: string | undefined,
  sets: JobCardBody['measurementSets'],
): Promise<void> {
  const validLedgerId = validObjectIdStr(ledgerId);
  if (!validLedgerId || !Array.isArray(sets)) return;
  const keep = sets.filter((m) => m?.remember !== false && String(m?.name ?? '').trim());
  await Promise.all(
    keep.map((m) => {
      const name = String(m.name).trim();
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(m.values ?? {})) {
        const str = String(v ?? '').trim();
        if (str) values[k] = str;
      }
      const stitchingStyle = m.stitchingStyle ? String(m.stitchingStyle).trim() : '';
      const filter = {
        ledgerId: validLedgerId,
        name,
        stitchingStyle,
      };
      return MeasurementProfile.findOneAndUpdate(
        filter,
        {
          $set: { values, stitchingStyle, archived: false, lastUsedAt: new Date() },
          $setOnInsert: { ledgerId: validLedgerId, name },
        },
        { upsert: true, runValidators: true },
      );
    }),
  );
}

// GET /jobcards?q=&status=&page=&limit=
jobCardRouter.get(
  '/',
  requirePerm('jobcards.view'),
  asyncHandler(async (req, res) => {
    const { q, status, ledgerId } = req.query as { q?: string; status?: string; ledgerId?: string };
    const page = Math.max(num(req.query.page, 1), 1);
    const limit = Math.min(Math.max(num(req.query.limit, 30), 1), 200);
    const filter: Record<string, unknown> = { ...searchFilter(q, ledgerId) };
    // Drafts are no longer a thing the form can make. Older ones are still on
    // file, but they are not orders and have no business in this list.
    if (status && status !== 'draft') {
      if (status === 'delivered') {
        filter.status = { $in: ['delivered', 'converted'] };
      } else {
        filter.status = status;
      }
    } else {
      filter.status = { $ne: 'draft' };
    }
    const [items, total] = await Promise.all([
      JobCard.find(filter).sort({ no: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      JobCard.countDocuments(filter),
    ]);
    res.json({ items, total, page, limit });
  }),
);

// GET /jobcards/next -> { no, ref, bookNo } (peek, does not consume)
jobCardRouter.get(
  '/next',
  requirePerm('jobcards.view'),
  asyncHandler(async (_req, res) => {
    const no = await peekSeq('jobcard', 0);
    const bookNo = await peekSeq('book_no', 0);
    res.json({ no, ref: `${REF_PREFIX}-${no}`, bookNo });
  }),
);

// GET /jobcards/adjacent?no=13258&dir=prev|next
jobCardRouter.get(
  '/adjacent',
  requirePerm('jobcards.view'),
  asyncHandler(async (req, res) => {
    const no = num(req.query.no);
    const dir = req.query.dir === 'next' ? 'next' : 'prev';
    // `$type: 'number'` keeps drafts out: they carry no order number, and a
    // missing field compares as null, which sorts below every number — so
    // without this, stepping back from the lowest order lands on a draft.
    const doc = await JobCard.findOne(
      dir === 'prev'
        ? { no: { $type: 'number', $lt: no } }
        : { no: { $type: 'number', $gt: no } },
    )
      .sort({ no: dir === 'prev' ? -1 : 1 })
      .lean();
    if (!doc) throw new HttpError(404, 'No further stitching order');
    res.json(doc);
  }),
);

// GET /jobcards/payments/all -> flattened payment history across stitching orders
jobCardRouter.get(
  '/payments/all',
  requirePerm('payments.view'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(num(req.query.limit, 100), 1), 500);
    const cards = await JobCard.find({ 'payments.0': { $exists: true } })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
    const payments = cards.flatMap((c: any) =>
      ((c.payments ?? []) as any[]).map((p: any) => ({
        jobCardNo: c.no,
        jobCardRef: c.ref,
        jobCardId: c._id,
        partyName: c.partyName,
        date: p.date,
        mode: p.mode,
        amount: p.amount,
        bank: p.bank,
        reference: p.reference,
        discount: p.discount,
      })),
    );
    payments.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    res.json({ items: payments.slice(0, limit) });
  }),
);

// POST /jobcards
jobCardRouter.post(
  '/',
  requirePerm('jobcards.create'),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as JobCardBody;
    // Sequential unique book number:
    let bookNo =
      body.bookNo !== undefined && body.bookNo !== null && !isNaN(Number(body.bookNo))
        ? num(body.bookNo)
        : await nextSeq('book_no');

    // Duplicate book number check:
    const duplicateBook = await JobCard.findOne({ bookNo });
    if (duplicateBook) {
      throw new HttpError(
        400,
        `Book No ${bookNo} already exists on Order ${duplicateBook.no ?? duplicateBook.ref}. Duplicate book numbers are not allowed.`,
      );
    }
    await Counter.updateOne({ _id: 'book_no' }, { $max: { seq: bookNo } }, { upsert: true });

    // Every order written here is a real order and takes the next number in
    // the shop's sequence. Nothing is saved part-finished any more.
    const no = await nextSeq('jobcard');
    const computed = buildComputed(body);
    const advance = r2(
      ((body as { advance?: number }).advance !== undefined
        ? num((body as { advance?: number }).advance)
        : 0) + 0,
    );
    const advSplit = advanceSplit(advance, computed.taxRate);
    const jobCard = await JobCard.create({
      no,
      bookNo,
      ref: body.ref?.trim() || `${REF_PREFIX}-${no}`,
      date: body.date && !isNaN(new Date(body.date).getTime()) ? new Date(body.date) : new Date(),
      deliveryDate: body.deliveryDate && !isNaN(new Date(body.deliveryDate).getTime()) ? new Date(body.deliveryDate) : undefined,
      partyName: body.partyName?.trim(),
      phone: body.phone?.trim(),
      ledgerId: validObjectIdStr(body.ledgerId),
      isNewCustomer: !!body.isNewCustomer,
      accountsAc: body.accountsAc?.trim(),
      invoiceNo: body.invoiceNo?.trim(),
      items: computed.items,
      total: computed.totals.total,
      additionalCharges: computed.totals.additionalCharges,
      additionalChargesType: body.additionalChargesType === 'percent' ? 'percent' : 'fixed',
      additionalChargesInput: body.additionalChargesInput !== undefined ? r2(num(body.additionalChargesInput)) : computed.totals.additionalCharges,
      discount: computed.totals.discount,
      discountType: body.discountType === 'percent' ? 'percent' : 'fixed',
      discountInput: body.discountInput !== undefined ? r2(num(body.discountInput)) : computed.totals.discount,
      tax: computed.totals.tax,
      netAmount: computed.totals.netAmount,
      measurements: body.measurements ?? {},
      fabric: body.fabric,
      size: body.size,
      measurementSets: cleanMeasurementSets(body.measurementSets, body.partyName) ?? [],
      materialsUsed: computed.materialsUsed,
      materialTotal: computed.materialTotal,
      jobCost: r2(num(body.jobCost)),
      advance: advSplit.advance,
      advanceBeforeTax: advSplit.advanceBeforeTax,
      advanceTax: advSplit.advanceTax,
      balance: r2(computed.totals.netAmount - advSplit.advance),
      paymentMode: body.paymentMode || 'cash',
      bank: body.bank,
      creditCardNo: body.creditCardNo,
      payments: [],
      status: computed.items.some((i: any) => i.completed) ? 'partially_ready' : 'open',
    });
    await filePeople(body.ledgerId, body.measurementSets);
    await recordAudit(req, {
      action: 'create',
      doc: jobCard,
      summary: `Order ${jobCard.no} created for ${jobCard.partyName || 'no customer'}`,
    });
    res.status(201).json(jobCard);
  }),
);

// GET /jobcards/:id
jobCardRouter.get(
  '/:id',
  requirePerm('jobcards.view'),
  asyncHandler(async (req, res) => {
    const doc: any = await JobCard.findById(req.params.id).lean();
    if (!doc) throw new HttpError(404, 'Stitching order not found');

    const sales = await Sale.find({
      $or: [{ jobCardId: doc._id }, { jobCardRef: doc.ref }],
    }).lean();

    if (sales.length > 0 && Array.isArray(doc.items)) {
      const soldItems: any[] = sales.flatMap((s: any) => s.items || []);
      const usedAdvance = sales.reduce((sum: number, s: any) => sum + (s.advanceAmount || 0), 0);
      (doc as any).remainingAdvance = Math.max(0, r2(num(doc.advance) - usedAdvance));

      for (const item of doc.items as any[]) {
        if (item.invoiced) continue;
        const soldMatch = soldItems.find(
          (s: any) =>
            !s._matched &&
            s.code !== 'EXTRA' &&
            s.productName !== 'Additional Charges' &&
            s.status !== 'pending' &&
            s.completed !== false &&
            ((item.code && s.code && item.code === s.code) ||
              (item.productName &&
                s.productName &&
                item.productName.trim().toLowerCase() === s.productName.trim().toLowerCase())),
        );
        if (soldMatch) {
          soldMatch._matched = true;
          item.invoiced = true;
          item.completed = true;
          if (!item.invoiceNo && soldMatch.billNo) {
            item.invoiceNo = `B-${soldMatch.billNo}`;
          }
        }
      }

      const allInvoiced = doc.items.length > 0 && doc.items.every((i: any) => i.invoiced);
      const hasUnfinished = doc.items.some((i: any) => !i.completed || !i.invoiced);
      const hasInvoicedOrCompleted = doc.items.some((i: any) => i.invoiced || i.completed);

      if (allInvoiced && !doc.items.some((i: any) => !i.completed)) {
        if (doc.status !== 'delivered' && doc.status !== 'deleted') {
          doc.status = 'delivered';
          await JobCard.updateOne(
            { _id: doc._id },
            { $set: { status: 'delivered', items: doc.items } },
          );
        }
      } else if (hasInvoicedOrCompleted && hasUnfinished) {
        if (doc.status !== 'partially_ready' && doc.status !== 'deleted') {
          doc.status = 'partially_ready';
          await JobCard.updateOne(
            { _id: doc._id },
            { $set: { status: 'partially_ready', items: doc.items } },
          );
        }
      }
    } else {
      (doc as any).remainingAdvance = num(doc.advance);
    }

    res.json(doc);
  }),
);

// PUT /jobcards/:id
jobCardRouter.put(
  '/:id',
  requirePerm('jobcards.edit'),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as JobCardBody & { advance?: number };
    const existing = await JobCard.findById(req.params.id);
    if (!existing) throw new HttpError(404, 'Order not found');
    if (existing.status === 'converted' || existing.status === 'delivered')
      throw new HttpError(400, 'Delivered orders cannot be edited');
    if (existing.status === 'deleted')
      throw new HttpError(400, 'Deleted orders cannot be edited');

    // Taken before any field is touched — this is the 'from' side of the log.
    const before = snapshotJobCard(existing.toObject());

    const computed = buildComputed(body);

    // 1. Preserve invoiced status from existing items in DB
    if (Array.isArray(existing.items)) {
      for (const item of computed.items) {
        if (!item.invoiced) {
          const prev = existing.items.find(
            (e: any) =>
              e.invoiced &&
              ((item.code && e.code && item.code === e.code) ||
                (item.productName &&
                  e.productName &&
                  item.productName.trim().toLowerCase() === e.productName.trim().toLowerCase())),
          );
          if (prev) {
            item.invoiced = true;
            item.completed = true;
            item.invoiceNo = prev.invoiceNo;
          }
        }
      }
    }

    // 2. Cross-reference all linked sales for this order
    const linkedSales = await Sale.find({
      $or: [{ jobCardId: existing._id }, { jobCardRef: existing.ref }],
    }).lean();
    if (linkedSales.length > 0) {
      const allSold: any[] = linkedSales.flatMap((s: any) =>
        (s.items || []).map((it: any) => ({ ...it, billNo: s.billNo })),
      );
      for (const item of computed.items) {
        if (!item.invoiced) {
          const matchSold = allSold.find(
            (s: any) =>
              !s._matched &&
              s.code !== 'EXTRA' &&
              s.productName !== 'Additional Charges' &&
              s.status !== 'pending' &&
              s.completed !== false &&
              ((item.code && s.code && item.code === s.code) ||
                (item.productName &&
                  s.productName &&
                  item.productName.trim().toLowerCase() === s.productName.trim().toLowerCase())),
          );
          if (matchSold) {
            matchSold._matched = true;
            item.invoiced = true;
            item.completed = true;
            if (!item.invoiceNo && matchSold.billNo) {
              item.invoiceNo = `B-${matchSold.billNo}`;
            }
          }
        }
      }
    }

    const allInvoiced = computed.items.length > 0 && computed.items.every((i: any) => i.invoiced);
    const hasUninvoicedPending = computed.items.some((i: any) => !i.invoiced || !i.completed);
    const hasInvoicedOrCompleted = computed.items.some((i: any) => i.invoiced || i.completed);

    const paymentsTotal = r2(
      existing.payments.reduce((s: number, p: any) => s + num(p.amount), 0),
    );
    // Advance may also be nudged directly; otherwise it follows recorded payments.
    const advance =
      body.advance !== undefined ? r2(num(body.advance)) : paymentsTotal;
    const advSplit = advanceSplit(advance, computed.taxRate);

    if (body.measurements && existing.measurements) {
      Object.assign(existing.measurements, body.measurements);
    }

    let bookNo = existing.bookNo;
    if (body.bookNo !== undefined && body.bookNo !== null && !isNaN(Number(body.bookNo))) {
      const candidate = num(body.bookNo);
      if (candidate !== existing.bookNo) {
        const duplicateBook = await JobCard.findOne({
          bookNo: candidate,
          _id: { $ne: existing._id },
        });
        if (duplicateBook) {
          throw new HttpError(
            400,
            `Book No ${candidate} already exists on Order ${duplicateBook.no ?? duplicateBook.ref}. Duplicate book numbers are not allowed.`,
          );
        }
        bookNo = candidate;
        await Counter.updateOne({ _id: 'book_no' }, { $max: { seq: candidate } }, { upsert: true });
      }
    }

    existing.set({
      bookNo,
      ref: body.ref?.trim() || existing.ref,
      date: body.date ? new Date(body.date) : existing.date,
      deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : existing.deliveryDate,
      partyName: body.partyName?.trim() ?? existing.partyName,
      phone: body.phone?.trim() ?? existing.phone,
      ledgerId: body.ledgerId !== undefined ? validObjectIdStr(body.ledgerId) : existing.ledgerId,
      isNewCustomer: body.isNewCustomer !== undefined ? !!body.isNewCustomer : existing.isNewCustomer,
      accountsAc: body.accountsAc?.trim() ?? existing.accountsAc,
      invoiceNo: body.invoiceNo?.trim() ?? existing.invoiceNo,
      items: computed.items,
      total: computed.totals.total,
      additionalCharges: computed.totals.additionalCharges,
      additionalChargesType: body.additionalChargesType
        ? (body.additionalChargesType === 'percent' ? 'percent' : 'fixed')
        : (existing as any).additionalChargesType,
      additionalChargesInput: body.additionalChargesInput !== undefined
        ? r2(num(body.additionalChargesInput))
        : (existing as any).additionalChargesInput,
      discount: computed.totals.discount,
      discountType: body.discountType
        ? (body.discountType === 'percent' ? 'percent' : 'fixed')
        : (existing as any).discountType,
      discountInput: body.discountInput !== undefined
        ? r2(num(body.discountInput))
        : (existing as any).discountInput,
      tax: computed.totals.tax,
      netAmount: computed.totals.netAmount,
      measurements: existing.measurements,
      fabric: body.fabric ?? existing.fabric,
      size: body.size ?? existing.size,
      measurementSets: cleanMeasurementSets(body.measurementSets, body.partyName ?? existing.partyName) ?? existing.measurementSets,
      materialsUsed: computed.materialsUsed,
      materialTotal: computed.materialTotal,
      jobCost: body.jobCost !== undefined ? r2(num(body.jobCost)) : existing.jobCost,
      advance: advSplit.advance,
      advanceBeforeTax: advSplit.advanceBeforeTax,
      advanceTax: advSplit.advanceTax,
      balance: r2(computed.totals.netAmount - advSplit.advance),
      paymentMode: body.paymentMode || existing.paymentMode,
      bank: body.bank ?? existing.bank,
      creditCardNo: body.creditCardNo ?? existing.creditCardNo,
      // Status transition: if all items are invoiced, status is delivered!
      status: (() => {
        if (existing.status === 'deleted') {
          return existing.status;
        }
        if (allInvoiced && !computed.items.some((i: any) => !i.completed)) {
          return 'delivered';
        }
        if (hasInvoicedOrCompleted) {
          return hasUninvoicedPending ? 'partially_ready' : 'ready';
        }
        if (body.status && ['open', 'partially_ready', 'ready', 'closed', 'delivered'].includes(body.status)) {
          return body.status as any;
        }
        return existing.status;
      })(),
    });
    existing.markModified('items');
    await existing.save();
    await filePeople(String(existing.ledgerId ?? ''), body.measurementSets);
    await recordAudit(req, {
      action: 'update',
      doc: existing,
      changes: diffSnapshots(before, snapshotJobCard(existing.toObject())),
    });
    res.json(existing);
  }),
);

// DELETE /jobcards/:id (soft delete)
jobCardRouter.delete(
  '/:id',
  requirePerm('jobcards.edit'),
  asyncHandler(async (req, res) => {
    const existing = await JobCard.findById(req.params.id);
    if (!existing) throw new HttpError(404, 'Stitching order not found');

    const before = snapshotJobCard(existing.toObject());
    existing.status = 'deleted';
    existing.isDeleted = true;
    existing.deletedAt = new Date();
    // @ts-ignore
    existing.deletedBy = req.user?.username || req.user?.name || req.user?.id;
    await existing.save();

    await recordAudit(req, {
      action: 'delete',
      doc: existing,
      changes: diffSnapshots(before, snapshotJobCard(existing.toObject())),
      summary: `Order #${existing.no ?? existing.ref} deleted (status: deleted)`,
    });

    res.json({ ok: true, message: 'Order deleted successfully' });
  }),
);

interface PaymentBody {
  date?: string;
  mode?: 'cash' | 'bank' | 'card' | 'credit';
  amount?: number;
  bank?: string;
  reference?: string;
  discount?: number;
  note?: string;
  taxRate?: number;
  cardHolder?: string;
  /** Accepted so a client need not mask it itself; only the last four is kept. */
  cardNumber?: string;
  cardLast4?: string;
  cardExpiry?: string;
  accountName?: string;
  iban?: string;
  swift?: string;
}

/**
 * The parts of a card or transfer worth keeping on the payment.
 *
 * A card number is reduced to its last four here no matter what arrived, and a
 * CVC is not a field at all — storing either after a payment is forbidden, and
 * neither is any use for matching a statement line later.
 */
function tenderDetails(p: PaymentBody) {
  if (p.mode === 'card') {
    return {
      cardHolder: p.cardHolder?.trim() || undefined,
      cardLast4:
        String(p.cardLast4 ?? p.cardNumber ?? '').replace(/\D/g, '').slice(-4) || undefined,
      cardExpiry: p.cardExpiry?.trim() || undefined,
    };
  }
  if (p.mode === 'bank') {
    return {
      accountName: p.accountName?.trim() || undefined,
      iban: p.iban?.replace(/\s+/g, '').toUpperCase() || undefined,
      swift: p.swift?.trim().toUpperCase() || undefined,
    };
  }
  return {};
}

function applyPayment(doc: {
  payments: {
    date: Date;
    mode: string;
    amount: number;
    bank?: string;
    reference?: string;
    discount: number;
    note?: string;
    cardHolder?: string;
    cardLast4?: string;
    cardExpiry?: string;
    accountName?: string;
    iban?: string;
    swift?: string;
  }[];
  advance: number;
  advanceBeforeTax: number;
  advanceTax: number;
  balance: number;
  netAmount: number;
}, p: PaymentBody, taxRate: number) {
  const amount = r2(num(p.amount));
  if (amount <= 0 && num(p.discount) <= 0)
    throw new HttpError(400, 'Payment amount must be greater than zero');
  doc.payments.push({
    date: p.date ? new Date(p.date) : new Date(),
    mode: p.mode || 'cash',
    amount,
    bank: p.bank,
    reference: p.reference,
    discount: r2(num(p.discount)),
    note: p.note,
    ...tenderDetails(p),
  });
  const advSplit = advanceSplit(
    r2(doc.advance + amount),
    taxRate,
  );
  doc.advance = advSplit.advance;
  doc.advanceBeforeTax = advSplit.advanceBeforeTax;
  doc.advanceTax = advSplit.advanceTax;
  doc.balance = r2(doc.netAmount - advSplit.advance);
}

// POST /jobcards/:id/payments
jobCardRouter.post(
  '/:id/payments',
  requirePerm('jobcards.payment'),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as PaymentBody;
    const doc = await JobCard.findById(req.params.id);
    if (!doc) throw new HttpError(404, 'Stitching order not found');
    if (doc.status === 'converted' || doc.status === 'delivered')
      throw new HttpError(400, 'Stitching order already delivered');
    applyPayment(doc, body, DEFAULT_TAX_RATE);
    await doc.save();
    await recordAudit(req, {
      action: 'payment',
      doc,
      summary: `Payment of ${r2(num(body.amount))} by ${body.mode || 'cash'}${
        num(body.discount) > 0 ? ` (discount ${r2(num(body.discount))})` : ''
      }`,
    });
    res.status(201).json(doc);
  }),
);

// PATCH /jobcards/:id/status
jobCardRouter.patch(
  '/:id/status',
  requirePerm('jobcards.edit'),
  asyncHandler(async (req, res) => {
    const { status } = req.body as { status: string };
    const valid = ['open', 'partially_ready', 'ready', 'closed', 'delivered'];
    if (!valid.includes(status)) {
      throw new HttpError(400, `Invalid status. Allowed: ${valid.join(', ')}`);
    }
    const doc = await JobCard.findById(req.params.id);
    if (!doc) throw new HttpError(404, 'Stitching order not found');
    const before = snapshotJobCard(doc.toObject());

    doc.status = status as any;
    if (status === 'closed' || status === 'ready') {
      doc.closedAt = new Date();
      if (doc.items && doc.items.length > 0) {
        doc.items.forEach((item: any) => {
          item.completed = true;
        });
      }
    } else if (status === 'open') {
      doc.closedAt = undefined;
      if (doc.items && doc.items.length > 0) {
        doc.items.forEach((item: any) => {
          if (!item.invoiced) {
            item.completed = false;
          }
        });
      }
    } else if (status === 'delivered') {
      doc.closedAt = new Date();
      if (doc.items && doc.items.length > 0) {
        doc.items.forEach((item: any) => {
          item.completed = true;
          item.invoiced = true;
        });
      }
    } else if (status === 'partially_ready') {
      doc.closedAt = undefined;
      if (doc.items && doc.items.length > 0) {
        const hasCompleted = doc.items.some((i: any) => i.completed);
        if (!hasCompleted) {
          doc.items[0].completed = true;
        }
      }
    }

    await doc.save();
    await recordAudit(req, {
      action: 'update',
      doc,
      changes: diffSnapshots(before, snapshotJobCard(doc.toObject())),
      summary: `Order #${doc.no ?? doc.ref} status changed to ${status}`,
    });
    res.json(doc);
  }),
);

// POST /jobcards/:id/close
jobCardRouter.post(
  '/:id/close',
  requirePerm('jobcards.edit'),
  asyncHandler(async (req, res) => {
    const doc = await JobCard.findById(req.params.id);
    if (!doc) throw new HttpError(404, 'Stitching order not found');
    const before = snapshotJobCard(doc.toObject());
    doc.status = 'closed';
    doc.closedAt = new Date();
    if (doc.items && doc.items.length > 0) {
      doc.items.forEach((item: any) => {
        item.completed = true;
      });
    }
    await doc.save();
    await recordAudit(req, {
      action: 'close',
      doc,
      changes: diffSnapshots(before, snapshotJobCard(doc.toObject())),
      summary: `Order #${doc.no ?? doc.ref} marked as Complete`,
    });
    res.json(doc);
  }),
);

// POST /jobcards/:id/complete
jobCardRouter.post(
  '/:id/complete',
  requirePerm('jobcards.edit'),
  asyncHandler(async (req, res) => {
    const doc = await JobCard.findById(req.params.id);
    if (!doc) throw new HttpError(404, 'Stitching order not found');
    const before = snapshotJobCard(doc.toObject());
    doc.status = 'closed';
    doc.closedAt = new Date();
    if (doc.items && doc.items.length > 0) {
      doc.items.forEach((item: any) => {
        item.completed = true;
      });
    }
    await doc.save();
    await recordAudit(req, {
      action: 'close',
      doc,
      changes: diffSnapshots(before, snapshotJobCard(doc.toObject())),
      summary: `Order #${doc.no ?? doc.ref} marked as Complete`,
    });
    res.json(doc);
  }),
);

// POST /jobcards/:id/reopen
jobCardRouter.post(
  '/:id/reopen',
  requirePerm('jobcards.close'),
  asyncHandler(async (req, res) => {
    const doc = await JobCard.findById(req.params.id);
    if (!doc) throw new HttpError(404, 'Stitching order not found');
    if (doc.status !== 'closed') throw new HttpError(400, 'Only closed stitching orders can be reopened');
    doc.status = 'open';
    doc.closedAt = undefined;
    await doc.save();
    await recordAudit(req, { action: 'reopen', doc, summary: 'Order reopened' });
    res.json(doc);
  }),
);

// POST /jobcards/:id/pending
jobCardRouter.post(
  '/:id/pending',
  requirePerm('jobcards.edit'),
  asyncHandler(async (req, res) => {
    const doc = await JobCard.findById(req.params.id);
    if (!doc) throw new HttpError(404, 'Stitching order not found');
    const before = snapshotJobCard(doc.toObject());
    doc.status = 'open';
    doc.closedAt = undefined;
    doc.isDeleted = false;
    doc.deletedAt = undefined;
    // @ts-ignore
    doc.deletedBy = undefined;
    await doc.save();
    await recordAudit(req, {
      action: 'update',
      doc,
      changes: diffSnapshots(before, snapshotJobCard(doc.toObject())),
      summary: `Order #${doc.no ?? doc.ref} marked as Pending (open)`,
    });
    res.json(doc);
  }),
);

interface ConvertBody {
  payment?: PaymentBody;
  paymentType?: 'cash' | 'credit';
  salesman?: string;
  billDate?: string;
  taxRate?: number;
}

/**
 * Turn one order into a sales bill and mark it converted. Shared by the single
 * and bulk convert routes so both produce exactly the same bill.
 */
async function convertToSale(doc: any, body: ConvertBody) {
    const taxRate =
      body.taxRate !== undefined ? num(body.taxRate, DEFAULT_TAX_RATE) : DEFAULT_TAX_RATE;
    if (body.payment) applyPayment(doc, body.payment, taxRate);

    const uninvoiced = ((doc.items as any[]) ?? []).filter((i: any) => !i.invoiced);
    const isPartiallyProcessed =
      doc.status === 'partially_ready' ||
      Boolean(doc.invoiceNo) ||
      ((doc.items as any[]) ?? []).some((i: any) => i.invoiced || i.completed);

    const finalItems = isPartiallyProcessed
      ? uninvoiced.filter((i: any) => Boolean(i.completed))
      : uninvoiced;

    if (finalItems.length === 0) {
      throw new HttpError(
        400,
        isPartiallyProcessed
          ? 'No completed items ready to invoice in this order. Please mark items as Complete first.'
          : 'All items in this order have already been invoiced',
      );
    }

    const items = finalItems.map((i: any) => {
      const grossAmt = r2(i.amount);
      const taxAmt = r2(grossAmt * (taxRate / 100));
      const netAmount = r2(grossAmt + taxAmt);
      return {
        code: i.code,
        productName: i.productName,
        qty: i.qty,
        rate: i.rate,
        netRate: i.qty ? r2(netAmount / i.qty) : 0,
        discPercent: 0,
        discAmt: 0,
        grossAmt,
        taxPercent: taxRate,
        taxAmt,
        netAmount,
        info: i.completed ? 'Ready' : (doc.status === 'partially_ready' ? 'Pending' : undefined),
      };
    });
    const totQty = r2(items.reduce((s: number, i: any) => s + i.qty, 0));
    // The order's additional charge rides onto the bill as freight, taxed the
    // same way, so the invoice comes to what the order said it would.
    const extra = r2(num(doc.additionalCharges));
    const extraTax = r2(extra * (taxRate / 100));
    const grossAmount = r2(items.reduce((s: number, i: any) => s + i.grossAmt, 0) + extra);
    const taxAmtTotal = r2(items.reduce((s: number, i: any) => s + i.taxAmt, 0) + extraTax);
    const netAmount = r2(grossAmount + taxAmtTotal);
    const advanceAmount = r2(doc.advance);

    const billNo = await nextSeq('sale');
    const sale = await Sale.create({
      billNo,
      billDate: body.billDate ? new Date(body.billDate) : new Date(),
      saleType: 'retail',
      paymentType: body.paymentType || (r2(netAmount - advanceAmount) > 0 ? 'credit' : 'cash'),
      category: 'A',
      jobCardRef: doc.ref,
      jobCardId: doc._id,
      salesman: body.salesman || 'GENERAL',
      partyName: doc.partyName,
      phone: doc.phone,
      ledgerId: doc.ledgerId,
      items,
      totQty,
      grossAmount,
      discountAmt: 0,
      additionalDiscount: 0,
      taxAmt: taxAmtTotal,
      freight: extra,
      advanceAmount,
      netAmount,
      balance: r2(netAmount - advanceAmount),
      isReturn: false,
    });

    for (const it of finalItems) {
      it.invoiced = true;
      it.completed = true;
      it.invoiceNo = `B-${billNo}`;
    }

    const allInvoiced = (doc.items as any[])?.every((i: any) => i.invoiced);
    const hasPendingItems = (doc.items as any[])?.some((i: any) => !i.invoiced || !i.completed);
    if (allInvoiced) {
      doc.status = 'delivered';
    } else if (hasPendingItems) {
      doc.status = 'partially_ready';
    } else {
      doc.status = 'ready';
    }
    if (!doc.invoiceNo?.includes(`B-${billNo}`)) {
      doc.invoiceNo = doc.invoiceNo ? `${doc.invoiceNo}, B-${billNo}` : `B-${billNo}`;
    }
    await doc.save();

    return sale;
}

// POST /jobcards/:id/convert -> creates a Sale, marks the order delivered
jobCardRouter.post(
  '/:id/convert',
  requirePerm('jobcards.convert'),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as ConvertBody;
    const doc = await JobCard.findById(req.params.id);
    if (!doc) throw new HttpError(404, 'Order not found');
    if (doc.status === 'converted' || doc.status === 'delivered') throw new HttpError(400, 'Order already converted to sales / delivered');
    if (doc.status === 'draft')
      throw new HttpError(400, 'This order is still a draft — finish and save it first');
    if (body.paymentType === 'cash' && doc.netAmount - doc.advance !== 0)
      throw new HttpError(400, 'Cash conversion requires exact advance payment settlement');

    const sale = await convertToSale(doc, body);
    await recordAudit(req, {
      action: 'convert',
      doc,
      summary: `Converted to sales bill B-${sale.billNo}`,
    });
    res.status(201).json({ jobCard: doc, sale });
  }),
);

interface ConvertBulkBody extends ConvertBody {
  ids?: unknown;
}

/**
 * POST /jobcards/convert-bulk -> convert a selection in one go.
 *
 * Each order is converted on its own so one bad row cannot sink the rest; the
 * response reports per-order outcomes rather than a single pass/fail. Bills are
 * minted one at a time because each needs its own number from the counter.
 */
jobCardRouter.post(
  '/convert-bulk',
  requirePerm('jobcards.convert'),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as ConvertBulkBody;
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (ids.length === 0) throw new HttpError(400, 'Select at least one order to convert');
    if (ids.length > 100) throw new HttpError(400, 'Convert at most 100 orders at a time');

    const converted: { id: string; no: number; billNo: number }[] = [];
    const skipped: { id: string; no?: number; reason: string }[] = [];

    for (const id of ids) {
      try {
        const doc = await JobCard.findById(id);
        if (!doc) {
          skipped.push({ id, reason: 'Order not found' });
          continue;
        }
        if (doc.status === 'converted' || doc.status === 'delivered') {
          skipped.push({ id, no: doc.no, reason: 'Already delivered' });
          continue;
        }
        if (doc.status === 'draft') {
          skipped.push({ id, no: doc.no, reason: 'Still a draft — finish and save it first' });
          continue;
        }
        if (doc.status !== 'open' && doc.status !== 'ready' && doc.status !== 'partially_ready' && doc.status !== 'closed') {
          skipped.push({ id, no: doc.no, reason: 'Reopen the order before converting' });
          continue;
        }
        // A bulk run never records a payment — it bills the order as it stands.
        const sale = await convertToSale(doc, { salesman: body.salesman, taxRate: body.taxRate });
        await recordAudit(req, {
          action: 'convert',
          doc,
          summary: `Converted to sales bill B-${sale.billNo} (bulk)`,
        });
        converted.push({ id, no: doc.no, billNo: sale.billNo });
      } catch (e) {
        skipped.push({ id, reason: e instanceof Error ? e.message : 'Convert failed' });
      }
    }

    res.json({ converted, skipped });
  }),
);
