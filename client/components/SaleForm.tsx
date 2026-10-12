'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { fmt, fmtDate, num, todayISO, toISODate } from '@/lib/format';
import type { JobCard, Ledger, LedgerDue, Product, SavedBank, SavedCard } from '@/lib/types';
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
  const [materials, setMaterials] = useState<MaterialRow[]>([emptyMaterialRow()]);

  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('fixed');
  const [discountInput, setDiscountInput] = useState('0');
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

  /* ------------------------------------------------------------- figures */

  const calc = useMemo(() => {
    const lines = rows.map((r) => {
      const qty = num(r.qty);
      const rate = num(r.rate);
      const gross = r2(qty * rate);
      const input = num(r.discInput);
      const discAmt =
        r.discType === 'percent' ? r2((gross * input) / 100) : r2(Math.min(input, gross));
      return { subtotal: r2(gross - discAmt), discAmt, qty, rate, gross };
    });
    const charged = rows.filter((r) => r.code?.trim() || r.productName?.trim() || num(r.rate) > 0);
    const itemCount = charged.length;
    const qtyCount = r2(lines.reduce((s, l) => s + l.qty, 0));
    const total = r2(lines.reduce((s, l) => s + l.subtotal, 0));

    const dIn = num(discountInput);
    const orderDiscount =
      discountType === 'percent' ? r2((total * dIn) / 100) : r2(Math.min(dIn, total));
    const taxable = r2(Math.max(total - orderDiscount, 0));
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
      total,
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
  }, [rows, discountType, discountInput, taxRate, advancePaid, split]);

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
      const r = await api.jobCards.list(jcQ, '', 1, 10);
      setJcRows(r.items.filter((j) => j.status !== 'converted'));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Search failed', 'error');
    }
  }

  const convertFrom = useCallback(
    async (j: JobCard) => {
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

      const bd: Record<TenderMode, number> = { cash: 0, card: 0, bank: 0 };
      if (j.payments && j.payments.length > 0) {
        for (const p of j.payments) {
          const m = (p.mode === 'credit' ? 'cash' : p.mode) as TenderMode;
          if (m in bd) {
            bd[m] = r2(bd[m] + num(p.amount));
          }
        }
      } else if (num(j.advance) > 0) {
        const m = ((j.paymentMode as TenderMode) || 'cash');
        if (m in bd) {
          bd[m] = r2(num(j.advance));
        }
      }
      setAdvanceBreakdown(bd);

      const allRows: SaleRow[] = [];
      if (j.items && j.items.length > 0) {
        allRows.push(
          ...j.items.map((i) => ({
            ...emptyRow(),
            code: i.code ?? '',
            productName: i.productName ?? '',
            qty: String(i.qty),
            rate: String(i.rate),
            info: '',
          })),
        );
      }
      if (num(j.additionalCharges) > 0) {
        allRows.push({
          ...emptyRow(),
          code: 'EXTRA',
          productName: 'Additional Charges',
          qty: '1',
          rate: String(j.additionalCharges),
        });
      }
      if (allRows.length > 0) {
        setRows(allRows);
      }

      // Load materials used from the job card (both per-person sets and legacy list)
      const loadedMaterials: MaterialRow[] = [];
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
      if (loadedMaterials.length > 0) {
        setMaterials(loadedMaterials);
      } else {
        setMaterials([emptyMaterialRow()]);
      }

      if (j.discount) {
        setDiscountType('fixed');
        setDiscountInput(String(j.discount));
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
      toast(`Loaded stitching order ${j.ref} — advance ${fmt(j.advance)} AED applied`, 'info');
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
    const filled = rows.filter((r) => r.code || r.productName || num(r.rate));
    if (filled.length === 0) {
      toast('Add at least one item', 'error');
      return;
    }
    if (!partyName.trim()) {
      toast('Customer is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const totalCash = r2(advanceBreakdown.cash + num(split.cash));
      const totalCard = r2(advanceBreakdown.card + num(split.card));
      const totalBank = r2(advanceBreakdown.bank + num(split.bank));

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
      } else if (calc.totalPaid === 0) {
        method = 'credit';
      }

      const card = tenderDetails.card;
      const bankT = tenderDetails.bank;
      const usedCard = num(split.card) > 0;
      const usedBank = num(split.bank) > 0;

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
        items: filled.map((r) => ({
          code: r.code,
          productName: r.productName,
          unit: r.unit,
          qty: num(r.qty),
          rate: num(r.rate),
          discType: r.discType,
          discInput: num(r.discInput),
          warranty: num(r.warranty),
          info: r.info,
        })),
        materialsUsed: materials
          .filter((m) => m.code || m.productName || num(m.rate))
          .map((m) => ({
            code: m.code,
            productName: m.productName,
            qty: num(m.qty),
            rate: num(m.rate),
          })),
        materialTotal: materialCalc.total,
        discountType,
        discountInput: num(discountInput),
        advanceAmount: calc.totalPaid,
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
      router.push(andPrint ? `/sales/${sale._id}?print=1` : `/sales/${sale._id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  const customerDue = due ? r2(due.due) : 0;

  return (
    <div className="pb-16 text-[12px]">
      <div className="flex flex-col xl:flex-row items-start">
        {/* Left Column: Header details & Sale Items table */}
        <Card className="w-full min-w-0 flex-1 rounded-none border-x-0 border-t-0 xl:border-r">
          {/* Header fields */}
          <section className="p-4 sm:p-5">
            <div className="mb-5 flex items-baseline justify-center gap-3">
              <p className="text-lg font-extrabold tracking-tight text-ink-900">
                {isReturn ? 'Sales Return:' : 'Sale Invoice:'}
              </p>
              <p className="text-3xl font-black leading-none tabular-nums text-ink-900">
                {billNo ?? '…'}
              </p>
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
                  <label className="label mb-0">Ref No</label>
                </div>
                <TextInput
                  value={refNo || (billNo ? `B-${billNo}` : '')}
                  onChange={(e) => setRefNo(e.target.value)}
                  placeholder="Ref No"
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
              <h2 className="text-base font-extrabold tracking-tight text-ink-900">Sale Items</h2>
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
                  <col style={{ width: 142 }} />
                  <col style={{ width: 60 }} />
                  <col style={{ width: 108 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 38 }} />
                  <col style={{ width: 104 }} />
                  <col style={{ width: 60 }} />
                  <col style={{ width: 28 }} />
                </colgroup>
                <thead className="bg-ink-50">
                  <tr className="text-center text-xs font-bold text-ink-700">
                    <th className="th-s py-2 pl-3 text-left" style={{ width: 142 }}>Product</th>
                    <th className="th-s py-2 text-center" style={{ width: 60 }}>Quantity</th>
                    <th className="th-s py-2 text-center" style={{ width: 108 }}>Unit Price</th>
                    <th className="th-s py-2 text-center" style={{ width: 90 }}>Discount</th>
                    <th className="th-s py-2 text-center" style={{ width: 38 }}>Warranty</th>
                    <th className="th-s py-2 text-center" style={{ width: 104 }}>Info</th>
                    <th className="th-s py-2 text-center" style={{ width: 60 }}>Subtotal</th>
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
                    <tr key={i} className="hover:bg-emerald-50/40 transition-colors">
                      {/* Product */}
                      <td className="px-2 py-2" style={{ width: 142 }}>
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
                      <td className="px-0.5 py-2" style={{ width: 108 }}>
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
                      <td className="px-0.5 py-2" style={{ width: 90 }}>
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
                      <td className="px-0.5 py-2" style={{ width: 104 }}>
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
                        className="px-0.5 py-2 text-center text-xs font-bold tabular-nums text-ink-900 leading-8 whitespace-nowrap"
                        style={{ width: 60 }}
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

            <div className="mt-2.5 flex items-center justify-end gap-8 rounded-lg bg-ink-50 px-3.5 py-2 text-[12px] font-bold text-ink-800">
              <span>
                Items: <span className="tabular-nums">{fmt(calc.qtyCount)}</span>
              </span>
              <span>
                Total: <span className="tabular-nums">{fmt(calc.total)} AED</span>
              </span>
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
        <div className="w-full xl:w-[325px] 2xl:w-[340px] shrink-0">
          <Card className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-none border-x-0 border-t-0 p-4">
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
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-ink-500">Discount</span>
                <div className="flex items-center gap-1.5">
                  <NumberInput
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    className="input-sm !w-24 text-right"
                  />
                  <Select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as 'fixed' | 'percent')}
                    className="input-sm !w-20 !py-1 text-[11px]"
                  >
                    <option value="fixed">AED</option>
                    <option value="percent">%</option>
                  </Select>
                </div>
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
                  Items: {calc.itemCount} · Quantity: {fmt(calc.qtyCount)}
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

      {/* Find Order Modal */}
      <Modal
        open={jcOpen}
        onClose={() => setJcOpen(false)}
        title="Find a stitching order"
        sub="Open or closed orders that have not been billed yet"
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
            placeholder="e.g. Ref-13051 or customer name"
            value={jcQ}
            onChange={(e) => setJcQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void searchJobCards()}
          />
          <button className="btn-primary shrink-0" onClick={searchJobCards}>
            Search
          </button>
        </div>
        {jcRows.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-ink-100">
                <th className="th">Book No</th>
                <th className="th">Ref</th>
                <th className="th">Customer</th>
                <th className="th text-right">Net</th>
                <th className="th text-right">Advance</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {jcRows.map((j) => (
                <tr
                  key={j._id}
                  className="cursor-pointer hover:bg-brand-50"
                  onClick={() => convertFrom(j)}
                >
                  <td className="td font-mono text-xs font-bold text-brand-700">
                    {j.bookNo ?? j.no}
                  </td>
                  <td className="td font-mono text-xs text-ink-600">{j.ref}</td>
                  <td className="td">{j.partyName || '—'}</td>
                  <td className="td text-right tabular-nums">{fmt(j.netAmount)}</td>
                  <td className="td text-right tabular-nums text-emerald-600">{fmt(j.advance)}</td>
                  <td className="td capitalize">{j.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </div>
  );
}
