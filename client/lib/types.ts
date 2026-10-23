export interface Ledger {
  _id: string;
  name: string;
  /** The mobile number. Named `phone` because older records are. */
  phone?: string;
  altPhone?: string;
  landline?: string;
  contactId?: string;
  customerGroup?: string;
  businessName?: string;
  /** The person dealt with at a company — a supplier's salesman. */
  contactPerson?: string;
  invoiceOnCompanyName?: boolean;
  email?: string;
  /** Null when cleared — an emptied date has to be written, not skipped. */
  dob?: string | null;
  assignedTo?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  /** Free-text address from before the fields above existed. */
  address?: string;
  trn?: string;
  openingBalance: number;
  payTerm?: number | null;
  payTermUnit?: 'days' | 'months';
  /** Null or absent means no limit, which is not a limit of zero. */
  creditLimit?: number | null;
  type: 'customer' | 'supplier' | 'general';
  savedCards?: SavedCard[];
  savedBanks?: SavedBank[];
  /** Set by the database when the record was first written. */
  createdAt?: string;
  /** What they owe right now. Supplied by the list and by /ledgers/:id/due. */
  due?: number;
  /** Most recent order number, if available */
  latestOrderNo?: number;
  /** Most recent book number, if available */
  latestBookNo?: number;
}

/** An address as it should read on a document, from the parts that are set. */
export const formatAddress = (l?: Partial<Ledger> | null): string => {
  if (!l) return '';
  const parts = [l.addressLine1, l.addressLine2, l.city, l.state, l.zip, l.country]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  // Nothing structured set yet: fall back to whatever the old single box held.
  return parts.length ? parts.join(', ') : (l.address ?? '').trim();
};

/**
 * A card kept on file against a customer, so a regular does not have to read
 * their details out again.
 *
 * Only the parts that are safe to keep are here. The full card number is never
 * stored — just the last four, which is all anyone needs to recognise the card
 * — and the CVC is never stored at all. Keeping either is forbidden once a
 * payment has been taken, and neither is any use to us afterwards.
 */
export interface SavedCard {
  _id?: string;
  holder?: string;
  last4?: string;
  /** MM/YY, as printed on the card. */
  expiry?: string;
}

/** A bank account kept on file against a customer, for transfers. */
export interface SavedBank {
  _id?: string;
  bankName?: string;
  accountName?: string;
  iban?: string;
  /** The bank's SWIFT/BIC code. */
  swift?: string;
}

/** Where a product may be used: a charged line, a consumed material, or both. */
export type ProductUsage = 'item' | 'material' | 'both';

/**
 * What a picker is picking for. `both` is never asked for directly — a product
 * marked `both` answers to either side, so the question is only ever "item?"
 * or "material?".
 */
export type ProductUsagePicker = Exclude<ProductUsage, 'both'>;

export const USAGE_LABEL: Record<ProductUsage, string> = {
  item: 'Item',
  material: 'Material',
  both: 'Item / Material',
};

export interface Product {
  _id: string;
  code: string;
  name: string;
  usage?: ProductUsage;
  rate: number;
  wholesaleRate: number;
  /** Free text: the shop defines its own categories. */
  category: string;
  unit: string;
  stockQty: number;
}

export interface JobCardItem {
  code?: string;
  productName?: string;
  qty: number;
  rate: number;
  amount: number;
  /** The person this line is stitched to, by their measurement set's uid. */
  personUid?: string;
  /** Whether this single order item has been completed / stitched */
  completed?: boolean;
  /** Whether this single order item has already been invoiced / sold */
  invoiced?: boolean;
  /** Invoice bill number where this item was billed, e.g. B-12345 */
  invoiceNo?: string;
}

export interface JobCardMaterial {
  code?: string;
  productName?: string;
  qty: number;
  rate: number;
}

export type PaymentMode = 'cash' | 'bank' | 'card' | 'credit';

export interface JobCardPayment {
  date: string;
  mode: PaymentMode;
  amount: number;
  /** The bank a transfer came from. */
  bank?: string;
  /** Transfer reference, or the card terminal's approval number. */
  reference?: string;
  discount: number;
  note?: string;
  /** Card tenders only — see SavedCard on what is and is not kept. */
  cardHolder?: string;
  cardLast4?: string;
  cardExpiry?: string;
  /** Bank tenders only. */
  accountName?: string;
  iban?: string;
  swift?: string;
}

/** A length of cloth or trim consumed by one person's garment. */
export interface MaterialLine {
  code?: string;
  productName?: string;
  qty: number;
  rate: number;
}

export const STITCHING_STYLES = [
  'Emirati Style',
  'Saudi Style',
  'Qatari Style',
  'Kuwaiti Style',
  'Omani Style',
  'Mariki Style',
  'Classic Style',
  'Modern Cut',
  'Custom Style',
] as const;

/** One person being stitched for on an order. */
export interface MeasurementSet {
  /** Stable across saves, so an order line can point at this person. */
  uid?: string;
  profileId?: string;
  name: string;
  stitchingStyle?: string;
  /** Null unless asked for — there is no sensible default age. */
  age?: number | null;
  fabric?: string;
  size?: string;
  qty: number;
  values: Record<string, string>;
  /** Materials consumed for this person, costed on their own block. */
  materials?: MaterialLine[];
}

/** A person kept on file under a customer, reusable on later orders. */
export interface MeasurementProfile {
  _id: string;
  ledgerId: string;
  name: string;
  stitchingStyle?: string;
  fabric?: string;
  size?: string;
  values: Record<string, string>;
  note?: string;
  archived: boolean;
  lastUsedAt?: string;
  /**
   * The customer this person is filed under. Present on any list that spans
   * customers — a bare name does not identify anyone, since two customers can
   * each have an "Ali".
   */
  ledgerName?: string;
  ledgerPhone?: string;
  ledgerType?: string;
}

export type JobCardStatus = 'open' | 'partially_ready' | 'ready' | 'closed' | 'converted' | 'delivered' | 'deleted';

export interface JobCard {
  _id: string;
  no?: number;
  bookNo: number;
  ref: string;
  date: string;
  deliveryDate?: string;
  partyName?: string;
  phone?: string;
  ledgerId?: string;
  isNewCustomer: boolean;
  accountsAc?: string;
  invoiceNo?: string;
  items: JobCardItem[];
  total: number;
  additionalCharges: number;
  additionalChargesType?: 'percent' | 'fixed';
  additionalChargesInput?: number;
  discount: number;
  discountType?: 'percent' | 'fixed';
  discountInput?: number;
  tax: number;
  netAmount: number;
  measurements: Record<string, string>;
  measurementSets: MeasurementSet[];
  fabric?: string;
  size?: string;
  materialsUsed: JobCardMaterial[];
  materialTotal: number;
  jobCost: number;
  advance: number;
  advanceBeforeTax: number;
  advanceTax: number;
  balance: number;
  paymentMode: 'cash' | 'bank' | 'card';
  bank?: string;
  creditCardNo?: string;
  payments: JobCardPayment[];
  status: JobCardStatus;
  closedAt?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  remainingAdvance?: number;
}

export interface SaleItem {
  code?: string;
  productName?: string;
  unit?: string;
  qty: number;
  rate: number;
  netRate: number;
  discType?: 'fixed' | 'percent';
  discInput?: number;
  discPercent: number;
  discAmt: number;
  grossAmt: number;
  taxPercent: number;
  taxAmt: number;
  netAmount: number;
  warranty?: number;
  info?: string;
  status?: 'ready' | 'pending';
  completed?: boolean;
}

export interface Sale {
  _id: string;
  billNo: number;
  billDate: string;
  saleType: 'retail' | 'wholesale' | 'distributor';
  paymentType: 'cash' | 'credit';
  category: 'A' | 'B';
  creditCardNo?: string;
  jobCardRef?: string;
  jobCardId?: string;
  jobCardIds?: string[];
  orderStatus?: JobCardStatus | string;
  bookingNo?: string;
  refNo?: string;
  salesman: string;
  partyName?: string;
  phone?: string;
  ledgerId?: string;
  delDate?: string;
  landmark?: string;
  trn?: string;
  vehicleNo?: string;
  items: SaleItem[];
  materialsUsed?: JobCardMaterial[];
  materialTotal?: number;
  totQty: number;
  grossAmount: number;
  discountAmt: number;
  additionalDiscount: number;
  additionalCharges?: number;
  additionalChargesType?: 'percent' | 'fixed';
  additionalChargesInput?: number;
  discountType?: 'percent' | 'fixed';
  discountInput?: number;
  taxAmt: number;
  freight: number;
  advanceAmount: number;
  netAmount: number;
  balance: number;
  isReturn: boolean;
  paymentMethod?: string;
  paymentAccount?: string;
  paymentNote?: string;
  paidOn?: string;
  changeReturn?: number;
  /** Card: never the full number or the security code. */
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
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  status?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface DashboardRange {
  from: string;
  to: string;
}

export interface DashboardSummary {
  range: DashboardRange;
  sales: {
    gross: number;
    returns: number;
    net: number;
    billCount: number;
    returnCount: number;
  };
  orders: {
    newOrders: number;
    pending: number;
    delivered: number;
  };
  payments: {
    cash: number;
    bank: number;
    card: number;
    credit: number;
    total: number;
  };
  totalCustomers: number;
  recentJobCards: JobCard[];
  recentSales: Sale[];
  lowStock: Product[];
}

export interface FlatPayment {
  jobCardNo: number;
  jobCardRef: string;
  jobCardId: string;
  partyName?: string;
  date: string;
  mode: PaymentMode;
  amount: number;
  bank?: string;
  reference?: string;
  discount: number;
}

/**
 * What a party still owes across everything: their opening balance, their
 * unpaid stitching orders and their unpaid bills. Negative means they are in
 * credit — they have paid ahead.
 */
export interface LedgerDue {
  ledgerId: string;
  openingBalance: number;
  orderDue: number;
  saleDue: number;
  openOrders: number;
  due: number;
}

/** Printed at the head of every invoice. Blank lines simply do not print. */
export interface CompanyDetails {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  trn: string;
  /**
   * The mark at the head of the invoice. A data URI from a file chosen in
   * Settings, or a URL — anything an <img> will take.
   */
  logo: string;
  /** A second mark at the far side of the masthead, for a sub-brand. */
  brandLogo: string;
  /** The line under that second mark, e.g. "A Brand By …". */
  brandTagline: string;
}

/** Printed at the foot of every invoice, so a customer can transfer. */
export interface BankDetails {
  name: string;
  accountType: string;
  accountName: string;
  accountNo: string;
  iban: string;
  swift: string;
  chequeFavour: string;
  note: string;
}

export interface AppSettings {
  taxRate: number;
  bookNo: number;
  salesman: string;
  deliveryDays: number;
  company: CompanyDetails;
  bank: BankDetails;
  /** Optional legacy title override; defaults to static invoice title */
  invoiceTitle?: string;
}

export const MEASURE_FIELDS = [
  'LEN',
  'HAND',
  'SHOUL',
  'CHEST',
  'COLLAR',
  'B.LOOSE',
  'WRIST',
  'K.CHEST',
  'BOTTOM',
  'WEST',
  'A',
  'H.LOOS',
  'H.KASHF',
  'T.R.',
  'K.',
  'Q.',
];

/* ------------------------------------------------------------------ auth */

export type Role = 'super_admin' | 'admin' | 'salesman';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  salesman: 'Salesman',
};

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  roleLabel: string;
  active: boolean;
  permissions: string[];
  lastLoginAt?: string | null;
  createdAt?: string | null;
}

export interface PermissionGroup {
  group: string;
  items: { key: string; label: string }[];
}

export interface PermissionCatalog {
  permissions: string[];
  groups: PermissionGroup[];
  roleLabels: Record<Role, string>;
}

/** Per-order outcome of a bulk convert — some rows can be skipped. */
export interface BulkConvertResult {
  converted: { id: string; no: number; billNo: number }[];
  skipped: { id: string; no?: number; reason: string }[];
}

export type AuditAction = 'create' | 'update' | 'payment' | 'close' | 'reopen' | 'convert';

export interface AuditChange {
  field: string;
  from: string;
  to: string;
}

/** One entry in the Super Admin change log. */
export interface AuditEntry {
  _id: string;
  entity: 'jobcard';
  entityId: string;
  entityNo?: number;
  entityRef?: string;
  partyName?: string;
  action: AuditAction;
  summary?: string;
  changes: AuditChange[];
  username: string;
  userName: string;
  at: string;
}
