'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { fmt, fmtDate, num, todayISO, toISODate } from '@/lib/format';
import type { JobCard, Ledger, LedgerDue, Product, SavedBank, SavedCard, Sale } from '@/lib/types';
import { useSettings } from './SettingsContext';
import { useToast } from './Toast';
import { useAuth } from './AuthContext';
import { blurOnWheel, Card, NumberInput, Select, selectOnFocus, TextInput } from './ui';
import { Modal } from './Modal';
import { LedgerSearchModal } from './LedgerSearchModal';
import { LedgerSearchInput } from './LedgerSearchInput';
import { ProductSearchInput } from './ProductSearchInput';
import {
  SplitTender,
  emptySplit,
  emptyDetails,
  last4,
  splitTotal,
  type Split,
  type TenderDetails,
  type TenderMode,
} from './SplitTender';
import { Icon } from '@/components/icons';

interface SaleRow {
  code: string;
  productName: string;
  unit: string;
  stockQty: number;
  qty: string;
  rate: string;
  discType: 'fixed' | 'percent';
  discInput: string;
  warranty: string;
  info: string;
  completed?: boolean;
  status?: 'ready' | 'pending';
}

interface MaterialRow {
  code: string;
  productName: string;
  qty: string;
  rate: string;
}

const emptyRow = (): SaleRow => ({
  code: '',
  productName: '',
  unit: 'PIECE',
  stockQty: 0,
  qty: '1',
  rate: '',
  discType: 'fixed',
  discInput: '0',
  warranty: '0',
  info: '',
  completed: undefined,
  status: 'ready',
});

const emptyMaterialRow = (): MaterialRow => ({
  code: '',
  productName: '',
  qty: '1',
  rate: '',
});

const UNITS = ['PIECE', 'GRAMS', 'KG', 'METER', 'YARD', 'SET'];

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Today's date and time stamp for display */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(h)}:${p(d.getMinutes())} ${ampm}`;
}

export function SaleForm() {
  const { can } = useAuth();
  const canCreate = can('sales.create');
  const canAddLedger = can('ledgers.manage');
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromJobCardId = searchParams?.get('fromJobCard');
  const { toast } = useToast();
  const { settings } = useSettings();
  const taxRate = settings.taxRate;

  const [billNo, setBillNo] = useState<number | null>(null);
  const [billDate] = useState(todayISO());
  const [saleStamp] = useState(() => stamp());

  const [partyName, setPartyName] = useState('');
  const [phone, setPhone] = useState('');
  const [ledgerId, setLedgerId] = useState('');
  const [due, setDue] = useState<LedgerDue | null>(null);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [savedBanks, setSavedBanks] = useState<SavedBank[]>([]);

  const [bookingNo, setBookingNo] = useState('');
  const [refNo, setRefNo] = useState('');
  const [jobCardId, setJobCardId] = useState('');
  const [orderNo, setOrderNo] = useState<number | null>(null);
  const [orderDate, setOrderDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');

  const [rows, setRows] = useState<SaleRow[]>([emptyRow()]);
  const [pendingOrderItems, setPendingOrderItems] = useState<SaleRow[]>([]);
  const [materials, setMaterials] = useState<MaterialRow[]>([emptyMaterialRow()]);

  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('fixed');
  const [discountInput, setDiscountInput] = useState('0');
  const [additionalChargesType, setAdditionalChargesType] = useState<'percent' | 'fixed'>('fixed');
  const [additionalChargesInput, setAdditionalChargesInput] = useState('0');
  const [advanceBreakdown, setAdvanceBreakdown] = useState<Record<TenderMode, number>>({
    cash: 0,
    card: 0,
    bank: 0,
  });
  const advancePaid = useMemo(
    () => r2(advanceBreakdown.cash + advanceBreakdown.card + advanceBreakdown.bank),
    [advanceBreakdown],
  );

  const [split, setSplit] = useState<Split>(emptySplit);
  const [tenderDetails, setTenderDetails] = useState<TenderDetails>(emptyDetails);

  const [isReturn, setIsReturn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [infoRow, setInfoRow] = useState(-1);
  const [infoDraft, setInfoDraft] = useState('');
  const [jcOpen, setJcOpen] = useState(false);
  const [jcQ, setJcQ] = useState('');
  const [jcRows, setJcRows] = useState<JobCard[]>([]);
  const [saleRows, setSaleRows] = useState<Sale[]>([]);

  const hasCompleted = useMemo(() => rows.some((r) => r.completed === true), [rows]);

  /* ------------------------------------------------------------- figures */

  const calc = useMemo(() => {
    const lines = rows.map((r) => {
      const qty = num(r.qty);
      const rate = num(r.rate);
      const gross = r2(qty * rate);
      const input = num(r.discInput);
      const discAmt =
        r.discType === 'percent' ? r2((gross * input) / 100) : r2(Math.min(input, gross));
      const subtotal = r2(gross - discAmt);
      return { subtotal, discAmt, qty, rate, gross };
    });
    const charged = rows.filter((r) => r.code?.trim() || r.productName?.trim() || num(r.rate) > 0);
    const readyCount = charged.length;
    const readyTotal = r2(lines.reduce((s, l) => s + l.subtotal, 0));
    const pendingCount = pendingOrderItems.length;
    const pendingTotal = r2(
      pendingOrderItems.reduce((s, p) => {
        const q = num(p.qty) || 1;
        const rt = num(p.rate);
        const gross = q * rt;
        const input = num(p.discInput);
        const discAmt = p.discType === 'percent' ? (gross * input) / 100 : Math.min(input, gross);
        return s + (gross - discAmt);
      }, 0),
    );

    const total = r2(readyTotal + pendingTotal);
    const itemCount = charged.length + pendingCount;
    const qtyCount = r2(
      lines.reduce((s, l) => s + l.qty, 0) +
        pendingOrderItems.reduce((s, p) => s + (num(p.qty) || 1), 0),
    );

    const extraIn = num(additionalChargesInput);
    const extra =
      additionalChargesType === 'percent' ? r2((total * extraIn) / 100) : r2(extraIn);
    const dIn = num(discountInput);
    const orderDiscount =
      discountType === 'percent' ? r2((total * dIn) / 100) : r2(Math.min(dIn, total + extra));
    const taxable = r2(Math.max(total + extra - orderDiscount, 0));
    const tax = r2((taxable * taxRate) / 100);
    const payable = r2(taxable + tax);

    // If loaded from a JobCard that had an advance paid
    const advance = r2(advancePaid);
    const advanceBeforeTax = r2(advance / (1 + taxRate / 100));
    const advanceTax = r2(advance - advanceBeforeTax);

    // Balance left to be paid at the counter
    const dueToPay = r2(Math.max(payable - advance, 0));

    // Money received now via SplitTender
    const tenderTaken = splitTotal(split);
    const totalPaid = r2(advance + tenderTaken);
    const balance = r2(Math.max(payable - totalPaid, 0));
    const changeReturn = r2(Math.max(totalPaid - payable, 0));

    return {
      lines,
      itemCount,
      qtyCount,
      readyCount,
      pendingCount,
      readyTotal,
      pendingTotal,
      allProductsTotal: total,
      total,
      additionalCharges: extra,
      additionalChargesType,
      additionalChargesInput: extraIn,
      orderDiscount,
      taxable,
      tax,
      payable,
      advance,
      advanceBeforeTax,
      advanceTax,
      dueToPay,
      tenderTaken,
      totalPaid,
      balance,
      changeReturn,
    };
  }, [
    rows,
    pendingOrderItems,
    discountType,
    discountInput,
    additionalChargesType,
    additionalChargesInput,
    taxRate,
    advancePaid,
    split,
  ]);

  const materialCalc = useMemo(() => {
    const lines = materials.map((m) => {
      const qty = num(m.qty);
      const rate = num(m.rate);
      return { qty, rate, amount: r2(qty * rate) };
    });
    const filled = materials.filter(
      (m) => m.code?.trim() || m.productName?.trim() || num(m.rate) > 0,
    );
    const count = filled.length;
    const qtyCount = r2(lines.reduce((s, l) => s + l.qty, 0));
    const total = r2(lines.reduce((s, l) => s + l.amount, 0));
    return { lines, count, qtyCount, total };
  }, [materials]);

  /* --------------------------------------------------------------- setup */

  useEffect(() => {
    api.sales
      .next()
      .then((r) => setBillNo(r.billNo))
      .catch(() => setBillNo(null));
  }, []);

  const loadDue = useCallback(async () => {
    if (!ledgerId) {
      setDue(null);
      setSavedCards([]);
      setSavedBanks([]);
      return;
    }
    try {
      const [d, l] = await Promise.all([
        api.ledgers.due(ledgerId),
        api.ledgers.get(ledgerId),
      ]);
      setDue(d);
      setSavedCards(l.savedCards ?? []);
      setSavedBanks(l.savedBanks ?? []);
    } catch {
      setDue(null);
      setSavedCards([]);
      setSavedBanks([]);
    }
  }, [ledgerId]);

  useEffect(() => {
    void loadDue();
  }, [loadDue]);

  /* -------------------------------------------------------------- events */

  const updateRow = (i: number, patch: Partial<SaleRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  function pickProduct(i: number, p: Product) {
    updateRow(i, {
      code: p.code,
      productName: p.name,
      rate: String(p.rate),
      unit: (p.unit || 'PIECE').toUpperCase(),
      stockQty: p.stockQty ?? 0,
    });
  }

  function pickLedger(l: Ledger) {
    setPartyName(l.name);
    setPhone(l.phone ?? '');
    setLedgerId(l._id);
    setSavedCards(l.savedCards ?? []);
    setSavedBanks(l.savedBanks ?? []);
  }

  function step(i: number, by: number) {
    const next = Math.max(0, num(rows[i].qty) + by);
    updateRow(i, { qty: String(r2(next)) });
  }

  const updateMaterial = (i: number, patch: Partial<MaterialRow>) =>
    setMaterials((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  function pickMaterial(i: number, p: Product) {
    updateMaterial(i, {
      code: p.code,
      productName: p.name,
      rate: String(p.rate),
    });
  }

  function stepMaterial(i: number, by: number) {
    const next = Math.max(0, num(materials[i].qty) + by);
    updateMaterial(i, { qty: String(r2(next)) });
  }

  async function searchJobCards() {
    try {
      if (isReturn) {
        const [salesRes, jcRes] = await Promise.all([
          api.sales.list(jcQ, 1, 20, false),
          api.jobCards.list(jcQ, '', 1, 20),
        ]);
        setSaleRows(salesRes.items || []);
        setJcRows(jcRes.items || []);
      } else {
        setSaleRows([]);
        const r = await api.jobCards.list(jcQ, '', 1, 20);
        setJcRows(r.items.filter((j) => j.status !== 'converted' && j.status !== 'delivered'));
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Search failed', 'error');
    }
  }

  const loadFromSale = useCallback(
    (s: Sale) => {
      setBookingNo(s.bookingNo || '');
      setRefNo(s.refNo || (s.billNo ? `B-${s.billNo}` : ''));
      setPartyName(s.partyName || '');
      setPhone(s.phone || '');
      setLedgerId(s.ledgerId || '');

      if (s.items && s.items.length > 0) {
        setRows(
          s.items.map((i) => ({
            ...emptyRow(),
            code: i.code || '',
            productName: i.productName || '',
            unit: i.unit || 'PIECE',
            qty: String(i.qty || 1),
            rate: String(i.rate || 0),
            discType: i.discType || 'fixed',
            discInput: String(i.discInput ?? 0),
            warranty: String(i.warranty ?? 0),
            info: i.info || '',
          })),
        );
      }

      if (s.materialsUsed && s.materialsUsed.length > 0) {
        setMaterials(
          s.materialsUsed.map((m) => ({
            code: m.code || '',
            productName: m.productName || '',
            qty: String(m.qty ?? 1),
            rate: String(m.rate ?? 0),
          })),
        );
      } else {
        setMaterials([emptyMaterialRow()]);
      }

      if (s.additionalCharges || (s as any).additionalChargesInput) {
        setAdditionalChargesType((s as any).additionalChargesType || 'fixed');
        setAdditionalChargesInput(String((s as any).additionalChargesInput ?? s.additionalCharges));
      }

      if (s.discountInput || s.additionalDiscount) {
        setDiscountType(s.discountType || 'fixed');
        setDiscountInput(String(s.discountInput ?? s.additionalDiscount ?? 0));
      }

      setJcOpen(false);
      toast(`Loaded original sales invoice B-${s.billNo} for return`, 'info');
    },
    [toast],
  );

  const convertFrom = useCallback(
    async (rawJ: JobCard) => {
      let j = rawJ;
      if (rawJ._id) {
        try {
          j = await api.jobCards.get(rawJ._id);
        } catch {
          j = rawJ;
        }
      }

      // 1. Filter out items that were already invoiced
      const uninvoiced = (j.items || []).filter((i) => !i.invoiced);
      if (uninvoiced.length === 0) {
        setJcOpen(false);
        toast(`Order ${j.ref || j.no} has already been fully invoiced.`, 'warning');
        return;
      }

      const orderBookNo = j.bookNo != null ? String(j.bookNo) : (j.no != null ? String(j.no) : '');
      const orderRefNo = j.ref || (j.no != null ? `Ref-${j.no}` : '');
      setBookingNo(orderBookNo);
      setRefNo(orderRefNo);
      setJobCardId(j._id);
      setOrderNo(j.no ?? null);
      setOrderDate(j.date ? toISODate(j.date) : '');
      setDeliveryDate(j.deliveryDate ? toISODate(j.deliveryDate) : '');
      setPartyName(j.partyName ?? '');
      setPhone(j.phone ?? '');
      setLedgerId(j.ledgerId ?? '');

      const availAdv = j.remainingAdvance !== undefined ? num(j.remainingAdvance) : num(j.advance);
      const bd: Record<TenderMode, number> = { cash: 0, card: 0, bank: 0 };
      if (availAdv > 0) {
        if (j.payments && j.payments.length > 0) {
          let left = availAdv;
          for (const p of j.payments) {
            if (left <= 0) break;
            const m = (p.mode === 'credit' ? 'cash' : p.mode) as TenderMode;
            if (m in bd) {
              const take = Math.min(left, num(p.amount));
              bd[m] = r2(bd[m] + take);
              left = r2(left - take);
            }
          }
          if (left > 0) {
            bd.cash = r2(bd.cash + left);
          }
        } else {
          const m = ((j.paymentMode as TenderMode) || 'cash');
          if (m in bd) {
            bd[m] = r2(availAdv);
          }
        }
      }
      setAdvanceBreakdown(bd);

      const allItems = j.items || [];
      const hasAnyCompleted = allItems.some((i) => Boolean(i.completed));

      // Only items that are ready to be delivered right now are shown in the table
      const readyToDisplay = allItems.filter(
        (i) => !i.invoiced && (hasAnyCompleted ? Boolean(i.completed) : true),
      );

      const readyRows: SaleRow[] = [];
      if (readyToDisplay.length > 0) {
        readyRows.push(
          ...readyToDisplay.map((i) => ({
            ...emptyRow(),
            code: i.code ?? '',
            productName: i.productName ?? '',
            qty: String(i.qty),
            rate: String(i.rate),
            info: '',
            completed: true,
            status: 'ready' as const,
          })),
        );
      }
      const isFirstBill = !j.invoiceNo;
      if (isFirstBill && num(j.additionalCharges) > 0) {
        readyRows.push({
          ...emptyRow(),
          code: 'EXTRA',
          productName: 'Additional Charges',
          qty: '1',
          rate: String(j.additionalCharges),
          completed: true,
          status: 'ready',
        });
      }
      if (readyRows.length > 0) {
        setRows(readyRows);
      } else {
        setRows([emptyRow()]);
      }

      // All other items belonging to this order (prior invoiced or pending stitching)
      // Hidden from the table, but preserved so that the order's full total amount is displayed
      const otherOrderItems = allItems.filter((i) => !readyToDisplay.includes(i));
      const pendingRows: SaleRow[] = otherOrderItems.map((i) => ({
        ...emptyRow(),
        code: i.code ?? '',
        productName: i.productName ?? '',
        qty: String(i.qty),
        rate: String(i.rate),
        info: '',
        completed: false,
        status: 'pending' as const,
      }));
      setPendingOrderItems(pendingRows);

      toast(
        `Loaded order ${orderRefNo}: ${readyRows.length} ready item(s) (Order Total: ${fmt(j.netAmount || 0)} AED)`,
        'info',
      );

      // Load materials used from the job card only on the first bill
      const loadedMaterials: MaterialRow[] = [];
      if (isFirstBill) {
        if (j.materialsUsed && j.materialsUsed.length > 0) {
          for (const m of j.materialsUsed) {
            if (m.code || m.productName || num(m.qty) || num(m.rate)) {
              loadedMaterials.push({
                code: m.code ?? '',
                productName: m.productName ?? '',
                qty: String(m.qty ?? 1),
                rate: String(m.rate ?? 0),
              });
            }
          }
        }
        if (j.measurementSets && j.measurementSets.length > 0) {
          for (const set of j.measurementSets) {
            for (const m of set.materials ?? []) {
              if (m.code || m.productName || num(m.qty) || num(m.rate)) {
                loadedMaterials.push({
                  code: m.code ?? '',
                  productName: m.productName ?? '',
                  qty: String(m.qty ?? 1),
                  rate: String(m.rate ?? 0),
                });
              }
            }
          }
        }
      }
      if (loadedMaterials.length > 0) {
        setMaterials(loadedMaterials);
      } else {
        setMaterials([emptyMaterialRow()]);
      }

      if (j.additionalCharges || (j as any).additionalChargesInput) {
        setAdditionalChargesType((j as any).additionalChargesType || 'fixed');
        setAdditionalChargesInput(String((j as any).additionalChargesInput ?? j.additionalCharges));
      }

      if (j.discount || (j as any).discountInput) {
        setDiscountType((j as any).discountType || 'fixed');
        setDiscountInput(String((j as any).discountInput ?? j.discount));
      }
      if (j.ledgerId) {
        try {
          const l = await api.ledgers.get(j.ledgerId);
          pickLedger(l);
          if (j.partyName) setPartyName(j.partyName);
          if (j.phone) setPhone(j.phone);
        } catch {
          /* ignore */
        }
      }
      setJcOpen(false);
    },
    [toast],
  );

  useEffect(() => {
    if (!fromJobCardId) return;
    let live = true;
    void (async () => {
      try {
        const j = await api.jobCards.get(fromJobCardId);
        if (!live) return;
        await convertFrom(j);
      } catch (e) {
        if (live) toast(e instanceof Error ? e.message : 'Could not load order for sale', 'error');
      }
    })();
    return () => {
      live = false;
    };
  }, [fromJobCardId, convertFrom, toast]);

  function handleClearMode(m: TenderMode) {
    setSplit((prev) => ({ ...prev, [m]: '' }));
    setAdvanceBreakdown((prev) => ({ ...prev, [m]: 0 }));
  }

  async function save(andPrint: boolean) {
    const validItems = rows.filter((r) => r.code || r.productName || num(r.rate));
    if (validItems.length === 0) {
      toast('No items to invoice. Please add at least one item.', 'error');
      return;
    }
    if (!partyName.trim()) {
      toast('Customer is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const tenderTaken = splitTotal(split);
      const effectiveSplit = { ...split };
      if (tenderTaken === 0 && calc.dueToPay > 0 && !isReturn) {
        effectiveSplit.cash = String(calc.dueToPay);
      }

      const totalCash = r2(advanceBreakdown.cash + num(effectiveSplit.cash));
      const totalCard = r2(advanceBreakdown.card + num(effectiveSplit.card));
      const totalBank = r2(advanceBreakdown.bank + num(effectiveSplit.bank));

      const activeModesCount = [totalCash > 0, totalCard > 0, totalBank > 0].filter(Boolean).length;
      let method = 'cash';
      if (activeModesCount > 1) {
        method = 'split';
      } else if (totalCard > 0) {
        method = 'card';
      } else if (totalBank > 0) {
        method = 'bank';
      } else if (totalCash > 0) {
        method = 'cash';
      } else if (r2(totalCash + totalCard + totalBank) === 0) {
        method = 'credit';
      }

      const card = tenderDetails.card;
      const bankT = tenderDetails.bank;
      const usedCard = num(effectiveSplit.card) > 0;
      const usedBank = num(effectiveSplit.bank) > 0;

      const sale = await api.sales.create({
        billDate,
        saleType: 'retail',
        paymentType: method === 'credit' ? 'credit' : 'cash',
        category: 'A',
        bookingNo: bookingNo.trim() || undefined,
        refNo: refNo.trim() || (billNo ? `B-${billNo}` : undefined),
        jobCardRef: refNo.trim() || bookingNo.trim() || undefined,
        jobCardId: jobCardId || undefined,
        delDate: deliveryDate || undefined,
        salesman: settings.salesman,
        partyName: partyName.trim(),
        phone: phone.trim(),
        ledgerId: ledgerId || undefined,
        items: [
          ...validItems.map((r) => ({
            code: r.code,
            productName: r.productName,
            unit: r.unit,
            qty: num(r.qty),
            rate: num(r.rate),
            discType: r.discType,
            discInput: num(r.discInput),
            warranty: num(r.warranty),
            info: r.info,
            completed: true,
            status: 'ready' as const,
          })),
          ...pendingOrderItems.map((p) => ({
            code: p.code,
            productName: p.productName,
            unit: p.unit,
            qty: num(p.qty),
            rate: num(p.rate),
            discType: p.discType,
            discInput: num(p.discInput),
            warranty: num(p.warranty),
            info: p.info,
            completed: false,
            status: 'pending' as const,
          })),
        ],
        materialsUsed: materials
          .filter((m) => m.code || m.productName || num(m.rate))
          .map((m) => ({
            code: m.code,
            productName: m.productName,
            qty: num(m.qty),
            rate: num(m.rate),
          })),
        materialTotal: materialCalc.total,
        additionalCharges: calc.additionalCharges,
        additionalChargesType,
        additionalChargesInput: num(additionalChargesInput),
        discountType,
        discountInput: num(discountInput),
        advanceAmount: r2(totalCash + totalCard + totalBank),
        paymentMethod: method,
        cashPaid: totalCash,
        cardPaid: totalCard,
        bankPaid: totalBank,
        ...(usedCard
          ? {
              cardHolder: card.holder.trim(),
              cardLast4: last4(card.number),
              cardExpiry: card.expiry.trim(),
            }
          : {}),
        ...(usedBank
          ? {
              bankName: bankT.bankName.trim(),
              accountName: bankT.accountName.trim(),
              iban: bankT.iban.trim(),
              swift: bankT.swift.trim(),
            }
          : {}),
        paidOn: new Date().toISOString(),
        isReturn,
        defaultTaxPercent: taxRate,
      });

      // Save payment details against the customer for future convenience
      if (ledgerId && (usedCard || usedBank)) {
        try {
          await api.ledgers.savePaymentDetails(ledgerId, {
            ...(usedCard
              ? { card: { holder: card.holder, last4: last4(card.number), expiry: card.expiry } }
              : {}),
            ...(usedBank
              ? {
                  bank: {
                    bankName: bankT.bankName,
                    accountName: bankT.accountName,
                    iban: bankT.iban,
                    swift: bankT.swift,
                  },
                }
              : {}),
          });
        } catch {
          /* ignore background failure */
        }
      }

      toast(`${isReturn ? 'Return' : 'Bill'} ${sale.billNo} saved`);
      router.push(andPrint ? `/sales/${sale._id}?print=1` : '/sales');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  const customerDue = due ? r2(due.due) : 0;

  return (
    <div className="pb-16 text-[12px]">
      <div className="flex flex-col lg:flex-row items-start">
        {/* Left Column: Header details & Sale Items table */}
        <Card className="w-full min-w-0 flex-1 rounded-none border-x-0 border-t-0 lg:border-r">
          {/* Header fields */}
          <section className="p-4 sm:p-5">
            <div className="mb-5 flex items-baseline justify-center gap-3">
              <p className="text-lg font-extrabold tracking-tight text-ink-900">
                {isReturn ? 'Sales Return:' : 'Sale Invoice:'}
              </p>
              <p className="text-3xl font-black leading-none tabular-nums text-ink-900">
                {billNo ?? '…'}
              </p>
              <span
                className={`ml-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  isReturn
                    ? 'bg-rose-100 text-rose-700 border border-rose-200'
                    : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                }`}
              >
                {isReturn ? '↩ Return' : '✓ Delivered'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-12">
              <div className="col-span-2 sm:col-span-6">
                <div className="mb-1 flex h-7 items-center justify-between">
                  <label className="label mb-0">CUSTOMER NAME</label>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <LedgerSearchInput
                      value={partyName}
                      phone={phone}
                      onChange={(v) => {
                        setPartyName(v);
                        setLedgerId('');
                      }}
                      onPick={pickLedger}
                      onCreate={canAddLedger ? () => setLedgerOpen(true) : undefined}
                      placeholder="Start typing a customer's name…"
                      className="font-semibold"
                    />
                  </div>
                  {canAddLedger && (
                    <button
                      type="button"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-600 shadow-sm transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
                      onClick={() => setLedgerOpen(true)}
                      title="Add a customer"
                      aria-label="New customer"
                    >
                      <Icon name="plus" className="h-5 w-5" />
                    </button>
                  )}
                </div>
                <div className="mt-1 min-h-[20px]">
                  {customerDue !== 0 ? (
                    <p
                      className={`text-[11px] font-bold ${
                        customerDue > 0 ? 'text-rose-600' : 'text-brand-700'
                      }`}
                    >
                      {customerDue > 0
                        ? `Customer Due: ${fmt(customerDue)} AED`
                        : `In credit: ${fmt(Math.abs(customerDue))} AED`}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="col-span-2 sm:col-span-3">
                <div className="mb-1 flex h-7 items-center justify-between">
                  <label className="label mb-0">Sale Date</label>
                </div>
                <TextInput
                  value={saleStamp}
                  readOnly
                  className="bg-ink-100 font-mono text-ink-600"
                />
              </div>

              <div className="col-span-2 sm:col-span-3">
                <div className="mb-1 flex h-7 items-center justify-between">
                  <label className="label mb-0">Book No</label>
                </div>
                <div className="flex gap-2">
                  <TextInput
                    value={bookingNo}
                    onChange={(e) => setBookingNo(e.target.value)}
                    placeholder="Book No"
                    className="bg-ink-100 font-mono text-ink-600"
                  />
                  <button
                    type="button"
                    className="btn-soft shrink-0 !py-1.5"
                    onClick={() => {
                      setJcOpen(true);
                      setJcQ('');
                      setJcRows([]);
                    }}
                    title="Find earlier order"
                  >
                    Find
                  </button>
                </div>
              </div>

              <div className="col-span-2 sm:col-span-3">
                <div className="mb-1 flex h-7 items-center justify-between">
                  <label className="label mb-0">{isReturn ? 'Original Inv / Ref' : 'Ref No'}</label>
                </div>
                <TextInput
                  value={refNo || (billNo ? String(billNo) : '')}
                  onChange={(e) => setRefNo(e.target.value)}
                  placeholder={isReturn ? 'e.g. 101 or Ref-13051' : 'Ref No'}
                  className="bg-ink-100 font-mono text-ink-600"
                />
              </div>

              <div className="col-span-2 sm:col-span-3">
                <div className="mb-1 flex h-7 items-center justify-between">
                  <label className="label mb-0">Order No</label>
                </div>
                <TextInput
                  value={orderNo != null ? String(orderNo) : ''}
                  readOnly
                  placeholder="auto come"
                  className="bg-ink-100 font-mono text-ink-600"
                />
              </div>

              <div className="col-span-2 sm:col-span-3">
                <div className="mb-1 flex h-7 items-center justify-between">
                  <label className="label mb-0">Order Date</label>
                </div>
                <TextInput
                  value={orderDate ? fmtDate(orderDate) : ''}
                  readOnly
                  placeholder="auto come"
                  className="bg-ink-100 font-mono text-ink-600"
                />
              </div>

              <div className="col-span-2 sm:col-span-3">
                <div className="mb-1 flex h-7 items-center justify-between">
                  <label className="label mb-0">Delivery Date</label>
                </div>
                <TextInput
                  value={deliveryDate ? fmtDate(deliveryDate) : ''}
                  readOnly
                  placeholder="auto come"
                  className="bg-ink-100 font-mono text-ink-600"
                />
              </div>
            </div>
          </section>

          {/* items section: with the exact fields requested in the screenshot */}
          <section className="border-t border-ink-200 px-3 sm:px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold tracking-tight text-ink-900">Sale Items</h2>
              </div>
              <button
                type="button"
                className="btn-soft !py-1.5 text-xs"
                onClick={() => setRows((r) => [...r, emptyRow()])}
              >
                ＋ Add row
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-ink-200 no-scrollbar">
              <table className="w-full table-fixed">
                <colgroup>
                  <col style={{ width: 140 }} />
                  <col style={{ width: 75 }} />
                  <col style={{ width: 60 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 85 }} />
                  <col style={{ width: 38 }} />
                  <col style={{ width: 95 }} />
                  <col style={{ width: 65 }} />
                  <col style={{ width: 28 }} />
                </colgroup>
                <thead className="bg-ink-50">
                  <tr className="text-center text-xs font-bold text-ink-700">
                    <th className="th-s py-2 pl-3 text-left" style={{ width: 140 }}>Product</th>
                    <th className="th-s py-2 text-center" style={{ width: 75 }}>Status</th>
                    <th className="th-s py-2 text-center" style={{ width: 60 }}>Quantity</th>
                    <th className="th-s py-2 text-center" style={{ width: 100 }}>Unit Price</th>
                    <th className="th-s py-2 text-center" style={{ width: 85 }}>Discount</th>
                    <th className="th-s py-2 text-center" style={{ width: 38 }}>Warranty</th>
                    <th className="th-s py-2 text-center" style={{ width: 95 }}>Info</th>
                    <th className="th-s py-2 text-center" style={{ width: 65 }}>Subtotal</th>
                    <th className="th-s py-2 text-center" style={{ width: 28 }}>
                      <button
                        type="button"
                        onClick={() => setRows([emptyRow()])}
                        title="Clear every line"
                        aria-label="Clear every line"
                        className="text-base font-black text-ink-800 transition hover:text-rose-600"
                      >
                        ✕
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-200">
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      className="hover:bg-emerald-50/40 transition-colors"
                    >
                      {/* Product */}
                      <td className="px-2 py-2" style={{ width: 140 }}>
                        <div className="flex w-full items-center gap-1.5">
                          {r.code && (
                            <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-700">
                              {r.code}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <ProductSearchInput
                              value={r.productName}
                              onChange={(v) => updateRow(i, { productName: v, code: '' })}
                              onPick={(p) => pickProduct(i, p)}
                              allowCreate
                              placeholder="Product name / code"
                              className="input-sm !h-8 w-full text-xs font-normal"
                            />
                          </div>
                        </div>
                      </td>

                      {/* Status (Read-only) */}
                      <td className="px-1 py-2 text-center" style={{ width: 75 }}>
                        <span
                          className={`inline-flex items-center justify-center gap-1 w-full rounded-md px-1.5 py-1 text-[11px] font-bold shadow-sm select-none ${
                            r.status === 'pending'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          }`}
                          title={`Status: ${r.status === 'pending' ? 'Pending' : 'Ready'}`}
                        >
                          <span>{r.status === 'pending' ? '⏳' : '✓'}</span>
                          <span className="capitalize">{r.status === 'pending' ? 'Pending' : 'Ready'}</span>
                        </span>
                      </td>

                      {/* Quantity */}
                      <td className="px-0.5 py-2" style={{ width: 60 }}>
                        <div className="flex h-8 items-stretch rounded-lg border border-ink-300 bg-white">
                          <button
                            type="button"
                            onClick={() => step(i, -1)}
                            className="w-5 shrink-0 text-center text-sm font-bold text-ink-500 hover:bg-rose-50 hover:text-rose-600 transition"
                          >
                            −
                          </button>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={r.qty}
                            onChange={(e) => updateRow(i, { qty: e.target.value })}
                            className="w-full min-w-0 border-x border-ink-200 text-center text-xs font-semibold tabular-nums outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => step(i, 1)}
                            className="w-5 shrink-0 text-center text-sm font-bold text-ink-500 hover:bg-emerald-50 hover:text-emerald-600 transition"
                          >
                            +
                          </button>
                        </div>
                      </td>

                      {/* Unit Price */}
                      <td className="px-0.5 py-2" style={{ width: 100 }}>
                        <div className="flex h-8 items-center rounded-lg border border-ink-300 bg-white overflow-hidden focus-within:border-brand-500">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={r.rate}
                            onChange={(e) => updateRow(i, { rate: e.target.value })}
                            placeholder="0.00"
                            className="w-full min-w-0 px-1.5 text-right text-xs font-semibold tabular-nums outline-none"
                          />
                          <select
                            value={r.unit}
                            onChange={(e) => updateRow(i, { unit: e.target.value })}
                            className="shrink-0 border-l border-ink-200 bg-ink-50 px-1 py-1 text-[10px] font-bold text-ink-600 outline-none cursor-pointer"
                          >
                            {(UNITS.includes(r.unit) ? UNITS : [r.unit, ...UNITS]).map((u) => (
                              <option key={u} value={u}>
                                {u === 'PIECE' ? 'PCS' : u}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>

                      {/* Discount */}
                      <td className="px-0.5 py-2" style={{ width: 85 }}>
                        <div className="flex h-8 items-center rounded-lg border border-ink-300 bg-white overflow-hidden focus-within:border-brand-500">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={r.discInput}
                            onChange={(e) => updateRow(i, { discInput: e.target.value })}
                            placeholder="0"
                            className="w-full min-w-0 px-1.5 text-right text-xs font-semibold tabular-nums outline-none"
                          />
                          <select
                            value={r.discType}
                            onChange={(e) =>
                              updateRow(i, { discType: e.target.value as SaleRow['discType'] })
                            }
                            className="shrink-0 border-l border-ink-200 bg-ink-50 px-1 py-1 text-[10px] font-bold text-ink-600 outline-none cursor-pointer"
                          >
                            <option value="fixed">AED</option>
                            <option value="percent">%</option>
                          </select>
                        </div>
                      </td>

                      {/* Warranty */}
                      <td className="px-0.5 py-2" style={{ width: 38 }}>
                        <input
                          type="number"
                          min="0"
                          value={r.warranty}
                          onChange={(e) => updateRow(i, { warranty: e.target.value })}
                          className="h-8 w-full rounded-lg border border-ink-300 bg-white px-1 text-center text-xs font-medium tabular-nums outline-none focus:border-brand-500"
                          title="Warranty in months"
                        />
                      </td>

                      {/* Info */}
                      <td className="px-0.5 py-2" style={{ width: 95 }}>
                        <div className="flex h-8 items-center gap-1">
                          <select
                            value={r.info ? 'set' : ''}
                            onChange={(e) => {
                              if (e.target.value === '') updateRow(i, { info: '' });
                            }}
                            className="h-8 min-w-0 flex-1 rounded-lg border border-ink-300 bg-white px-1 text-[11px] text-ink-700 outline-none"
                          >
                            <option value="">Please Select</option>
                            {r.info && <option value="set">{r.info}</option>}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              setInfoRow(i);
                              setInfoDraft(r.info);
                            }}
                            title="Add or edit note"
                            className="flex h-8 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white transition hover:bg-emerald-700"
                          >
                            <Icon name="plus" className="h-3 w-3" />
                          </button>
                        </div>
                      </td>

                      {/* Subtotal */}
                      <td
                        className="px-0.5 py-2 text-center text-xs font-bold tabular-nums leading-8 whitespace-nowrap text-ink-900"
                        style={{ width: 65 }}
                      >
                        {fmt(calc.lines[i]?.subtotal ?? 0)}
                      </td>

                      {/* Remove */}
                      <td className="px-0.5 py-2 text-center" style={{ width: 28 }}>
                        <button
                          type="button"
                          onClick={() =>
                            setRows((rs) =>
                              rs.length > 1 ? rs.filter((_, idx) => idx !== i) : [emptyRow()],
                            )
                          }
                          title="Remove this line"
                          aria-label="Remove this line"
                          className="flex h-8 w-6 items-center justify-center text-sm font-bold text-rose-500 transition hover:text-rose-700 mx-auto"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ink-50 px-3.5 py-2 text-[12px] font-bold text-ink-800">
              <div className="flex items-center gap-3">
                <span className="text-ink-600">
                  Ready Items: <span className="tabular-nums font-extrabold text-emerald-700">{calc.readyCount}</span>
                </span>
                {calc.pendingCount > 0 && (
                  <span className="text-ink-600">
                    Pending Items: <span className="tabular-nums font-extrabold text-amber-700">{calc.pendingCount}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <span>
                  Bill Items: <span className="tabular-nums">{fmt(calc.qtyCount)}</span>
                </span>
                <span>
                  Bill Total: <span className="tabular-nums font-extrabold text-brand-700">{fmt(calc.total)} AED</span>
                </span>
              </div>
            </div>

            {/* Additional Charges & Discount toolbar */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-200/80 bg-ink-50/60 p-3">
              <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                {/* Additional Charges */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-ink-700">Additional Charges:</span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={additionalChargesType}
                      onChange={(e) => setAdditionalChargesType(e.target.value as 'fixed' | 'percent')}
                      className="input-sm !w-20 !py-1 text-xs font-bold bg-white border border-ink-200 rounded-lg cursor-pointer text-ink-700 shadow-xs"
                    >
                      <option value="fixed">AED</option>
                      <option value="percent">%</option>
                    </select>
                    <NumberInput
                      value={additionalChargesInput}
                      onChange={(e) => setAdditionalChargesInput(e.target.value)}
                      className="input-sm !w-24 text-right font-semibold"
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* Discount with Currency (AED) or % */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-ink-700">Discount:</span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={discountType}
                      onChange={(e) => setDiscountType(e.target.value as 'fixed' | 'percent')}
                      className="input-sm !w-20 !py-1 text-xs font-bold bg-white border border-ink-200 rounded-lg cursor-pointer text-ink-700 shadow-xs"
                    >
                      <option value="fixed">AED</option>
                      <option value="percent">%</option>
                    </select>
                    <NumberInput
                      value={discountInput}
                      onChange={(e) => setDiscountInput(e.target.value)}
                      className="input-sm !w-24 text-right font-semibold"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              {/* Subtotal preview right-aligned */}
              <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs font-bold text-ink-700 ml-auto">
                {calc.additionalCharges > 0 && (
                  <span className="text-emerald-700">
                    +Charges: <span className="tabular-nums font-black">{fmt(calc.additionalCharges)} AED</span>
                  </span>
                )}
                {calc.orderDiscount > 0 && (
                  <span className="text-rose-600">
                    -Discount: <span className="tabular-nums font-black">{fmt(calc.orderDiscount)} AED</span>
                  </span>
                )}
                <span className="text-ink-900">
                  Total Before Tax: <span className="tabular-nums font-extrabold text-brand-800">{fmt(calc.taxable)} AED</span>
                </span>
              </div>
            </div>
          </section>

          {/* materials used section */}
          <section className="border-t border-ink-200 px-3 sm:px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-extrabold tracking-tight text-ink-900">Materials Used</h2>
              <button
                type="button"
                className="btn-soft !py-1.5 text-xs"
                onClick={() => setMaterials((m) => [...m, emptyMaterialRow()])}
              >
                ＋ Add row
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-ink-200 no-scrollbar">
              <table className="w-full table-fixed">
                <colgroup>
                  <col style={{ width: 36 }} />
                  <col style={{ width: 220 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 36 }} />
                </colgroup>
                <thead className="bg-ink-50">
                  <tr className="text-center text-xs font-bold text-ink-700">
                    <th className="th-s py-2 text-center" style={{ width: 36 }}>Sl</th>
                    <th className="th-s py-2 pl-3 text-left" style={{ width: 220 }}>Product</th>
                    <th className="th-s py-2 text-center" style={{ width: 90 }}>Quantity</th>
                    <th className="th-s py-2 text-center" style={{ width: 110 }}>Rate</th>
                    <th className="th-s py-2 text-center" style={{ width: 100 }}>Amount</th>
                    <th className="th-s py-2 text-center" style={{ width: 36 }}>
                      <button
                        type="button"
                        onClick={() => setMaterials([emptyMaterialRow()])}
                        title="Clear every material"
                        aria-label="Clear every material"
                        className="text-base font-black text-ink-800 transition hover:text-rose-600"
                      >
                        ✕
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-200">
                  {materials.map((m, i) => (
                    <tr key={i} className="hover:bg-emerald-50/40 transition-colors">
                      {/* Sl */}
                      <td className="px-1 py-2 text-center text-xs font-medium text-ink-400" style={{ width: 36 }}>
                        {i + 1}
                      </td>

                      {/* Product */}
                      <td className="px-2 py-2" style={{ width: 220 }}>
                        <div className="flex w-full items-center gap-1.5">
                          {m.code && (
                            <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-700">
                              {m.code}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <ProductSearchInput
                              value={m.productName}
                              onChange={(v) => updateMaterial(i, { productName: v, code: '' })}
                              onPick={(p) => pickMaterial(i, p)}
                              usableAs="material"
                              allowCreate
                              placeholder="Type a code or material name…"
                              className="input-sm !h-8 w-full text-xs font-normal"
                            />
                          </div>
                        </div>
                      </td>

                      {/* Quantity */}
                      <td className="px-1 py-2" style={{ width: 90 }}>
                        <div className="flex h-8 w-full items-stretch rounded-lg border border-ink-300 bg-white overflow-hidden">
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => stepMaterial(i, -1)}
                            className="w-5 shrink-0 bg-ink-50 text-xs font-bold text-ink-600 hover:bg-ink-100 active:bg-ink-200"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={m.qty}
                            onChange={(e) => updateMaterial(i, { qty: e.target.value })}
                            onFocus={selectOnFocus}
                            onWheel={blurOnWheel}
                            className="min-w-0 flex-1 text-center text-xs font-semibold tabular-nums text-ink-800 outline-none"
                          />
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => stepMaterial(i, 1)}
                            className="w-5 shrink-0 bg-ink-50 text-xs font-bold text-ink-600 hover:bg-ink-100 active:bg-ink-200"
                          >
                            +
                          </button>
                        </div>
                      </td>

                      {/* Rate */}
                      <td className="px-1 py-2" style={{ width: 110 }}>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={m.rate}
                          onChange={(e) => updateMaterial(i, { rate: e.target.value })}
                          onFocus={selectOnFocus}
                          onWheel={blurOnWheel}
                          placeholder="0.00"
                          className="h-8 w-full rounded-lg border border-ink-300 bg-white px-2 text-right text-xs font-semibold tabular-nums text-ink-800 outline-none focus:border-brand-500"
                        />
                      </td>

                      {/* Amount */}
                      <td
                        className="px-1 py-2 text-center text-xs font-bold tabular-nums text-ink-900 leading-8 whitespace-nowrap"
                        style={{ width: 100 }}
                      >
                        {fmt(materialCalc.lines[i]?.amount ?? 0)}
                      </td>

                      {/* Remove */}
                      <td className="px-1 py-2 text-center" style={{ width: 36 }}>
                        <button
                          type="button"
                          onClick={() =>
                            setMaterials((ms) =>
                              ms.length > 1 ? ms.filter((_, idx) => idx !== i) : [emptyMaterialRow()],
                            )
                          }
                          title="Remove this material"
                          aria-label="Remove this material"
                          className="flex h-8 w-6 items-center justify-center text-sm font-bold text-rose-500 transition hover:text-rose-700 mx-auto"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-2.5 flex items-center justify-end gap-8 rounded-lg bg-ink-50 px-3.5 py-2 text-[12px] font-bold text-ink-800">
              <span>
                Items: <span className="tabular-nums">{fmt(materialCalc.qtyCount)}</span>
              </span>
              <span>
                Total: <span className="tabular-nums">{fmt(materialCalc.total)} AED</span>
              </span>
            </div>
          </section>
        </Card>

        {/* Right Column: Payment Scenario matching JobCardForm */}
        <div className="w-full lg:w-[325px] 2xl:w-[340px] shrink-0 lg:sticky lg:top-16 self-start">
          <Card className="max-h-[calc(100vh-4.5rem)] overflow-y-auto rounded-none border-x-0 border-t-0 p-4">

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink-500">Total without Tax</span>
                <span className="font-bold tabular-nums">{fmt(calc.total)} AED</span>
              </div>
              {materialCalc.total > 0 && (
                <div className="flex items-center justify-between text-ink-500">
                  <span className="font-medium">Material Cost</span>
                  <span className="font-semibold tabular-nums">{fmt(materialCalc.total)} AED</span>
                </div>
              )}
              {/* Additional Charges */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-ink-500">Additional Charges</span>
                  <Select
                    value={additionalChargesType}
                    onChange={(e) => setAdditionalChargesType(e.target.value as 'fixed' | 'percent')}
                    className="input-sm !w-[68px] !py-0.5 !px-1.5 text-[11px] font-semibold"
                  >
                    <option value="fixed">AED</option>
                    <option value="percent">%</option>
                  </Select>
                </div>
                <NumberInput
                  value={additionalChargesInput}
                  onChange={(e) => setAdditionalChargesInput(e.target.value)}
                  className="input-sm !w-24 text-right"
                  placeholder="0"
                />
              </div>
              {/* Discount */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-ink-500">Discount</span>
                  <Select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as 'fixed' | 'percent')}
                    className="input-sm !w-[68px] !py-0.5 !px-1.5 text-[11px] font-semibold"
                  >
                    <option value="fixed">AED</option>
                    <option value="percent">%</option>
                  </Select>
                </div>
                <NumberInput
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  className="input-sm !w-24 text-right"
                  placeholder="0"
                />
              </div>
              <div className="flex items-center justify-between border-t border-ink-100 pt-1.5">
                <span className="font-medium text-ink-500">Total Before Tax</span>
                <span className="font-bold tabular-nums">{fmt(calc.taxable)} AED</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink-500">Tax ({taxRate}% VAT)</span>
                <span className="font-bold tabular-nums">+ {fmt(calc.tax)} AED</span>
              </div>
            </div>

            {/* Total Payable Green Hero Bar */}
            <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl bg-brand-700 px-3.5 py-2.5 text-white">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/80">
                  Total Payable
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-white/60">
                  Items: {calc.itemCount} ({calc.readyCount} Ready{calc.pendingCount > 0 ? `, ${calc.pendingCount} Pending` : ''}) · Quantity: {fmt(calc.qtyCount)}
                </p>
              </div>
              <p className="shrink-0 text-xl font-black tabular-nums leading-none">
                {fmt(calc.payable)}
              </p>
            </div>

            {/* Customer Due Balance */}
            <div className="mt-1.5 flex items-center justify-between gap-3 text-xs font-bold">
              {customerDue > 0 ? (
                <span className="text-rose-600">Due Balance: {fmt(customerDue)} AED</span>
              ) : (
                <span />
              )}
            </div>

            <div className="mb-3 mt-3 border-t border-ink-100" />

            {calc.advance > 0 && (
              <div className="mb-2.5 flex items-center justify-between gap-3 text-xs font-bold">
                <span className="text-emerald-700">Already Paid: {fmt(calc.advance)} AED</span>
              </div>
            )}

            {/* Split Tender payment pad */}
            <SplitTender
              due={calc.dueToPay}
              value={split}
              onChange={setSplit}
              details={tenderDetails}
              onDetailsChange={setTenderDetails}
              savedCards={savedCards}
              savedBanks={savedBanks}
              alreadyPaid={advanceBreakdown}
              onClear={handleClearMode}
              disabled={!canCreate}
              payLabel="Pay Now"
              payAmount={splitTotal(split) > 0 ? splitTotal(split) : calc.dueToPay}
              note="Taken when you press Save — it will show as paid on the invoice."
            />

            {/* Change return if customer overpaid */}
            {calc.changeReturn > 0 && (
              <div className="mt-2 flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
                <span>Change Return:</span>
                <span className="tabular-nums">{fmt(calc.changeReturn)} AED</span>
              </div>
            )}

            {/* Remaining balance if part payment */}
            {calc.balance > 0 && calc.tenderTaken > 0 && (
              <div className="mt-2 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                <span>Remaining Balance:</span>
                <span className="tabular-nums">{fmt(calc.balance)} AED</span>
              </div>
            )}

            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-rose-600">
              <input
                type="checkbox"
                checked={isReturn}
                onChange={(e) => setIsReturn(e.target.checked)}
                className="h-4 w-4 rounded border-ink-300 text-rose-600 focus:ring-rose-500"
              />
              Record this as a sales return
            </label>

            {/* Action buttons matching JobCardForm */}
            {canCreate && (
              <div className="mt-4 space-y-2">
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    className="btn-soft !py-2 text-[13px]"
                    onClick={() => void save(false)}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save Only'}
                  </button>
                  <button
                    className="btn-primary !py-2 text-[13px]"
                    onClick={() => void save(true)}
                    disabled={saving}
                  >
                    {saving ? 'Saving…' : 'Save & Print'}
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Line Note Modal */}
      <Modal
        open={infoRow >= 0}
        onClose={() => setInfoRow(-1)}
        title="Line note"
        sub={infoRow >= 0 ? rows[infoRow]?.productName || 'This line' : undefined}
        footer={
          <>
            <button className="btn-soft" onClick={() => setInfoRow(-1)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                updateRow(infoRow, { info: infoDraft.trim() });
                setInfoRow(-1);
              }}
            >
              Save note
            </button>
          </>
        }
      >
        <textarea
          autoFocus
          value={infoDraft}
          onChange={(e) => setInfoDraft(e.target.value)}
          rows={4}
          placeholder="Colour, alteration, anything to print against this line…"
          className="input resize-y"
        />
      </Modal>

      {/* Customer Modal */}
      <LedgerSearchModal
        open={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
        onSelect={pickLedger}
        startIn="newCustomer"
        seedName={partyName}
      />

      {/* Find Order / Invoice Modal */}
      <Modal
        open={jcOpen}
        onClose={() => setJcOpen(false)}
        title={isReturn ? 'Find Sales Invoice or Stitching Order' : 'Find a stitching order'}
        sub={
          isReturn
            ? 'Select a previous invoice or order to create a return'
            : 'Open or ready orders that have not been billed yet'
        }
        wide
        footer={
          <button className="btn-soft" onClick={() => setJcOpen(false)}>
            Cancel
          </button>
        }
      >
        <div className="mb-4 flex gap-2">
          <TextInput
            autoFocus
            placeholder={
              isReturn
                ? 'e.g. Bill No (e.g. 101), Order Ref, or customer name'
                : 'e.g. Ref-13051 or customer name'
            }
            value={jcQ}
            onChange={(e) => setJcQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void searchJobCards()}
          />
          <button className="btn-primary shrink-0" onClick={searchJobCards}>
            Search
          </button>
        </div>

        {/* Sales Invoices Table (when isReturn and sales exist) */}
        {isReturn && saleRows.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">
              Sales Invoices
            </h3>
            <div className="overflow-x-auto rounded-xl border border-ink-200">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/60 text-xs">
                    <th className="th">Inv No</th>
                    <th className="th">Date</th>
                    <th className="th">Customer</th>
                    <th className="th text-right">Net Amount</th>
                    <th className="th text-right">Advance</th>
                    <th className="th text-right">Balance</th>
                    <th className="th text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-50 text-xs">
                  {saleRows.map((s) => (
                    <tr
                      key={s._id}
                      className="cursor-pointer hover:bg-brand-50 transition-colors"
                      onClick={() => loadFromSale(s)}
                    >
                      <td className="td font-mono font-bold text-brand-700">
                        {s.billNo}
                      </td>
                      <td className="td">{fmtDate(s.billDate)}</td>
                      <td className="td font-semibold">{s.partyName || '—'}</td>
                      <td className="td text-right font-bold tabular-nums">
                        {fmt(s.netAmount)}
                      </td>
                      <td className="td text-right tabular-nums text-emerald-600">
                        {fmt(s.advanceAmount)}
                      </td>
                      <td className="td text-right font-bold tabular-nums text-brass-600">
                        {fmt(s.balance)}
                      </td>
                      <td className="td text-center">
                        {s.isReturn ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                            ↩ Return
                          </span>
                        ) : s.orderStatus ? (
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            s.orderStatus === 'delivered'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : s.orderStatus === 'partially_ready'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-ink-100 text-ink-700'
                          }`}>
                            {s.orderStatus === 'partially_ready' ? 'Partially Ready' : s.orderStatus.replace('_', ' ')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                            ✓ Delivered
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stitching Orders Table */}
        {jcRows.length > 0 && (
          <div>
            {isReturn && (
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-500">
                Stitching Orders
              </h3>
            )}
            <div className="overflow-x-auto rounded-xl border border-ink-200">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50/60 text-xs">
                    <th className="th">Inv No</th>
                    <th className="th">Book No</th>
                    <th className="th">Ref</th>
                    <th className="th">Customer</th>
                    <th className="th text-right">Net</th>
                    <th className="th text-right">Advance</th>
                    <th className="th text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-50 text-xs">
                  {jcRows.map((j) => (
                    <tr
                      key={j._id}
                      className="cursor-pointer hover:bg-brand-50 transition-colors"
                      onClick={() => convertFrom(j)}
                    >
                      <td className="td font-mono font-bold text-brand-700">
                        {j.invoiceNo ? j.invoiceNo.replace(/^B-?/i, '') : '—'}
                      </td>
                      <td className="td font-mono font-bold text-ink-700">
                        {j.bookNo ?? j.no}
                      </td>
                      <td className="td font-mono text-ink-600">{j.ref}</td>
                      <td className="td font-semibold">{j.partyName || '—'}</td>
                      <td className="td text-right tabular-nums">{fmt(j.netAmount)}</td>
                      <td className="td text-right tabular-nums text-emerald-600">{fmt(j.advance)}</td>
                      <td className="td text-center">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          j.status === 'delivered'
                            ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                            : j.status === 'partially_ready'
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-brand-100 text-brand-800'
                        }`}>
                          {j.status === 'partially_ready' ? 'Partially Ready' : j.status?.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
