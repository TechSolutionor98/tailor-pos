import { Router } from 'express';
import { Types } from 'mongoose';
import { Sale } from '../models/Sale';
import { JobCard } from '../models/JobCard';
import { nextSeq, peekSeq } from '../models/Counter';
import { asyncHandler, HttpError } from '../middleware';
import { num, r2 } from '../utils/money';
import { requireAuth, requirePerm } from '../auth/guard';

export const saleRouter = Router();

// Every endpoint below requires a signed-in user.
saleRouter.use(requireAuth);

const DEFAULT_TAX_RATE = 5;

function searchFilter(q?: string, ledgerId?: string) {
  const trimmed = (q || '').trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = trimmed ? new RegExp(escaped, 'i') : null;

  let queryOr: Record<string, unknown>[] | null = null;
  if (trimmed && rx) {
    queryOr = [
      { partyName: rx },
      { phone: rx },
      { jobCardRef: rx },
      { refNo: rx },
      { bookingNo: rx },
    ];
    const stripped = trimmed.replace(/^b-?/i, '');
    const asNum = Number(stripped);
    if (Number.isFinite(asNum) && stripped !== '') {
      queryOr.push({ billNo: asNum });
    }
    const digitMatches = trimmed.match(/\d+/g);
    if (digitMatches) {
      for (const d of digitMatches) {
        const n = Number(d);
        if (Number.isFinite(n)) {
          queryOr.push({ billNo: n });
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
      $or: [
        { $and: [{ $or: custOr }, { $or: queryOr }] },
        { $or: queryOr },
      ],
    };
  }

  if (queryOr) {
    return { $or: queryOr };
  }
  return {};
}

interface SaleItemBody {
  code?: string;
  productName?: string;
  unit?: string;
  qty?: number;
  rate?: number;
  /** Either a flat sum off the line or a rate; 'fixed' when unsaid. */
  discType?: 'fixed' | 'percent';
  discInput?: number;
  discPercent?: number;
  taxPercent?: number;
  warranty?: number;
  info?: string;
  completed?: boolean;
  status?: string;
}

interface SaleBody {
  billDate?: string;
  saleType?: 'retail' | 'wholesale' | 'distributor';
  paymentType?: 'cash' | 'credit';
  category?: 'A' | 'B';
  creditCardNo?: string;
  jobCardRef?: string;
  jobCardId?: string;
  salesman?: string;
  partyName?: string;
  phone?: string;
  ledgerId?: string;
  delDate?: string;
  landmark?: string;
  trn?: string;
  vehicleNo?: string;
  items?: SaleItemBody[];
  materialsUsed?: { code?: string; productName?: string; qty?: number; rate?: number }[];
  materialTotal?: number;
  bookingNo?: string;
  refNo?: string;
  additionalCharges?: number;
  additionalChargesType?: 'percent' | 'fixed';
  additionalChargesInput?: number;
  additionalDiscount?: number;
  discountType?: 'percent' | 'fixed';
  discountInput?: number;
  freight?: number;
  advanceAmount?: number;
  isReturn?: boolean;
  defaultTaxPercent?: number;
  paymentMethod?: string;
  paymentAccount?: string;
  paymentNote?: string;
  paidOn?: string;
  cardHolder?: string;
  cardLast4?: string;
  cardExpiry?: string;
  bankName?: string;
  accountName?: string;
  iban?: string;
  swift?: string;
  cashPaid?: number;
  cardPaid?: number;
  bankPaid?: number;
}

// GET /sales?q=&isReturn=&page=&limit=
saleRouter.get(
  '/',
  requirePerm('sales.view'),
  asyncHandler(async (req, res) => {
    const { q, isReturn, ledgerId } = req.query as { q?: string; isReturn?: string; ledgerId?: string };
    const page = Math.max(num(req.query.page, 1), 1);
    const limit = Math.min(Math.max(num(req.query.limit, 30), 1), 200);
    const filter: Record<string, unknown> = {
      isDeleted: { $ne: true },
      ...searchFilter(q, ledgerId),
    };
    if (isReturn === 'true') filter.isReturn = true;
    else if (isReturn === 'false') filter.isReturn = false;
    const [rawItems, total] = await Promise.all([
      Sale.find(filter).sort({ billNo: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Sale.countDocuments(filter),
    ]);

    const jcIds = rawItems.map((s) => s.jobCardId).filter(Boolean);
    const jcRefs = rawItems.map((s) => s.jobCardRef).filter(Boolean);

    const jobCards = await JobCard.find({
      $or: [
        ...(jcIds.length ? [{ _id: { $in: jcIds } }] : []),
        ...(jcRefs.length ? [{ ref: { $in: jcRefs } }] : []),
      ],
    })
      .select('_id ref status')
      .lean();

    const jcMap = new Map<string, string>();
    for (const jc of jobCards) {
      if (jc._id) jcMap.set(String(jc._id), jc.status);
      if (jc.ref) jcMap.set(jc.ref, jc.status);
    }

    const items = rawItems.map((s) => {
      const orderStatus =
        (s.jobCardId && jcMap.get(String(s.jobCardId))) ||
        (s.jobCardRef && jcMap.get(s.jobCardRef)) ||
        (s as any).orderStatus ||
        undefined;
      return { ...s, orderStatus };
    });

    res.json({ items, total, page, limit });
  }),
);

// GET /sales/next -> { billNo } (peek)
saleRouter.get(
  '/next',
  requirePerm('sales.view'),
  asyncHandler(async (_req, res) => {
    res.json({ billNo: await peekSeq('sale', 0) });
  }),
);

// POST /sales
saleRouter.post(
  '/',
  requirePerm('sales.create'),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as SaleBody;
    const defaultTax = body.defaultTaxPercent !== undefined ? num(body.defaultTaxPercent, DEFAULT_TAX_RATE) : DEFAULT_TAX_RATE;

    const taxPercent = defaultTax;

    // A line's discount is whichever way the counter typed it — so many dirhams
    // off, or so many percent — reduced to a rate so the stored line reads the
    // same whichever was used.
    const base = (body.items ?? [])
      .filter((i) => i && (i.code || i.productName || num(i.qty) || num(i.rate)))
      .map((i) => {
        const qty = num(i.qty);
        const rate = num(i.rate);
        const gross = r2(qty * rate);
        const input = num(i.discInput, num(i.discPercent));
        const discAmt =
          i.discType === 'percent' ? r2((gross * input) / 100) : r2(Math.min(input, gross));
        const grossAmt = r2(gross - discAmt);
        return {
          code: i.code || '',
          productName: i.productName || '',
          unit: i.unit || '',
          qty,
          rate,
          discType: i.discType === 'percent' ? ('percent' as const) : ('fixed' as const),
          discInput: input,
          discPercent: gross ? r2((discAmt / gross) * 100) : 0,
          discAmt,
          grossAmt,
          warranty: num(i.warranty),
          info: (i.info ?? '').trim(),
          completed: Boolean(i.completed),
          status: i.status || 'ready',
        };
      });

    if (base.length === 0) throw new HttpError(400, 'At least one item is required');

    const totQty = r2(base.reduce((s, i) => s + i.qty, 0));
    const grossAmount = r2(base.reduce((s, i) => s + i.grossAmt, 0));
    const lineDisc = r2(base.reduce((s, i) => s + i.discAmt, 0));

    const extraInput = num(body.additionalChargesInput, num(body.additionalCharges));
    const additionalCharges =
      body.additionalChargesType === 'percent'
        ? r2((grossAmount * extraInput) / 100)
        : r2(extraInput);

    // The bill-wide discount comes off before tax, so tax is charged on what
    // the customer actually owes.
    const discountInput = r2(num(body.discountInput, num(body.additionalDiscount)));
    const additionalDiscount =
      body.discountType === 'percent'
        ? r2((grossAmount * discountInput) / 100)
        : r2(Math.min(discountInput, grossAmount + additionalCharges));
    const discountAmt = r2(lineDisc + additionalDiscount);
    const taxable = Math.max(r2(grossAmount + additionalCharges - additionalDiscount), 0);
    const taxAmt = r2((taxable * taxPercent) / 100);
    const freight = r2(num(body.freight));
    const netAmount = r2(taxable + taxAmt + freight);
    const advanceAmount = r2(num(body.advanceAmount));

    // Share the bill-wide discount across the lines in proportion to what each
    // contributed, so the line tax figures add up to the tax on the bill
    // instead of being a penny out from it.
    const keep = grossAmount > 0 ? taxable / grossAmount : 0;
    const items = base.map((i) => {
      const lineTaxable = r2(i.grossAmt * keep);
      const lineTax = r2((lineTaxable * taxPercent) / 100);
      const netAmount = r2(i.grossAmt + lineTax);
      return {
        ...i,
        netRate: i.qty ? r2(netAmount / i.qty) : 0,
        taxPercent,
        taxAmt: lineTax,
        netAmount,
      };
    });

    const materialsUsed = (body.materialsUsed ?? [])
      .filter((m) => m && (m.code || m.productName || num(m.qty) || num(m.rate)))
      .map((m) => ({
        code: m.code || '',
        productName: m.productName || '',
        qty: num(m.qty),
        rate: num(m.rate),
      }));
    const materialTotal = num(
      body.materialTotal,
      r2(materialsUsed.reduce((s, m) => s + m.qty * m.rate, 0)),
    );

    const billNo = await nextSeq('sale');
    const sale = await Sale.create({
      billNo,
      billDate: body.billDate ? new Date(body.billDate) : new Date(),
      saleType: body.saleType || 'retail',
      paymentType: body.paymentType || 'cash',
      category: body.category || 'A',
      creditCardNo: body.creditCardNo,
      jobCardRef: body.jobCardRef?.trim(),
      jobCardId: body.jobCardId || undefined,
      salesman: body.salesman || 'GENERAL',
      partyName: body.partyName?.trim(),
      phone: body.phone?.trim(),
      ledgerId: body.ledgerId || undefined,
      delDate: body.delDate ? new Date(body.delDate) : undefined,
      landmark: body.landmark,
      trn: body.trn,
      vehicleNo: body.vehicleNo,
      bookingNo: body.bookingNo?.trim() || body.jobCardRef?.trim(),
      refNo: body.refNo?.trim() || `B-${billNo}`,
      items,
      materialsUsed,
      materialTotal,
      totQty,
      grossAmount,
      discountAmt,
      additionalDiscount,
      additionalCharges,
      additionalChargesType: body.additionalChargesType === 'percent' ? 'percent' : 'fixed',
      additionalChargesInput: extraInput,
      discountType: body.discountType === 'percent' ? 'percent' : 'fixed',
      discountInput,
      taxAmt,
      freight,
      advanceAmount,
      netAmount,
      // Overpaying hands change back rather than leaving the bill in credit.
      balance: r2(Math.max(netAmount - advanceAmount, 0)),
      changeReturn: r2(Math.max(advanceAmount - netAmount, 0)),
      isReturn: !!body.isReturn,
      paymentMethod: body.paymentMethod || body.paymentType || 'cash',
      paymentAccount: body.paymentAccount?.trim(),
      paymentNote: body.paymentNote?.trim(),
      paidOn: body.paidOn ? new Date(body.paidOn) : new Date(),
      // Only ever the last four. A full number sent in error is dropped here
      // rather than written to the bill.
      cardHolder: body.cardHolder?.trim(),
      cardLast4: body.cardLast4?.replace(/\D/g, '').slice(-4),
      cardExpiry: body.cardExpiry?.trim(),
      bankName: body.bankName?.trim(),
      accountName: body.accountName?.trim(),
      iban: body.iban?.trim(),
      swift: body.swift?.trim(),
      cashPaid: num(body.cashPaid),
      cardPaid: num(body.cardPaid),
      bankPaid: num(body.bankPaid),
    });

    if (body.jobCardId) {
      const jc = await JobCard.findById(body.jobCardId);
      if (jc) {
        if (Array.isArray(body.items) && Array.isArray(jc.items)) {
          for (const soldItem of body.items) {
            if (soldItem.code === 'EXTRA' || soldItem.productName === 'Additional Charges') {
              continue;
            }
            // Pending items are not yet ready or invoiced on this bill
            if (soldItem.status === 'pending' || soldItem.completed === false) {
              continue;
            }
            // Find an uninvoiced matching item in jc.items
            const match = jc.items.find(
              (it: any) =>
                !it.invoiced &&
                ((soldItem.code && it.code && it.code === soldItem.code) ||
                  (soldItem.productName &&
                    it.productName &&
                    it.productName.trim().toLowerCase() === soldItem.productName.trim().toLowerCase())),
            );
            if (match) {
              match.invoiced = true;
              match.completed = true;
              match.invoiceNo = String(billNo);
            }
          }

          // Cross-reference all linked sales for this order to ensure all sold items are invoiced
          const linkedSales = await Sale.find({
            $or: [{ jobCardId: jc._id }, { jobCardRef: jc.ref }],
          }).lean();
          const allSoldItems: any[] = linkedSales.flatMap((s: any) =>
            (s.items || []).map((it: any) => ({ ...it, billNo: s.billNo })),
          );
          for (const it of jc.items) {
            if (!it.invoiced) {
              const soldMatch = allSoldItems.find(
                (s: any) =>
                  !s._matched &&
                  s.code !== 'EXTRA' &&
                  s.productName !== 'Additional Charges' &&
                  s.status !== 'pending' &&
                  s.completed !== false &&
                  ((s.code && it.code && s.code === it.code) ||
                    (s.productName &&
                      it.productName &&
                      s.productName.trim().toLowerCase() === it.productName.trim().toLowerCase())),
              );
              if (soldMatch) {
                soldMatch._matched = true;
                it.invoiced = true;
                it.completed = true;
                if (!it.invoiceNo) it.invoiceNo = String(soldMatch.billNo || billNo);
              }
            }
          }

          jc.markModified('items');
        }

        const allInvoiced = jc.items.length > 0 && jc.items.every((i: any) => i.invoiced);
        const allCompleted = jc.items.length > 0 && jc.items.every((i: any) => i.completed);
        const hasCompletedItem = jc.items.some((i: any) => i.completed);
        const hasInvoicedItem = jc.items.some((i: any) => i.invoiced);

        if (allInvoiced && allCompleted) {
          jc.status = 'delivered';
        } else if (allCompleted) {
          jc.status = 'ready';
        } else if (hasCompletedItem || hasInvoicedItem) {
          jc.status = 'partially_ready';
        } else {
          jc.status = 'open';
        }
        if (!jc.invoiceNo?.includes(String(billNo))) {
          jc.invoiceNo = jc.invoiceNo ? `${jc.invoiceNo}, ${billNo}` : String(billNo);
        }
        await jc.save();

        sale.orderStatus = jc.status;
        await sale.save();
      }
    }

    res.status(201).json(sale);
  }),
);

// GET /sales/:id
saleRouter.get(
  '/:id',
  requirePerm('sales.view'),
  asyncHandler(async (req, res) => {
    const sale: any = await Sale.findById(req.params.id).lean();
    if (!sale) throw new HttpError(404, 'Sale not found');
    let orderStatus = sale.orderStatus;
    if (!orderStatus && (sale.jobCardId || sale.jobCardRef)) {
      const jc: any = await JobCard.findOne({
        $or: [
          ...(sale.jobCardId ? [{ _id: sale.jobCardId }] : []),
          ...(sale.jobCardRef ? [{ ref: sale.jobCardRef }] : []),
        ],
      })
        .select('status')
        .lean();
      if (jc) orderStatus = jc.status;
    }
    res.json({ ...sale, orderStatus });
  }),
);

// DELETE /sales/:id (soft delete)
saleRouter.delete(
  '/:id',
  requirePerm('sales.create'),
  asyncHandler(async (req, res) => {
    const existing = await Sale.findById(req.params.id);
    if (!existing) throw new HttpError(404, 'Invoice not found');

    existing.isDeleted = true;
    existing.deletedAt = new Date();
    // @ts-ignore
    existing.deletedBy = req.user?.username || req.user?.name || req.user?.id;
    existing.status = 'deleted';
    await existing.save();

    // If linked to a job card, revert invoiced status on matching items
    if (existing.jobCardId || existing.jobCardRef) {
      const jc = await JobCard.findOne({
        $or: [
          ...(existing.jobCardId ? [{ _id: existing.jobCardId }] : []),
          ...(existing.jobCardRef ? [{ ref: existing.jobCardRef }] : []),
        ],
      });
      if (jc) {
        if (Array.isArray(jc.items)) {
          for (const it of jc.items) {
            if (it.invoiceNo === String(existing.billNo)) {
              it.invoiced = false;
              it.invoiceNo = undefined;
            }
          }
          jc.markModified('items');
        }
        if (jc.invoiceNo) {
          const parts = jc.invoiceNo.split(',').map((p: string) => p.trim()).filter((p: string) => p && p !== String(existing.billNo));
          jc.invoiceNo = parts.join(', ');
        }
        // Re-evaluate job card status
        const allInvoiced = jc.items.length > 0 && jc.items.every((i: any) => i.invoiced);
        const allCompleted = jc.items.length > 0 && jc.items.every((i: any) => i.completed);
        const hasCompletedItem = jc.items.some((i: any) => i.completed);
        const hasInvoicedItem = jc.items.some((i: any) => i.invoiced);

        if (allInvoiced && allCompleted) {
          jc.status = 'delivered';
        } else if (allCompleted) {
          jc.status = 'ready';
        } else if (hasCompletedItem || hasInvoicedItem) {
          jc.status = 'partially_ready';
        } else {
          jc.status = 'open';
        }
        await jc.save();
      }
    }

    res.json({ ok: true, message: 'Invoice soft deleted successfully' });
  }),
);
