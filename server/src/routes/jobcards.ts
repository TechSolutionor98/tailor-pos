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

function searchFilter(q?: string) {
  if (!q) return {};
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const or: Record<string, unknown>[] = [
    { ref: rx },
    { partyName: rx },
    { phone: rx },
    { invoiceNo: rx },
  ];
  const asNum = Number(q);
  if (Number.isFinite(asNum) && q.trim() !== '') or.push({ no: asNum });
  return { $or: or };
}

interface JobCardBody {
  status?: string;
  additionalCharges?: number;
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
    }));
  const totals = jobCardTotals(items, num(body.discount), taxRate, num(body.additionalCharges));
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
    const { q, status } = req.query as { q?: string; status?: string };
    const page = Math.max(num(req.query.page, 1), 1);
    const limit = Math.min(Math.max(num(req.query.limit, 30), 1), 200);
    const filter: Record<string, unknown> = { ...searchFilter(q) };
    // Drafts are no longer a thing the form can make. Older ones are still on
    // file, but they are not orders and have no business in this list.
    filter.status = status && status !== 'draft' ? status : { $ne: 'draft' };
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
    const no = await peekSeq('jobcard', 13258);
    const bookNo = await peekSeq('book_no', 270);
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
      discount: computed.totals.discount,
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
      status: 'open',
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
    const doc = await JobCard.findById(req.params.id).lean();
    if (!doc) throw new HttpError(404, 'Stitching order not found');
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
    if (existing.status === 'converted')
      throw new HttpError(400, 'Converted orders cannot be edited');
    if (existing.status === 'deleted')
      throw new HttpError(400, 'Deleted orders cannot be edited');

    // Taken before any field is touched — this is the 'from' side of the log.
    const before = snapshotJobCard(existing.toObject());

    const computed = buildComputed(body);
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
      discount: computed.totals.discount,
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
      // The status is not the form's to move — closing and converting have
      // their own routes.
      status: existing.status,
    });
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
    if (doc.status === 'converted')
      throw new HttpError(400, 'Stitching order already converted to sales');
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

// POST /jobcards/:id/close
jobCardRouter.post(
  '/:id/close',
  requirePerm('jobcards.close'),
  asyncHandler(async (req, res) => {
    const doc = await JobCard.findById(req.params.id);
    if (!doc) throw new HttpError(404, 'Stitching order not found');
    if (doc.status !== 'open') throw new HttpError(400, 'Only open stitching orders can be closed');
    doc.status = 'closed';
    doc.closedAt = new Date();
    await doc.save();
    await recordAudit(req, { action: 'close', doc, summary: 'Order closed' });
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

    const billNo = await nextSeq('sale');
    const items = (doc.items as any[]).map((i: any) => {
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

    doc.status = 'converted';
    doc.invoiceNo = `B-${billNo}`;
    await doc.save();

    return sale;
}

// POST /jobcards/:id/convert -> creates a Sale, marks the order converted
jobCardRouter.post(
  '/:id/convert',
  requirePerm('jobcards.convert'),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as ConvertBody;
    const doc = await JobCard.findById(req.params.id);
    if (!doc) throw new HttpError(404, 'Order not found');
    if (doc.status === 'converted') throw new HttpError(400, 'Order already converted to sales');
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
        if (doc.status === 'converted') {
          skipped.push({ id, no: doc.no, reason: 'Already converted' });
          continue;
        }
        if (doc.status === 'draft') {
          skipped.push({ id, no: doc.no, reason: 'Still a draft — finish and save it first' });
          continue;
        }
        if (doc.status !== 'open') {
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
