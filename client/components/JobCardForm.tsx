'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { addDaysISO, fmt, fmtDate, num, orderNo, todayISO, toISODate } from '@/lib/format';
import {
  MEASURE_FIELDS,
  type JobCard,
  type JobCardPayment,
  type Ledger,
  type LedgerDue,
  type PaymentMode,
  type Product,
  type SavedBank,
  type SavedCard,
} from '@/lib/types';
import { useSettings } from './SettingsContext';
import { useToast } from './Toast';
import { useAuth } from './AuthContext';
import { MeasurementSets, materialsTotal, newSet, type EditableSet } from './MeasurementSets';
import {
  Card,
  DateInput,
  Field,
  NumberInput,
  StatusBadge,
  TextInput,
} from './ui';
import { Modal } from './Modal';
import { LedgerSearchModal } from './LedgerSearchModal';
import { LedgerSearchInput } from './LedgerSearchInput';
import { LedgerFormModal } from './LedgerFormModal';
import {
  SplitTender,
  emptySplit,
  emptyDetails,
  last4,
  type Split,
  type TenderDetails,
  type TenderMode,
} from './SplitTender';
import { ProductSearchInput } from './ProductSearchInput';
import { AttachSizePicker } from './AttachSizePicker';
import { useLeaveGuard } from './LeaveGuard';
import { Icon } from '@/components/icons';

interface ItemRow {
  code: string;
  productName: string;
  qty: string;
  rate: string;
  /** The measurement set this line is stitched to, or '' for none. */
  personUid: string;
}
const emptyItem = (personUid = ''): ItemRow => ({
  code: '',
  productName: '',
  qty: '1',
  rate: '',
  personUid,
});
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Build the per-person blocks from a saved card. Cards written before this
 * feature carry one unnamed set in the legacy fields, so lift that across
 * instead of dropping it.
 */
function setsFromCard(card?: JobCard | null): EditableSet[] {
  // Orders saved before materials moved per-person carry one shared list;
  // hand it to the first person so nothing is lost on the next save.
  const legacyMaterials = (card?.materialsUsed ?? []).map((m) => ({
    code: m.code ?? '',
    productName: m.productName ?? '',
    qty: m.qty ?? 0,
    rate: m.rate ?? 0,
  }));

  if (card?.measurementSets?.length) {
    const anyPerPerson = card.measurementSets.some((m) => (m.materials ?? []).length > 0);
    return card.measurementSets.map((m, i) =>
      newSet({
        // Keep the uid the order was saved with, so the lines pointing at
        // this person still find them. Older orders have none; they get a
        // fresh one and simply start out unattached.
        ...(m.uid ? { uid: m.uid } : {}),
        profileId: m.profileId,
        name: m.name ?? '',
        age: m.age ?? null,
        fabric: m.fabric ?? '',
        size: m.size ?? '',
        qty: m.qty ?? 1,
        values: { ...m.values },
        materials:
          (m.materials ?? []).length > 0
            ? m.materials!.map((x) => ({ ...x }))
            : !anyPerPerson && i === 0
              ? legacyMaterials
              : [],
      }),
    );
  }
  const legacy = { ...(card?.measurements ?? {}) };
  delete legacy.FABRIC_CONSUMPTION;
  if (Object.keys(legacy).length || card?.fabric || card?.size) {
    return [
      newSet({
        name: card?.partyName ?? '',
        fabric: card?.fabric ?? '',
        size: card?.size ?? '',
        values: legacy,
        materials: legacyMaterials,
      }),
    ];
  }
  return [];
}

export function JobCardForm({ initial, mode }: { initial?: JobCard | null; mode: 'new' | 'edit' }) {
  const router = useRouter();
  const { toast } = useToast();
  const { settings } = useSettings();
  const taxRate = settings.taxRate;

  // ---- header ----
  const [no, setNo] = useState<number | null>(initial?.no ?? null);
  const [bookNo, setBookNo] = useState(String(initial?.bookNo ?? settings.bookNo));
  const [ref, setRef] = useState(initial?.ref ?? '');
  const [date, setDate] = useState(toISODate(initial?.date) || todayISO());
  const [deliveryDate, setDeliveryDate] = useState(
    toISODate(initial?.deliveryDate) || addDaysISO(todayISO(), settings.deliveryDays),
  );
  const [partyName, setPartyName] = useState(initial?.partyName ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [ledgerId, setLedgerId] = useState(initial?.ledgerId ?? '');
  const [isNew, setIsNew] = useState(initial?.isNewCustomer ?? false);
  const [accountsAc, setAccountsAc] = useState(initial?.accountsAc ?? '');
  const [invoiceNo, setInvoiceNo] = useState(initial?.invoiceNo ?? '');

  // ---- grids ----
  // One block per person. Old cards carry a single unnamed set, so lift that
  // into the new shape on open rather than losing it.
  const [sets, setSets] = useState<EditableSet[]>(() => {
    const saved = setsFromCard(initial);
    // Every order is stitched for somebody, so a new one starts with the first
    // person's block open rather than an empty state. The server drops a block
    // left wholly blank, so this costs nothing if it goes unused.
    return saved.length === 0 && mode === 'new' ? [newSet()] : saved;
  });
  const [items, setItems] = useState<ItemRow[]>(() => {
    if (initial?.items?.length) {
      return initial.items.map((i) => ({
        code: i.code ?? '',
        productName: i.productName ?? '',
        qty: String(i.qty ?? ''),
        rate: String(i.rate ?? ''),
        personUid: i.personUid ?? '',
      }));
    }
    return [emptyItem(sets[0]?.uid ?? '')];
  });
  const [discount, setDiscount] = useState(String(initial?.discount ?? '0'));
  const [additionalCharges, setAdditionalCharges] = useState(
    String(initial?.additionalCharges ?? '0'),
  );
  // No longer asked for on the form. Kept so that re-saving an order written
  // before the field was removed does not strip what it was saved with.
  const [fabricConsumption, setFabricConsumption] = useState(
    initial?.measurements?.FABRIC_CONSUMPTION ?? '',
  );
  const [jobCost, setJobCost] = useState(String(initial?.jobCost ?? '0'));
  const [collapseSignal, setCollapseSignal] = useState(0);

  // ---- payment panel ----
  const [paymentMode, setPaymentMode] = useState<'cash' | 'bank' | 'card'>(
    initial?.paymentMode ?? 'cash',
  );
  const [bank, setBank] = useState(initial?.bank ?? '');
  const [creditCardNo, setCreditCardNo] = useState(initial?.creditCardNo ?? '');
  const [payments, setPayments] = useState<JobCardPayment[]>(() => {
    if (initial?.payments && initial.payments.length > 0) return initial.payments;
    if (initial && num(initial.advance) > 0) {
      return [
        {
          date: initial.date ? toISODate(initial.date) : todayISO(),
          mode: (initial.paymentMode as PaymentMode) || 'cash',
          amount: num(initial.advance),
          discount: 0,
        },
      ];
    }
    return [];
  });
  // What is being handed over right now, before it is recorded. Held apart
  // from `payments`, which is only ever what the server has already booked.
  const [split, setSplit] = useState<Split>(emptySplit);
  const [tenderDetails, setTenderDetails] = useState<TenderDetails>(emptyDetails);
  const [payingSplit, setPayingSplit] = useState(false);
  // What this customer has paid with before, offered instead of retyped.
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [savedBanks, setSavedBanks] = useState<SavedBank[]>([]);
  // What they owe from before this order, shown under their name.
  const [due, setDue] = useState<LedgerDue | null>(null);
  const [neighbours, setNeighbours] = useState({ prev: false, next: false });
  const [status, setStatus] = useState(initial?.status ?? 'open');

  // ---- ui ----
  const [saving, setSaving] = useState(false);
  const [filing, setFiling] = useState(false);
  /** True once this form has been saved properly. */
  const settled = useRef(false);
  // Only ever opened to add somebody: an existing customer is found by typing
  // into the name box itself.
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [editCustomerOpen, setEditCustomerOpen] = useState(false);
  const [editingLedger, setEditingLedger] = useState<Ledger | null>(null);

  async function handleEditCustomer() {
    if (!ledgerId) {
      setEditingLedger(null);
      setEditCustomerOpen(true);
      return;
    }
    try {
      const l = await api.ledgers.get(ledgerId);
      setEditingLedger(l);
      setEditCustomerOpen(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load customer details', 'error');
    }
  }

  /** Set when an order line is asked to show the person it is stitched to. */
  const [reveal, setReveal] = useState<{ uid: string; at: number } | null>(null);
  /** Currently active/selected person UID for light green highlighting. */
  const [activePersonUid, setActivePersonUid] = useState<string>('');
  /** The row just opened by the Save under the measurements, ringed briefly. */
  const [freshItem, setFreshItem] = useState(-1);
  const itemRowsRef = useRef<HTMLTableSectionElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [findRows, setFindRows] = useState<JobCard[]>([]);

  const docId = initial?._id;
  const readOnly = status === 'converted';

  // Hide the actions this user cannot perform; the API enforces the same rules.
  const { can } = useAuth();
  const canSave = mode === 'new' ? can('jobcards.create') : can('jobcards.edit');
  const canPay = can('jobcards.payment');
  const canAddLedger = can('ledgers.manage');
  const canConvert = can('jobcards.convert');

  // New mode: fetch next number
  useEffect(() => {
    if (mode !== 'new') return;
    (async () => {
      try {
        const n = await api.jobCards.next();
        setNo(n.no);
        setRef(n.ref);
        if (n.bookNo != null) setBookNo(String(n.bookNo));
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not get next number', 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---- computed ----
  const calc = useMemo(() => {
    const rows = items.map((r) => {
      const q = num(r.qty);
      const rt = num(r.rate);
      return { ...r, qty: q, rate: rt, amount: r2(q * rt) };
    });
    const total = r2(rows.reduce((s, r) => s + r.amount, 0));
    // Charges join the taxable base beside the items, exactly as the server
    // computes it — the two must never disagree.
    const extra = r2(num(additionalCharges));
    const d = r2(num(discount));
    const taxable = Math.max(total + extra - d, 0);
    const tax = r2(taxable * (taxRate / 100));
    const netAmount = r2(taxable + tax);
    const advance = r2(payments.reduce((s, p) => s + num(p.amount), 0));
    const advanceBeforeTax = r2(advance / (1 + taxRate / 100));
    const advanceTax = r2(advance - advanceBeforeTax);
    const balance = r2(netAmount - advance);
    const materialTotal = r2(sets.reduce((s, p) => s + materialsTotal(p.materials), 0));
    // What the counter reads out: how many lines were charged and how many
    // pieces that came to. Blank rows are still in `items` as placeholders, so
    // only rows that actually carry a product are counted.
    const charged = rows.filter((r) => r.productName?.trim() || r.amount > 0);
    const itemCount = charged.length;
    const qtyCount = r2(charged.reduce((s, r) => s + r.qty, 0));
    return { rows, total, additionalCharges: extra, discount: d, taxable, tax, netAmount, advance, advanceBeforeTax, advanceTax, balance, materialTotal, itemCount, qtyCount };
  }, [items, discount, additionalCharges, payments, sets, taxRate]);

  const advanceBreakdown = useMemo(() => {
    const bd: Record<TenderMode, number> = { cash: 0, card: 0, bank: 0 };
    for (const p of payments) {
      const m = (p.mode === 'credit' ? 'cash' : p.mode) as TenderMode;
      if (m in bd) {
        bd[m] = r2(bd[m] + num(p.amount));
      }
    }
    return bd;
  }, [payments]);

  /**
   * What this customer owed before this order.
   *
   * The server's figure counts every open order they have, which on an edit
   * page includes this one — so its own saved balance comes back off, or the
   * order would appear to be chasing itself. A new order is not saved yet and
   * so is not in the figure at all.
   */
  /**
   * What the order cost the shop to make, and what is left over after it.
   *
   * The margin is taken against the items' own price — before VAT, which is
   * the government's money rather than the shop's, and before the charges and
   * discount that are settled at the till.
   */
  const totalCost = useMemo(() => r2(calc.materialTotal + num(jobCost)), [calc.materialTotal, jobCost]);
  const margin = useMemo(() => r2(calc.total - totalCost), [calc.total, totalCost]);

  const priorDue = useMemo(() => {
    const all = due?.due ?? 0;
    const mine = mode === 'edit' ? num(initial?.balance) : 0;
    return r2(all - mine);
  }, [due, mode, initial?.balance]);

  function loadDoc(d: JobCard) {
    setNo(d.no ?? null);
    setBookNo(String(d.bookNo));
    setRef(d.ref);
    setDate(toISODate(d.date) || todayISO());
    setDeliveryDate(toISODate(d.deliveryDate) || '');
    setPartyName(d.partyName ?? '');
    setPhone(d.phone ?? '');
    setLedgerId(d.ledgerId ?? '');
    setIsNew(!!d.isNewCustomer);
    setAccountsAc(d.accountsAc ?? '');
    setInvoiceNo(d.invoiceNo ?? '');
    setItems(
      d.items.length
        ? d.items.map((i) => ({
          code: i.code ?? '',
          productName: i.productName ?? '',
          qty: String(i.qty),
          rate: String(i.rate),
          personUid: i.personUid ?? '',
        }))
        : [emptyItem()],
    );
    setDiscount(String(d.discount));
    setAdditionalCharges(String(d.additionalCharges ?? 0));
    setSets(setsFromCard(d));
    setFabricConsumption(d.measurements?.FABRIC_CONSUMPTION ?? '');
    setJobCost(String(d.jobCost));
    setPaymentMode(d.paymentMode ?? 'cash');
    setBank(d.bank ?? '');
    setCreditCardNo(d.creditCardNo ?? '');
    if (d.payments && d.payments.length > 0) {
      setPayments(d.payments);
    } else if (num(d.advance) > 0) {
      setPayments([
        {
          date: d.date ? toISODate(d.date) : todayISO(),
          mode: (d.paymentMode as PaymentMode) || 'cash',
          amount: num(d.advance),
          discount: 0,
        },
      ]);
    } else {
      setPayments([]);
    }
    setStatus(d.status);
  }

  function payload() {
    return {
      bookNo: num(bookNo, settings.bookNo),
      ref: ref.trim(),
      date,
      deliveryDate: deliveryDate || undefined,
      partyName: partyName.trim(),
      phone: phone.trim(),
      ledgerId: ledgerId || undefined,
      isNewCustomer: isNew,
      accountsAc: accountsAc.trim(),
      invoiceNo: invoiceNo.trim(),
      items: calc.rows
        .filter((r) => r.code || r.productName || r.qty || r.rate)
        .map((r) => ({
          code: r.code,
          productName: r.productName,
          qty: r.qty,
          rate: r.rate,
          // Only a person still on the order counts; one who has been deleted
          // would leave the line pointing at nobody.
          personUid: sets.some((p) => p.uid === r.personUid) ? r.personUid : undefined,
        })),
      additionalCharges: calc.additionalCharges,
      discount: calc.discount,
      taxRate,
      // The first person also fills the legacy fields, so older prints and any
      // card saved before this feature keep rendering.
      measurements: { ...(sets[0]?.values ?? {}), FABRIC_CONSUMPTION: fabricConsumption },
      fabric: sets[0]?.fabric ?? '',
      size: sets[0]?.size ?? '',
      measurementSets: sets.map((m) => ({
        uid: m.uid,
        profileId: m.profileId,
        // The server files everyone named here against the customer; this says
        // who to leave off, for a one-off nobody wants on the books.
        remember: m.remember !== false,
        name: m.name.trim(),
        stitchingStyle: m.stitchingStyle,
        age: m.age ?? null,
        fabric: m.fabric,
        size: m.size,
        qty: Number(m.qty) || 0,
        values: m.values,
        materials: (m.materials ?? [])
          .filter((r) => r.code || r.productName || num(r.qty) || num(r.rate))
          .map((r) => ({
            code: r.code,
            productName: r.productName,
            qty: num(r.qty),
            rate: num(r.rate),
          })),
      })),
      // Materials live on each person now; the shared list stays empty.
      materialsUsed: [],
      materialTotal: calc.materialTotal,
      jobCost: num(jobCost),
      paymentMode,
      bank,
      creditCardNo,
    };
  }

  /**
   * The Save under the measurements finishes one person and sets up the next.
   * It does not save the order — that is the pair of buttons in the payment
   * panel.
   *
   * Three things happen: everyone named is filed against the customer so
   * their sizes are offered next time, a fresh block is opened for the next
   * person, and an order line is opened already attached to them. The page
   * then goes to that line, because what the counter does next is name the
   * garment being made.
   *
   * The block and the line are opened either way: somebody who has not picked
   * a customer yet still wants both.
   */
  async function fileMeasurements() {
    const keep = sets.filter((m) => m.remember !== false && m.name.trim());
    setFiling(true);
    try {
      if (!ledgerId) {
        toast('Measurements are filed against a customer — pick one above first', 'info');
      } else if (keep.length === 0) {
        toast('Give each person a name to keep their measurements on file', 'info');
      } else {
        await Promise.all(
          keep.map((m) =>
            api.measurements.save({
              ledgerId,
              name: m.name.trim(),
              stitchingStyle: m.stitchingStyle,
              fabric: m.fabric,
              size: m.size,
              values: m.values,
            }),
          ),
        );
        toast(`${keep.length} ${keep.length === 1 ? 'person' : 'people'} kept on file`);
        setCollapseSignal(Date.now());
      }
      // The next person, and the line that will be stitched for them.
      const next = newSet();
      setSets((prev) => [...prev, next]);
      setFreshItem(items.length);
      setItems((rows) => [...rows, emptyItem(next.uid)]);
      // One tick later, once the row is actually in the table.
      setTimeout(() => {
        const row = itemRowsRef.current?.lastElementChild;
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
      setTimeout(() => setFreshItem(-1), 1600);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not keep the measurements on file', 'error');
    } finally {
      setFiling(false);
    }
  }

  function handleClearMode(m: TenderMode) {
    setSplit((prev) => ({ ...prev, [m]: '' }));
    setPayments((prev) => prev.filter((p) => (p.mode === 'credit' ? 'cash' : p.mode) !== m));
  }

  /**
   * @param andPrint hand over to the order's invoice with the print dialog
   *   opening, rather than staying on the form.
   */
  async function save(andPrint = false) {
    if (!partyName.trim()) {
      toast('Customer Name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      let doc: JobCard | null = null;
      if (mode === 'new') {
        doc = await api.jobCards.create(payload());
      } else if (docId) {
        doc = await api.jobCards.update(docId, payload());
      }
      if (!doc) return;
      settled.current = true;

      // Anything counted on the tender pad is taken with the order. That is
      // the whole point of letting it be counted before the order exists:
      // the customer is handing money over now, and Save & Print must put it
      // on the invoice as paid rather than print a sheet saying it is owed.
      const taken = await bookSplit(doc._id, doc.balance, false);

      const what = mode === 'new' ? `Order ${doc.no} saved` : `Order ${doc.no} updated`;
      toast(taken > 0 ? `${what} · ${fmt(taken)} AED taken` : what);

      // Saved and done with: the form hands over to the invoice or back to
      // the list rather than sitting on a screen whose work is complete.
      router.push(andPrint ? `/job-cards/${doc._id}/invoice?print=1` : '/job-cards');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveAndConvert() {
    if (!partyName.trim()) {
      toast('Customer Name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      let doc: JobCard | null = null;
      if (mode === 'new') {
        doc = await api.jobCards.create(payload());
      } else if (docId) {
        doc = await api.jobCards.update(docId, payload());
      }
      if (!doc) return;
      settled.current = true;

      const taken = await bookSplit(doc._id, doc.balance, false);
      const what = `Order ${doc.no} updated · Shifting to New Sale`;
      toast(taken > 0 ? `${what} · ${fmt(taken)} AED recorded` : what);

      router.push(`/sales/new?fromJobCard=${doc._id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Has anything actually been typed? Opening New Order and changing your mind
   * is not work worth warning about. The fields the form pre-fills on its own
   * — number, ref, dates, book no — deliberately do not count.
   */
  function hasContent(): boolean {
    if (partyName.trim() || phone.trim()) return true;
    if (num(discount) || num(additionalCharges) || num(jobCost)) return true;
    if (items.some((r) => r.code.trim() || r.productName.trim() || num(r.rate))) return true;
    return sets.some(
      (p) =>
        p.name.trim() ||
        (p.fabric ?? '').trim() ||
        (p.size ?? '').trim() ||
        Object.values(p.values).some((v) => String(v).trim()) ||
        (p.materials ?? []).some(
          (m) => (m.code ?? '').trim() || (m.productName ?? '').trim() || num(m.rate),
        ),
    );
  }

  /**
   * Work in a New Order that has not been saved is just gone once the page
   * changes, so leaving is worth asking about. An order already on file is
   * not covered — what is on screen there is still on file.
   */
  const unsaved = mode === 'new' && !settled.current && hasContent();
  const leaveGuard = useLeaveGuard(unsaved && !saving);

  /**
   * What this customer has paid with before. Fetched when the customer
   * changes rather than on every render, and cleared for a walk-in, so the
   * card pad never offers someone else's card.
   */
  useEffect(() => {
    if (!ledgerId) {
      setSavedCards([]);
      setSavedBanks([]);
      setDue(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const l = await api.ledgers.get(ledgerId);
        if (!live) return;
        setSavedCards(l.savedCards ?? []);
        setSavedBanks(l.savedBanks ?? []);
      } catch {
        if (live) {
          setSavedCards([]);
          setSavedBanks([]);
        }
      }
      try {
        const d = await api.ledgers.due(ledgerId);
        if (live) setDue(d);
      } catch {
        // Not worth a toast: the order can be written without knowing.
        if (live) setDue(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [ledgerId]);

  /**
   * Whether an order exists either side of this one, so the buttons can say
   * so rather than letting someone press a dead end and get a toast. Asked of
   * the same endpoint the buttons use, so the answer cannot disagree with it.
   */
  useEffect(() => {
    if (mode !== 'edit' || no == null) {
      setNeighbours({ prev: false, next: false });
      return;
    }
    let live = true;
    void (async () => {
      const [prev, next] = await Promise.all(
        (['prev', 'next'] as const).map((dir) =>
          api.jobCards.adjacent(no, dir).then(
            () => true,
            () => false,
          ),
        ),
      );
      if (live) setNeighbours({ prev, next });
    })();
    return () => {
      live = false;
    };
  }, [mode, no]);

  async function navigate(dir: 'prev' | 'next') {
    if (no == null) return;
    try {
      const d = await api.jobCards.adjacent(no, dir);
      router.push(`/job-cards/${d._id}`);
    } catch {
      toast(dir === 'prev' ? 'This is the first stitching order' : 'This is the last stitching order', 'info');
    }
  }


  /**
   * Book whatever is on the tender pad against an order, one payment per
   * tender used, and return what was actually taken.
   *
   * Each goes through the same endpoint a part payment uses, so nothing about
   * how a payment is booked changes — only how many are sent. Anything handed
   * over above the balance is change, so only the balance is ever recorded.
   *
   * Two callers: the Advance button on an order that already exists, and Save
   * on one being created, where the money is taken in the same breath as the
   * order. The second does not want the form reloaded underneath it, because
   * it is about to leave the page.
   */
  async function bookSplit(id: string, due: number, refresh: boolean): Promise<number> {
    const entries = (['cash', 'card', 'bank'] as TenderMode[])
      .map((mode) => ({ mode, amount: num(split[mode]) }))
      .filter((e) => e.amount > 0);
    if (!entries.length) return 0;

    // Trim the last tender back so the booked total never exceeds the balance.
    let left = Math.max(due, 0);
    const booked: { mode: TenderMode; amount: number }[] = [];
    for (const e of entries) {
      const take = r2(Math.min(e.amount, left));
      if (take > 0) booked.push({ mode: e.mode, amount: take });
      left = r2(left - take);
      if (left <= 0) break;
    }
    if (!booked.length) return 0;

    const card = tenderDetails.card;
    const bankT = tenderDetails.bank;
    let latest: JobCard | null = null;
    for (const b of booked) {
      latest = await api.jobCards.addPayment(id, {
        mode: b.mode,
        amount: b.amount,
        discount: 0,
        // The card number itself is deliberately not sent: the server keeps
        // the last four and nothing else, so there is no reason to put the
        // whole number on the wire. The CVC never leaves this component.
        ...(b.mode === 'card'
          ? {
            cardHolder: card.holder,
            cardLast4: last4(card.number),
            cardExpiry: card.expiry,
          }
          : {}),
        ...(b.mode === 'bank'
          ? {
            bank: bankT.bankName,
            accountName: bankT.accountName,
            iban: bankT.iban,
            swift: bankT.swift,
          }
          : {}),
      });
    }
    if (refresh && latest) loadDoc(latest);

    // Remember the details against the customer, so the next order offers
    // them instead of asking again. A failure here must not look like a
    // failed payment — the money is already booked.
    const usedCard = booked.some((b) => b.mode === 'card');
    const usedBank = booked.some((b) => b.mode === 'bank');
    if (ledgerId && (usedCard || usedBank)) {
      try {
        const saved = await api.ledgers.savePaymentDetails(ledgerId, {
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
        setSavedCards(saved.savedCards ?? []);
        setSavedBanks(saved.savedBanks ?? []);
      } catch {
        // Nothing to tell the counter: the payment went through either way.
      }
    }

    setSplit(emptySplit());
    setTenderDetails(emptyDetails());
    return r2(booked.reduce((t, b) => t + b.amount, 0));
  }

  /** The Advance button, on an order that already has a number. */
  async function paySplit() {
    if (!docId) return;
    setPayingSplit(true);
    try {
      const total = await bookSplit(docId, calc.balance, true);
      if (total <= 0) {
        toast('Nothing left to pay on this order', 'info');
        return;
      }
      toast(`Payment of ${fmt(total)} AED recorded`);
      // Taking the money is the moment the invoice is wanted, so the pad hands
      // straight over to it with the print dialog already opening. The payment
      // is saved before this runs, so a cancelled print changes nothing.
      router.push(`/job-cards/${docId}/invoice?print=1`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Payment failed', 'error');
    } finally {
      setPayingSplit(false);
    }
  }

  function pickLedger(l: Ledger) {
    setPartyName(l.name);
    setPhone(l.phone ?? '');
    setLedgerId(l._id);
    setIsNew(false);
  }

  function selectAndFocusItem(i: number, scrollDown = false) {
    let targetUid = items[i]?.personUid ?? '';

    if (!targetUid || !sets.some((s) => s.uid === targetUid)) {
      const usedUids = new Set(items.map((r) => r.personUid).filter(Boolean));
      const freeSet = sets.find((s) => !usedUids.has(s.uid));

      if (freeSet) {
        targetUid = freeSet.uid;
      } else {
        const fresh = newSet();
        targetUid = fresh.uid;
        setSets((prev) => [...prev, fresh]);
      }

      setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, personUid: targetUid } : r)));
    }

    setActivePersonUid(targetUid);
    if (scrollDown && targetUid) {
      setReveal({ uid: targetUid, at: Date.now() });
    }
  }

  function pickProduct(i: number, p: Product) {
    setItems((rows) =>
      rows.map((r, idx) =>
        idx === i ? { ...r, code: p.code, productName: p.name, rate: String(p.rate) } : r,
      ),
    );
    setTimeout(() => {
      selectAndFocusItem(i, false);
    }, 50);
  }

  function removeItem(i: number) {
    const targetItem = items[i];
    const targetUid = targetItem?.personUid;

    const remainingItems = items.filter((_, idx) => idx !== i);
    setItems(remainingItems);

    setSets((prevSets) => {
      const usedUids = new Set(remainingItems.map((it) => it.personUid).filter(Boolean));
      const filtered = prevSets.filter(
        (s) =>
          usedUids.has(s.uid) ||
          s.name.trim() ||
          Object.values(s.values).some((v) => String(v).trim()),
      );

      if (filtered.length > 0) return filtered;
      const fresh = newSet();
      setActivePersonUid(fresh.uid);
      return [fresh];
    });

    if (targetUid) {
      const remainingSets = sets.filter((s) => s.uid !== targetUid);
      setActivePersonUid(remainingSets[0]?.uid ?? '');
    }
  }

  async function searchFind() {
    try {
      const r = await api.jobCards.list(findQ, '', 1, 10);
      setFindRows(r.items);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Search failed', 'error');
    }
  }

  const updateItem = (i: number, patch: Partial<ItemRow>) =>
    setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  /**
   * Adding somebody to the order no longer touches the order lines.
   *
   * Lines and people used to be bound by position — person 1 to row 1 — so
   * adding a person inserted a row and removing one took a row away. The
   * Attach Size column states that link outright now, which makes the implicit
   * version both redundant and wrong: not every line is a garment for
   * somebody, and nobody asked for a row they did not add.
   *
   * The one thing still worth doing automatically is letting go: a line
   * attached to somebody who has just been taken off the order goes back to
   * carrying no size, rather than naming a person who is not there.
   */
  function changeSets(next: EditableSet[]) {
    // Naming the first person is the one attachment worth guessing: a single
    // order line and a single person can only mean each other. Everybody after
    // them is picked by hand, because which garment belongs to the brother and
    // which to the father is not something a form can know. Only the keystroke
    // that first gives them a name does it, and only onto a line nobody has
    // claimed, so nothing set by hand is ever moved.
    const had = new Map(sets.map((p) => [p.uid, p.name.trim().length > 0]));
    const first = next[0];
    const openingNamed = Boolean(first && first.name.trim() && !had.get(first.uid));

    setSets(next);
    setItems((rows) => {
      // A line pointing at somebody who has been deleted points at nobody.
      const out = rows.map((r) =>
        !r.personUid || next.some((n) => n.uid === r.personUid) ? r : { ...r, personUid: '' },
      );
      if (openingNamed && out[0] && !out[0].personUid) {
        out[0] = { ...out[0], personUid: first.uid };
      }
      return out;
    });
  }

  return (
    <div>


      {readOnly && (
        <div className="mb-5 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-3 text-sm font-semibold text-brand-800">
          This stitching order has been converted to sales{invoiceNo ? ` (Bill ${invoiceNo})` : ''} and is read-only.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3">
        <Card className="rounded-none border-x-0 border-t-0 xl:col-span-2 xl:border-r">
          {/* header fields */}
          <section className="p-5">
            {/* The number the order is called, set over the form rather than
                boxed in beside the fields: it is read out and quoted, never
                typed into, so it reads as a title. */}
            <div className="mb-5 flex items-baseline justify-center gap-3">
              <p className="text-lg font-extrabold tracking-tight text-ink-900">Order NO:</p>
              <p className="text-3xl font-black leading-none tabular-nums text-ink-900">
                {no ?? '…'}
              </p>
            </div>

            {/* One 12-column grid whose spans fill exactly two rows, in the
                order the counter works: who the order is for and what it is
                referenced by, then the book it came out of and its dates. */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-12">
              <div className="col-span-2 sm:col-span-7">
                <div className="mb-1 flex h-7 items-center justify-between">
                  <label className="label mb-0">CUSTOMER NAME</label>
                  {canAddLedger && (
                    <button
                      type="button"
                      onClick={handleEditCustomer}
                      disabled={readOnly}
                      title="Update customer details (view/edit all customer details)"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 py-1 text-xs font-semibold text-ink-700 shadow-sm transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
                    >
                      <span className="text-sm">✏️</span>
                      <span>Update User</span>
                    </button>
                  )}
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
                      disabled={readOnly}
                      placeholder="Start typing a customer's name…"
                      className="font-semibold"
                    />
                  </div>
                  {canAddLedger && (
                    <button
                      type="button"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-600 shadow-sm transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
                      onClick={() => setLedgerOpen(true)}
                      disabled={readOnly}
                      title="Add a customer to the ledger and put them on this order"
                      aria-label="New customer"
                    >
                      <Icon name="plus" className="h-5 w-5" />
                    </button>
                  )}
                </div>

                <div className="mt-1 min-h-[20px]">
                  {due && priorDue !== 0 ? (
                    <p
                      className={`text-[11px] font-bold ${priorDue > 0 ? 'text-rose-600' : 'text-brand-700'
                        }`}
                      title={
                        priorDue > 0
                          ? `Opening ${fmt(due.openingBalance)} + unpaid orders ${fmt(due.orderDue)} + unpaid bills ${fmt(due.saleDue)}${mode === 'edit' ? ', less this order' : ''
                          }`
                          : 'This customer has paid ahead'
                      }
                    >
                      {priorDue > 0
                        ? `Due Balance: ${fmt(priorDue)} AED`
                        : `In credit: ${fmt(Math.abs(priorDue))} AED`}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="col-span-2 sm:col-span-5">
                <div className="mb-1 flex h-7 items-center justify-between">
                  <label className="label mb-0">Ref</label>
                </div>
                <TextInput value={ref} onChange={(e) => setRef(e.target.value)} disabled={readOnly} className="font-mono" />
              </div>

              <Field label="Book No" className="sm:col-span-2">
                <NumberInput value={bookNo} onChange={(e) => setBookNo(e.target.value)} disabled={readOnly} />
              </Field>
              {/* Opens the search over past orders — it belongs beside Book No
                  because the book number is what people search back by. */}
              <Field label="&nbsp;" className="sm:col-span-2">
                <button
                  className="btn-soft w-full"
                  onClick={() => { setFindOpen(true); setFindQ(''); setFindRows([]); }}
                  title="Find an earlier order"
                >
                  Find
                </button>
              </Field>
              <Field label="Date" className="sm:col-span-4">
                <DateInput value={date} onChange={(e) => setDate(e.target.value)} disabled={readOnly} />
              </Field>
              <Field label="Delivery Date" className="sm:col-span-4">
                <DateInput value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} disabled={readOnly} />
              </Field>
            </div>
          </section>

          {/* order items */}
          <section className="border-t border-ink-200 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-extrabold tracking-tight text-ink-900">Order Items</h2>
              {!readOnly && (
                <button
                  className="btn-soft !py-1.5 text-xs"
                  onClick={() => {
                    const freshSet = newSet();
                    setSets((prev) => [...prev, freshSet]);
                    setItems((r) => [...r, emptyItem(freshSet.uid)]);
                    setActivePersonUid(freshSet.uid);
                  }}
                >
                  ＋ Add row
                </button>
              )}
            </div>
            <div className="overflow-x-auto rounded-xl border border-ink-200">
              <table className="w-full table-fixed">
                <thead className="bg-ink-50">
                  <tr>
                    <th className="th w-10 text-center">Sl</th>
                    <th className="th">Product</th>
                    <th className="th w-20 text-right">Qty</th>
                    <th className="th w-24 text-right">Rate</th>
                    {/* Not shouted like the figures either side of it: this
                        column is a statement about the row, not a heading
                        over a number. */}
                    <th className="th w-44 text-center normal-case tracking-normal">Attach Size</th>
                    <th className="th w-24 text-right">Amount</th>
                    {!readOnly && <th className="th w-10" />}
                  </tr>
                </thead>
                <tbody ref={itemRowsRef} className="divide-y divide-ink-100">
                  {items.map((r, i) => {
                    const c = calc.rows[i];
                    const isSelected = Boolean(r.personUid && activePersonUid === r.personUid);
                    return (
                      <tr
                        key={i}
                        onClick={(e) => {
                          const el = e.target as HTMLElement;
                          // Ignore clicks inside Remove button
                          if (el.closest('button[title="Remove row"]')) {
                            return;
                          }
                          selectAndFocusItem(i, false);
                        }}
                        className={`transition-all duration-200 cursor-pointer ${isSelected
                          ? 'bg-emerald-100/90 text-emerald-950 font-semibold ring-2 ring-emerald-500/80 shadow-md border-l-4 border-emerald-600'
                          : 'hover:bg-emerald-50/60'
                          } ${freshItem === i ? 'bg-brand-50' : ''}`}
                      >
                        <td className="td w-10 text-center text-ink-400 font-mono text-xs">{i + 1}</td>
                        <td className="td">
                          <div className="flex items-center gap-2 overflow-hidden">
                            {r.code && (
                              <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-brand-700">
                                {r.code}
                              </span>
                            )}
                            <ProductSearchInput
                              value={r.productName}
                              onChange={(v) => updateItem(i, { productName: v, code: '' })}
                              onPick={(p) => pickProduct(i, p)}
                              disabled={readOnly}
                              usableAs="item"
                              allowCreate
                              placeholder="Type a code or product name…"
                              className=""
                            />
                          </div>
                        </td>
                        <td className="td w-20">
                          <NumberInput
                            value={r.qty}
                            onChange={(e) => updateItem(i, { qty: e.target.value })}
                            onFocus={() => selectAndFocusItem(i, false)}
                            disabled={readOnly}
                            className="input-sm"
                          />
                        </td>
                        <td className="td w-24">
                          <NumberInput
                            value={r.rate}
                            onChange={(e) => updateItem(i, { rate: e.target.value })}
                            onFocus={() => selectAndFocusItem(i, false)}
                            disabled={readOnly}
                            className="input-sm"
                          />
                        </td>
                        <td className="td w-44 text-center overflow-hidden">
                          <AttachSizePicker
                            people={sets}
                            value={r.personUid}
                            onChange={(uid) => {
                              updateItem(i, { personUid: uid });
                              setActivePersonUid(uid);
                            }}
                            onReveal={(uid) => {
                              let targetUid = uid;
                              if (!targetUid || !sets.some((s) => s.uid === targetUid)) {
                                const usedUids = new Set(items.map((it) => it.personUid).filter(Boolean));
                                const freeSet = sets.find((s) => !usedUids.has(s.uid));
                                if (freeSet) {
                                  targetUid = freeSet.uid;
                                } else {
                                  const fresh = newSet();
                                  targetUid = fresh.uid;
                                  setSets((prev) => [...prev, fresh]);
                                }
                                updateItem(i, { personUid: targetUid });
                              }
                              setActivePersonUid(targetUid);
                              setReveal({ uid: targetUid, at: Date.now() });
                            }}
                            disabled={readOnly}
                          />
                        </td>
                        <td className="td w-24 text-right font-bold tabular-nums">{fmt(c?.amount ?? 0)}</td>
                        {!readOnly && (
                          <td className="td w-10 text-center">
                            <button
                              className="text-rose-500 hover:text-rose-700"
                              onClick={() => removeItem(i)}
                              title="Remove row"
                            >
                              ✕
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* measurements — one block per person on this order */}
          <section className="border-t border-ink-200 p-5">
            <MeasurementSets
              sets={sets}
              onChange={changeSets}
              ledgerId={ledgerId || undefined}
              readOnly={readOnly}
              revealToken={reveal}
              activeUid={activePersonUid}
              collapseSignal={collapseSignal}
            />

            {/* What the order cost against what it sells for, read down the
                left, with the one figure that matters set beside it. Three
                short lines rather than four boxes: only one of them is typed
                into, and boxing a figure nobody can change invites a try. */}
            <div className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-4 border-t border-ink-100 pt-5">
              <dl className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <dt className="w-28 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                    Material Cost
                  </dt>
                  <dd
                    className="text-sm font-black tabular-nums text-ink-900"
                    title="Everything booked under Materials Used, for every person on this order"
                  >
                    : {fmt(calc.materialTotal)} AED
                  </dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="w-28 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                    Job Cost
                  </dt>
                  <dd className="flex items-center gap-1.5 text-sm font-black text-ink-900">
                    :
                    <NumberInput
                      value={jobCost}
                      onChange={(e) => setJobCost(e.target.value)}
                      disabled={readOnly}
                      className="input-sm !w-24"
                    />
                  </dd>
                </div>
                <div className="flex items-center gap-2">
                  <dt className="w-28 text-[11px] font-bold uppercase tracking-wider text-ink-900">
                    Item Price
                  </dt>
                  <dd
                    className="text-sm font-black tabular-nums text-ink-900"
                    title="What the order items come to, before charges, discount and VAT"
                  >
                    : {fmt(calc.total)}
                  </dd>
                </div>
              </dl>

              <p className="flex items-baseline gap-2">
                <span className="text-sm font-black text-rose-600">Margin:</span>
                <span
                  className={`text-xl font-black tabular-nums ${margin < 0 ? 'text-rose-600' : 'text-ink-900'
                    }`}
                >
                  {fmt(margin)} <span className="text-xs">AED</span>
                </span>
              </p>

              {canSave && (
                <button
                  className="ml-auto rounded-xl bg-brand-700 px-7 py-2.5 text-base font-black text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => void fileMeasurements()}
                  disabled={filing || readOnly}
                  title="Keep these measurements on file and open a new order line"
                >
                  {filing ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          </section>
        </Card>

        {/* right payment panel */}
        <div>
          <Card className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-none border-x-0 border-t-0 p-4">
            {/* The chain the counter reads out, in the order the money is
                actually worked out: what the goods come to, what is added or
                taken off, the tax on the result, then the one figure the
                customer hands over. Each row follows from the ones above it,
                so the two that are typed into sit where they take effect. */}
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink-500">Total without Tax</span>
                <span className="font-bold tabular-nums">{fmt(calc.total)} AED</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-ink-500">Additional Charges</span>
                <NumberInput
                  value={additionalCharges}
                  onChange={(e) => setAdditionalCharges(e.target.value)}
                  disabled={readOnly}
                  className="input-sm !w-28"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-ink-500">Discount</span>
                <NumberInput
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  disabled={readOnly}
                  className="input-sm !w-28"
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

            {/* The count rides on the bar rather than taking a row of its own,
                so the figures above read as one unbroken sum. */}
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
                {fmt(calc.netAmount)}
              </p>
            </div>

            {/* What they already owed, beside the way to go and look at it.
                Shown, not added: Total Payable is this order's own value, and
                folding an earlier debt into it would put the wrong figure on
                this invoice and charge tax on it a second time. */}
            <div className="mt-1.5 flex items-center justify-between gap-3 text-xs font-bold">
              {priorDue > 0 ? (
                <span className="text-rose-600">Due Balance: {fmt(priorDue)} AED</span>
              ) : (
                <span />
              )}
              <button
                className="text-rose-600 underline-offset-2 hover:underline"
                onClick={() => setHistoryOpen(true)}
              >
                Order History
              </button>
            </div>

            <div className="mb-3 mt-3 border-t border-ink-100" />

            {calc.advance > 0 && (
              <div className="mb-2.5 flex items-center justify-between gap-3 text-xs font-bold">
                <span className="text-emerald-700">Already Paid: {fmt(calc.advance)} AED</span>
              </div>
            )}

            <SplitTender
              due={Math.max(calc.balance, 0)}
              value={split}
              onChange={setSplit}
              details={tenderDetails}
              onDetailsChange={setTenderDetails}
              savedCards={savedCards}
              savedBanks={savedBanks}
              alreadyPaid={advanceBreakdown}
              onClear={handleClearMode}
              onPay={docId && canPay ? () => void paySplit() : undefined}
              disabled={readOnly}
              busy={payingSplit}
              note={
                !docId
                  ? 'Counted now, taken when you press Save — it will show as paid on the invoice.'
                  : !canPay
                    ? 'You do not have permission to take payments.'
                    : undefined
              }
            />


            {/*
              A new order can only be saved; an existing one can be updated and,
              separately, billed. Both live here so the primary action is beside
              the figures it commits.
            */}
            {canSave && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    className="btn-soft !py-2 text-[13px]"
                    onClick={() => void save(false)}
                    disabled={saving || readOnly}
                  >
                    {saving
                      ? mode === 'edit'
                        ? 'Updating…'
                        : 'Saving…'
                      : mode === 'edit'
                        ? 'Update Only'
                        : 'Save Only'}
                  </button>
                  <button
                    className="btn-primary !py-2 text-[13px]"
                    onClick={() => void save(true)}
                    disabled={saving || readOnly}
                  >
                    {saving
                      ? mode === 'edit'
                        ? 'Updating…'
                        : 'Saving…'
                      : mode === 'edit'
                        ? 'Update & Print'
                        : 'Save & Print'}
                  </button>
                </div>
                {mode === 'edit' && canConvert && !readOnly && (
                  <button
                    className="w-full rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => void saveAndConvert()}
                    disabled={saving || readOnly}
                    title="Update order and shift all data to New Sale"
                  >
                    {saving ? 'Updating…' : '⚡ Move to Sale'}
                  </button>
                )}
              </div>
            )}
            {mode === 'edit' && (
              <p className="mt-2 text-center text-[10px] text-ink-400">
                Delivery {fmtDate(deliveryDate)} · Ref {ref}
              </p>
            )}
          </Card>
        </div>
      </div>

      {/* modals */}
      {/* Nothing on a New Order is on file until Save is pressed, so leaving
          the page would throw the lot away without this. */}
      <Modal
        open={leaveGuard.asking}
        onClose={leaveGuard.stay}
        title="This order is not saved"
      >
        <p className="text-sm leading-relaxed text-ink-600">
          Everything written on this order — the customer, the items and the
          measurements — will be lost if you leave now.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="btn-soft" onClick={leaveGuard.leave}>
            Leave without saving
          </button>
          <button className="btn-primary" onClick={leaveGuard.stay} autoFocus>
            Continue order
          </button>
        </div>
      </Modal>

      <LedgerSearchModal
        open={ledgerOpen}
        onClose={() => setLedgerOpen(false)}
        onSelect={pickLedger}
        startIn="newCustomer"
        seedName={partyName}
      />

      <LedgerFormModal
        open={editCustomerOpen}
        onClose={() => setEditCustomerOpen(false)}
        type="customer"
        editing={editingLedger}
        seedName={partyName}
        onSaved={(l) => {
          pickLedger(l);
          setEditCustomerOpen(false);
        }}
      />

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Payment History"
        sub={`Stitching order ${no ?? ''} · ${partyName}`}
        wide
      >
        {payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-400">No payments recorded yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-ink-100">
                <th className="th">Date</th>
                <th className="th">Mode</th>
                <th className="th text-right">Amount</th>
                <th className="th">Details</th>
                <th className="th text-right">Discount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {payments.map((p, i) => (
                <tr key={i}>
                  <td className="td">{fmtDate(p.date)}</td>
                  <td className="td capitalize">{p.mode}</td>
                  <td className="td text-right font-bold tabular-nums">{fmt(p.amount)}</td>
                  {/* Whichever details that tender carried — a card is
                      recognised by its last four, a transfer by its bank
                      and reference. */}
                  <td className="td text-xs text-ink-500">
                    {[
                      p.cardLast4 ? `•••• ${p.cardLast4}` : '',
                      p.cardHolder,
                      p.cardExpiry,
                      p.bank,
                      p.iban ? `…${p.iban.slice(-4)}` : '',
                      p.swift,
                      p.reference,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td className="td text-right tabular-nums">{fmt(p.discount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      <Modal
        open={findOpen}
        onClose={() => setFindOpen(false)}
        title="Find Stitching"
        sub="Search by number, ref or customer"
        wide
        footer={
          <button className="btn-soft" onClick={() => setFindOpen(false)}>
            Cancel
          </button>
        }
      >
        <div className="mb-4 flex gap-2">
          <TextInput
            autoFocus
            placeholder="e.g. 13258 or Ref-13051 or TARAK"
            value={findQ}
            onChange={(e) => setFindQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void searchFind()}
          />
          <button className="btn-primary shrink-0" onClick={searchFind}>
            Search
          </button>
        </div>
        {findRows.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-ink-100">
                <th className="th">Invoice No</th>
                <th className="th">Ref</th>
                <th className="th">Customer</th>
                <th className="th text-right">Net</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {findRows.map((j) => (
                <tr
                  key={j._id}
                  className="cursor-pointer hover:bg-brand-50"
                  onClick={() => router.push(`/job-cards/${j._id}`)}
                >
                  <td className="td font-bold text-brand-700">{orderNo(j)}</td>
                  <td className="td font-mono text-xs">{j.ref}</td>
                  <td className="td">{j.partyName || '—'}</td>
                  <td className="td text-right tabular-nums">{fmt(j.netAmount)}</td>
                  <td className="td">
                    <StatusBadge status={j.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </div>
  );
}
