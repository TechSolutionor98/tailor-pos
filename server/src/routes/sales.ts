import { Router } from 'express';
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

function searchFilter(q?: string) {
  if (!q) return {};
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const or: Record<string, unknown>[] = [
    { partyName: rx },
    { phone: rx },
    { jobCardRef: rx },
  ];
  const asNum = Number(q);
  if (Number.isFinite(asNum) && q.trim() !== '') or.push({ billNo: asNum });
  return { $or: or };
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
    const { q, isReturn } = req.query as { q?: string; isReturn?: string };
    const page = Math.max(num(req.query.page, 1), 1);
    const limit = Math.min(Math.max(num(req.query.limit, 30), 1), 200);
    const filter: Record<string, unknown> = { ...searchFilter(q) };
    if (isReturn === 'true') filter.isReturn = true;
    else if (isReturn === 'false') filter.isReturn = false;
    const [items, total] = await Promise.all([
      Sale.find(filter).sort({ billNo: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Sale.countDocuments(filter),
    ]);
    res.json({ items, total, page, limit });
  }),
);

// GET /sales/next -> { billNo } (peek)
saleRouter.get(
  '/next',
  requirePerm('sales.view'),
  asyncHandler(async (_req, res) => {
    res.json({ billNo: await peekSeq('sale', 85934) });
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
        };
      });

    if (base.length === 0) throw new HttpError(400, 'At least one item is required');

    const totQty = r2(base.reduce((s, i) => s + i.qty, 0));
    const grossAmount = r2(base.reduce((s, i) => s + i.grossAmt, 0));
    const lineDisc = r2(base.reduce((s, i) => s + i.discAmt, 0));

    // The bill-wide discount comes off before tax, so tax is charged on what
    // the customer actually owes.
    const discountInput = r2(num(body.discountInput, num(body.additionalDiscount)));
    const additionalDiscount =
      body.discountType === 'fixed' || body.discountType === undefined
        ? r2(Math.min(discountInput, grossAmount))
        : r2((grossAmount * discountInput) / 100);
    const discountAmt = r2(lineDisc + additionalDiscount);
    const taxable = Math.max(r2(grossAmount - additionalDiscount), 0);
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
      discountType: body.discountType === 'fixed' ? 'fixed' : 'percent',
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
      await JobCard.findByIdAndUpdate(body.jobCardId, {
        status: 'converted',
        invoiceNo: `B-${billNo}`,
      });
    }

    res.status(201).json(sale);
  }),
);

// GET /sales/:id
saleRouter.get(
  '/:id',
  requirePerm('sales.view'),
  asyncHandler(async (req, res) => {
    const sale = await Sale.findById(req.params.id).lean();
    if (!sale) throw new HttpError(404, 'Sale not found');
    res.json(sale);
  }),
);
