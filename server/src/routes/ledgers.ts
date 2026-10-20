import { Router } from 'express';
import { Types } from 'mongoose';
import { Ledger } from '../models/Ledger';
import { JobCard } from '../models/JobCard';
import { Sale } from '../models/Sale';
import { nextSeq } from '../models/Counter';
import { asyncHandler, HttpError } from '../middleware';
import { num, r2 } from '../utils/money';
import { requireAuth, requirePerm } from '../auth/guard';

export const ledgerRouter = Router();

// Every endpoint below requires a signed-in user.
ledgerRouter.use(requireAuth);

async function buildLedgerSearchFilter(q?: string): Promise<{ filter: Record<string, unknown>; matchedLedgerIds: Set<string> }> {
  if (!q || !q.trim()) return { filter: {}, matchedLedgerIds: new Set() };
  const trimmed = q.trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(escaped, 'i');

  const isShortNumber = /^\d{1,2}$/.test(trimmed);

  const ledgerOr: Record<string, unknown>[] = [
    { name: rx },
    { contactId: rx },
    { businessName: rx },
  ];

  if (!isShortNumber) {
    ledgerOr.push(
      { phone: rx },
      { altPhone: rx },
      { landline: rx },
    );
  }

  // Extract any digits for book number, order number, or invoice number searches
  const digitMatches = trimmed.match(/\d+/g);
  const numbers = digitMatches ? digitMatches.map(Number).filter(Number.isFinite) : [];

  const jcOr: Record<string, unknown>[] = [
    { ref: rx },
    { partyName: rx },
  ];
  if (!isShortNumber) {
    jcOr.push({ phone: rx }, { invoiceNo: rx });
  }
  if (numbers.length > 0) {
    for (const n of numbers) {
      jcOr.push({ no: n }, { bookNo: n });
    }
  }

  const saleOr: Record<string, unknown>[] = [
    { refNo: rx },
    { jobCardRef: rx },
    { partyName: rx },
  ];
  if (!isShortNumber) {
    saleOr.push({ phone: rx });
  }
  if (numbers.length > 0) {
    for (const n of numbers) {
      saleOr.push({ billNo: n }, { bookingNo: String(n) });
    }
  }

  const matchedLedgerIds = new Set<string>();
  const matchedPartyNames = new Set<string>();

  try {
    const [matchedJcs, matchedSales] = await Promise.all([
      JobCard.find({ $or: jcOr })
        .select('ledgerId partyName phone no bookNo')
        .sort({ _id: -1 })
        .limit(30)
        .lean(),
      Sale.find({ $or: saleOr })
        .select('ledgerId partyName phone billNo bookingNo')
        .sort({ _id: -1 })
        .limit(30)
        .lean(),
    ]);

    for (const j of matchedJcs) {
      if (j.ledgerId) matchedLedgerIds.add(String(j.ledgerId));
      if (j.partyName && j.partyName.trim()) matchedPartyNames.add(j.partyName.trim());
    }
    for (const s of matchedSales) {
      if (s.ledgerId) matchedLedgerIds.add(String(s.ledgerId));
      if (s.partyName && s.partyName.trim()) matchedPartyNames.add(s.partyName.trim());
    }

    if (matchedLedgerIds.size > 0) {
      const validIds = Array.from(matchedLedgerIds)
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
      if (validIds.length > 0) {
        ledgerOr.push({ _id: { $in: validIds } });
      }
    }

    if (matchedPartyNames.size > 0) {
      ledgerOr.push({ name: { $in: Array.from(matchedPartyNames) } });
    }
  } catch (err) {
    console.error('Error in buildLedgerSearchFilter:', err);
  }

  return { filter: { $or: ledgerOr }, matchedLedgerIds };
}

// GET /ledgers?q=&type=&page=&limit=
ledgerRouter.get(
  '/',
  requirePerm('ledgers.view'),
  asyncHandler(async (req, res) => {
    const { q, type } = req.query as { q?: string; type?: string };
    const page = Math.max(num(req.query.page, 1), 1);
    const limit = Math.min(Math.max(num(req.query.limit, 50), 1), 500);
    const { filter, matchedLedgerIds } = await buildLedgerSearchFilter(q);
    if (type) filter.type = type;
    const [items, total] = await Promise.all([
      Ledger.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Ledger.countDocuments(filter),
    ]);

    let sortedItems = items;
    if (matchedLedgerIds.size > 0) {
      sortedItems = [...items].sort((a, b) => {
        const aMatched = matchedLedgerIds.has(String(a._id)) ? 1 : 0;
        const bMatched = matchedLedgerIds.has(String(b._id)) ? 1 : 0;
        if (aMatched !== bMatched) return bMatched - aMatched;
        return a.name.localeCompare(b.name);
      });
    }

    res.json({ items: await withDue(sortedItems as LedgerRow[]), total, page, limit });
  }),
);

interface LedgerRow {
  _id: unknown;
  openingBalance?: number;
}

/**
 * Attach what each party currently owes and their latest bookNo/orderNo to a page of ledgers.
 */
async function withDue<T extends LedgerRow>(
  rows: T[],
): Promise<(T & { due: number; latestOrderNo?: number; latestBookNo?: number })[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r._id));
  const validIds = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));

  const [orders, sales, recentOrders] = await Promise.all([
    JobCard.aggregate([
      { $match: { ledgerId: { $in: ids }, status: { $in: ['open', 'partially_ready', 'ready', 'closed'] } } },
      { $group: { _id: '$ledgerId', due: { $sum: '$balance' } } },
    ]),
    Sale.aggregate([
      { $match: { ledgerId: { $in: ids } } },
      {
        $group: {
          _id: '$ledgerId',
          due: { $sum: { $cond: ['$isReturn', { $multiply: ['$balance', -1] }, '$balance'] } },
        },
      },
    ]),
    JobCard.aggregate([
      { $match: { ledgerId: { $in: validIds } } },
      { $sort: { _id: -1 } },
      {
        $group: {
          _id: '$ledgerId',
          latestBookNo: { $first: '$bookNo' },
          latestOrderNo: { $first: '$no' },
        },
      },
    ]),
  ]);
  const byId = new Map<string, number>();
  for (const g of [...orders, ...sales]) {
    const key = String(g._id);
    byId.set(key, num(byId.get(key)) + num(g.due));
  }
  const metaById = new Map<string, { latestBookNo?: number; latestOrderNo?: number }>();
  for (const r of recentOrders) {
    metaById.set(String(r._id), { latestBookNo: r.latestBookNo, latestOrderNo: r.latestOrderNo });
  }

  return rows.map((r) => {
    const key = String(r._id);
    const meta = metaById.get(key);
    return {
      ...r,
      due: r2(num(r.openingBalance) + num(byId.get(key))),
      latestBookNo: meta?.latestBookNo,
      latestOrderNo: meta?.latestOrderNo,
    };
  });
}

// POST /ledgers
/**
 * Longest a party name may be. Real names, even full company names with a
 * legal suffix, sit well under this; anything longer is a paste accident or
 * someone probing the form, and it wrecks every list the name appears in.
 */
const NAME_MAX = 120;

/**
 * The contact fields, taken off a request body in one place so that creating
 * and updating a party can never drift apart.
 *
 * `undefined` is left out rather than written, so a PUT that sends three
 * fields changes three fields. Only `creditLimit` treats empty specially: a
 * blank box means "no limit", which is a real value and not the same as zero.
 */
function contactFields(body: Record<string, unknown>, { partial }: { partial: boolean }) {
  const text = (k: string) =>
    body[k] === undefined ? undefined : String(body[k] ?? '').trim();
  const out: Record<string, unknown> = {
    phone: text('phone'),
    altPhone: text('altPhone'),
    landline: text('landline'),
    customerGroup: text('customerGroup'),
    businessName: text('businessName'),
    contactPerson: text('contactPerson'),
    email: text('email'),
    assignedTo: text('assignedTo'),
    addressLine1: text('addressLine1'),
    addressLine2: text('addressLine2'),
    city: text('city'),
    state: text('state'),
    country: text('country'),
    zip: text('zip'),
    address: text('address'),
    trn: text('trn'),
  };
  if (body.invoiceOnCompanyName !== undefined)
    out.invoiceOnCompanyName = !!body.invoiceOnCompanyName;
  if (body.dob !== undefined) out.dob = body.dob ? new Date(String(body.dob)) : null;
  if (body.openingBalance !== undefined) out.openingBalance = num(body.openingBalance);
  if (body.payTerm !== undefined)
    out.payTerm = body.payTerm === '' || body.payTerm === null ? null : num(body.payTerm);
  if (body.payTermUnit !== undefined)
    out.payTermUnit = body.payTermUnit === 'months' ? 'months' : 'days';
  if (body.creditLimit !== undefined)
    out.creditLimit =
      body.creditLimit === '' || body.creditLimit === null ? null : num(body.creditLimit);

  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  // On a create, empty strings are noise; on an update they are someone
  // deliberately clearing a field, so they have to be written through.
  if (!partial) for (const k of Object.keys(out)) if (out[k] === '') delete out[k];
  return out;
}

/**
 * A short code for a party who was not given one.
 *
 * Sequential rather than random so the codes stay readable and sortable, and
 * retried on a clash because two counters handed out at the same moment can
 * still race against a code someone typed in by hand.
 */
async function makeContactId(): Promise<string> {
  for (let i = 0; i < 5; i += 1) {
    const code = `CO${String(await nextSeq('contact')).padStart(4, '0')}`;
    if (!(await Ledger.exists({ contactId: code }))) return code;
  }
  throw new HttpError(500, 'Could not generate a contact ID');
}

function cleanName(input: unknown): string {
  const name = String(input ?? '').trim();
  if (!name) throw new HttpError(400, 'Ledger name is required');
  if (name.length > NAME_MAX) {
    throw new HttpError(400, `Ledger name cannot be longer than ${NAME_MAX} characters`);
  }
  return name;
}

ledgerRouter.post(
  '/',
  requirePerm('ledgers.manage'),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const given = String(body.contactId ?? '').trim();
    if (given && (await Ledger.exists({ contactId: given })))
      throw new HttpError(400, `Contact ID "${given}" is already in use`);
    const ledger = await Ledger.create({
      ...contactFields(body, { partial: false }),
      name: cleanName(body.name),
      contactId: given || (await makeContactId()),
      type: body.type || 'customer',
    });
    res.status(201).json(ledger);
  }),
);

/**
 * GET /ledgers/:id/due -> what this party still owes, across everything.
 *
 * Three things add up to it: what they already owed when they were put on
 * file, what is unpaid on their stitching orders, and what is unpaid on their
 * bills. A converted order is deliberately left out — it has become a sale, so
 * counting both would charge the customer twice for the same work. A return
 * subtracts, because money going back is the opposite of money owed.
 *
 * A negative answer means the party is in credit: they have paid ahead.
 */
ledgerRouter.get(
  '/:id/due',
  requirePerm('ledgers.view'),
  asyncHandler(async (req, res) => {
    const ledger = await Ledger.findById(req.params.id).lean();
    if (!ledger) throw new HttpError(404, 'Ledger not found');

    const [orders, sales] = await Promise.all([
      JobCard.find({
        ledgerId: req.params.id,
        status: { $in: ['open', 'partially_ready', 'ready', 'closed'] },
      })
        .select('balance')
        .lean(),
      Sale.find({ ledgerId: req.params.id }).select('balance isReturn').lean(),
    ]);

    const orderDue = r2(
      (orders as { balance?: number }[]).reduce((t, o) => t + num(o.balance), 0),
    );
    const saleDue = r2(
      (sales as { balance?: number; isReturn?: boolean }[]).reduce(
        (t, s) => t + (s.isReturn ? -num(s.balance) : num(s.balance)),
        0,
      ),
    );
    const opening = r2(num((ledger as { openingBalance?: number }).openingBalance));

    res.json({
      ledgerId: String(req.params.id),
      openingBalance: opening,
      orderDue,
      saleDue,
      openOrders: orders.length,
      due: r2(opening + orderDue + saleDue),
    });
  }),
);

/**
 * POST /ledgers/:id/payment-details
 *
 * Remember how a customer paid, so the next order does not ask them to read
 * their card or IBAN out again. Taking a payment is a different permission
 * from editing the customer record — a cashier must be able to do the first
 * without the second — so this is its own endpoint rather than part of PUT.
 *
 * Nothing forbidden is accepted: a card number is reduced to its last four
 * here regardless of what was sent, and a CVC is dropped on the floor.
 */
ledgerRouter.post(
  '/:id/payment-details',
  requirePerm('jobcards.payment'),
  asyncHandler(async (req, res) => {
    const { card, bank } = (req.body ?? {}) as {
      card?: { holder?: string; last4?: string; number?: string; expiry?: string };
      bank?: { bankName?: string; accountName?: string; iban?: string; swift?: string };
    };
    const ledger = await Ledger.findById(req.params.id);
    if (!ledger) throw new HttpError(404, 'Ledger not found');

    if (card) {
      const last4 = String(card.last4 ?? card.number ?? '').replace(/\D/g, '').slice(-4);
      const expiry = String(card.expiry ?? '').trim();
      const holder = String(card.holder ?? '').trim().slice(0, NAME_MAX);
      // A card with nothing to recognise it by is not worth a row.
      if (last4 || holder) {
        const same = (ledger.savedCards ?? []).find(
          (c: { last4?: string; expiry?: string }) =>
            (c.last4 ?? '') === last4 && (c.expiry ?? '') === expiry,
        );
        if (same) {
          if (holder) same.holder = holder;
        } else {
          ledger.savedCards.push({ holder, last4, expiry });
        }
      }
    }

    if (bank) {
      const iban = String(bank.iban ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 40);
      const bankName = String(bank.bankName ?? '').trim().slice(0, NAME_MAX);
      const accountName = String(bank.accountName ?? '').trim().slice(0, NAME_MAX);
      const swift = String(bank.swift ?? '').trim().toUpperCase().slice(0, 20);
      if (iban || bankName) {
        const same = (ledger.savedBanks ?? []).find(
          (b: { iban?: string; bankName?: string }) =>
            iban ? (b.iban ?? '') === iban : (b.bankName ?? '') === bankName,
        );
        if (same) {
          if (bankName) same.bankName = bankName;
          if (accountName) same.accountName = accountName;
          if (swift) same.swift = swift;
        } else {
          ledger.savedBanks.push({ bankName, accountName, iban, swift });
        }
      }
    }

    await ledger.save();
    res.json(ledger);
  }),
);

// GET /ledgers/:id
ledgerRouter.get(
  '/:id',
  requirePerm('ledgers.view'),
  asyncHandler(async (req, res) => {
    const ledger = await Ledger.findById(req.params.id).lean();
    if (!ledger) throw new HttpError(404, 'Ledger not found');
    res.json(ledger);
  }),
);

// PUT /ledgers/:id
ledgerRouter.put(
  '/:id',
  requirePerm('ledgers.manage'),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const given = body.contactId === undefined ? undefined : String(body.contactId ?? '').trim();
    if (given && (await Ledger.exists({ contactId: given, _id: { $ne: req.params.id } })))
      throw new HttpError(400, `Contact ID "${given}" is already in use`);
    const phone = body.phone === undefined ? undefined : String(body.phone ?? '').trim();
    if (phone && (await Ledger.exists({ phone, _id: { $ne: req.params.id } })))
      throw new HttpError(400, `Phone number "${phone}" is already registered to another customer!`);
    const ledger = await Ledger.findByIdAndUpdate(
      req.params.id,
      {
        ...contactFields(body, { partial: true }),
        ...(body.name !== undefined ? { name: cleanName(body.name) } : {}),
        // An emptied box keeps the code it already had rather than dropping
        // it: a party's contact ID is how they are referred to elsewhere.
        ...(given ? { contactId: given } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
      },
      { new: true, runValidators: true },
    );
    if (!ledger) throw new HttpError(404, 'Ledger not found');
    res.json(ledger);
  }),
);

// DELETE /ledgers/:id
ledgerRouter.delete(
  '/:id',
  requirePerm('ledgers.manage'),
  asyncHandler(async (req, res) => {
    const ledger = await Ledger.findByIdAndDelete(req.params.id);
    if (!ledger) throw new HttpError(404, 'Ledger not found');
    res.json({ ok: true });
  }),
);
