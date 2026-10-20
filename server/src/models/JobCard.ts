import { Schema, model, models, Document, Types } from 'mongoose';

export interface IJobCardItem {
  code?: string;
  productName?: string;
  qty: number;
  rate: number;
  amount: number;
  /**
   * The person on this order whose measurements this line is stitched to,
   * by their set's `uid`. Blank means the line carries no size — an
   * alteration charge, a loose sale, or simply not attached yet.
   */
  personUid?: string;
  /** Whether this single order item has been completed / stitched */
  completed?: boolean;
  /** Whether this single order item has already been invoiced / sold */
  invoiced?: boolean;
  /** Invoice bill number where this item was billed, e.g. B-12345 */
  invoiceNo?: string;
}

export interface IJobCardMaterial {
  code?: string;
  productName?: string;
  qty: number;
  rate: number;
}

export interface IJobCardPayment {
  date: Date;
  mode: 'cash' | 'bank' | 'card' | 'credit';
  amount: number;
  /** The bank a transfer came from. */
  bank?: string;
  /** Transfer reference, or the card terminal's approval number. */
  reference?: string;
  discount: number;
  note?: string;
  /**
   * Card tenders only. The last four digits are kept so a payment can be
   * matched to a statement line; the full number and the CVC never are.
   */
  cardHolder?: string;
  cardLast4?: string;
  cardExpiry?: string;
  /** Bank tenders only. */
  accountName?: string;
  iban?: string;
  swift?: string;
}

export type JobCardStatus = 'draft' | 'open' | 'partially_ready' | 'ready' | 'closed' | 'converted' | 'delivered' | 'deleted';

export interface IJobCard extends Document {
  /** Assigned only when the order becomes real; a draft has none. */
  no?: number;
  bookNo: number;
  /** Drafts are numbered from their own series so they consume no order numbers. */
  draftNo?: number;
  ref: string;
  date: Date;
  deliveryDate?: Date;
  partyName?: string;
  phone?: string;
  ledgerId?: Types.ObjectId;
  isNewCustomer: boolean;
  accountsAc?: string;
  invoiceNo?: string;
  items: IJobCardItem[];
  total: number;
  /** Express work, delivery and the like — taxed with the order. */
  additionalCharges: number;
  additionalChargesType?: 'percent' | 'fixed';
  additionalChargesInput?: number;
  discount: number;
  discountType?: 'percent' | 'fixed';
  discountInput?: number;
  tax: number;
  netAmount: number;
  /** Legacy single set — kept so old cards and prints still work. */
  measurements: Record<string, string>;
  fabric?: string;
  size?: string;
  /** One entry per person being stitched for on this order. */
  measurementSets: {
    /** Stable across saves, so an order line can point at this person. */
    uid?: string;
    profileId?: string;
    name: string;
    stitchingStyle?: string;
    /** Blank unless asked for — there is no sensible default age. */
    age?: number | null;
    fabric?: string;
    size?: string;
    qty: number;
    values: Record<string, string>;
    /** Materials consumed for this person. */
    materials: IJobCardMaterial[];
  }[];
  materialsUsed: IJobCardMaterial[];
  materialTotal: number;
  jobCost: number;
  advance: number;
  advanceBeforeTax: number;
  advanceTax: number;
  balance: number;
  paymentMode: 'cash' | 'bank' | 'card';
  bank?: string;
  creditCardNo?: string;
  payments: IJobCardPayment[];
  status: JobCardStatus;
  closedAt?: Date;
  isDeleted?: boolean;
  deletedAt?: Date;
  deletedBy?: string;
}

const itemSchema = new Schema<IJobCardItem>(
  {
    code: String,
    productName: String,
    qty: { type: Number, default: 0 },
    rate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    personUid: String,
    completed: { type: Boolean, default: false },
    invoiced: { type: Boolean, default: false },
    invoiceNo: String,
  },
  { _id: false },
);

const materialSchema = new Schema<IJobCardMaterial>(
  {
    code: String,
    productName: String,
    qty: { type: Number, default: 0 },
    rate: { type: Number, default: 0 },
  },
  { _id: false },
);

const paymentSchema = new Schema<IJobCardPayment>(
  {
    date: { type: Date, default: Date.now },
    mode: {
      type: String,
      enum: ['cash', 'bank', 'card', 'credit'],
      default: 'cash',
    },
    amount: { type: Number, default: 0 },
    bank: String,
    reference: String,
    discount: { type: Number, default: 0 },
    note: String,
    cardHolder: String,
    cardLast4: String,
    cardExpiry: String,
    accountName: String,
    iban: String,
    swift: String,
  },
  { _id: false },
);

const jobCardSchema = new Schema<IJobCard>(
  {
    // Not unique at field level: a draft carries no number, and Mongo would
    // treat every missing value as the same one. The partial index below makes
    // the number unique among real orders only.
    no: { type: Number },
    draftNo: { type: Number, index: true },
    bookNo: { type: Number, default: 270 },
    ref: { type: String, unique: true, index: true, trim: true },
    date: { type: Date, default: Date.now },
    deliveryDate: Date,
    partyName: { type: String, trim: true },
    phone: { type: String, trim: true },
    ledgerId: { type: Schema.Types.ObjectId, ref: 'Ledger' },
    isNewCustomer: { type: Boolean, default: false },
    accountsAc: { type: String, trim: true },
    invoiceNo: { type: String, trim: true },
    items: { type: [itemSchema], default: [] },
    total: { type: Number, default: 0 },
    additionalCharges: { type: Number, default: 0 },
    additionalChargesType: { type: String, enum: ['percent', 'fixed'], default: 'fixed' },
    additionalChargesInput: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    discountType: { type: String, enum: ['percent', 'fixed'], default: 'fixed' },
    discountInput: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    measurements: { type: Schema.Types.Mixed, default: {} },
    fabric: String,
    size: String,
    measurementSets: {
      type: [
        new Schema(
          {
            uid: { type: String },
            profileId: { type: String },
            name: { type: String, required: true, trim: true },
            stitchingStyle: { type: String, trim: true },
            age: { type: Number, default: null, min: 0 },
            fabric: { type: String, trim: true },
            size: { type: String, trim: true },
            qty: { type: Number, default: 1, min: 0 },
            values: { type: Schema.Types.Mixed, default: {} },
            materials: { type: [materialSchema], default: [] },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    materialsUsed: { type: [materialSchema], default: [] },
    materialTotal: { type: Number, default: 0 },
    jobCost: { type: Number, default: 0 },
    advance: { type: Number, default: 0 },
    advanceBeforeTax: { type: Number, default: 0 },
    advanceTax: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    paymentMode: {
      type: String,
      enum: ['cash', 'bank', 'card'],
      default: 'cash',
    },
    bank: String,
    creditCardNo: String,
    payments: { type: [paymentSchema], default: [] },
    status: {
      type: String,
      enum: ['draft', 'open', 'partially_ready', 'ready', 'closed', 'converted', 'delivered', 'deleted'],
      default: 'open',
    },
    closedAt: Date,
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    deletedBy: String,
  },
  { timestamps: true },
);

/**
 * Order numbers must stay unique and gapless, so only real orders hold one.
 * A partial index enforces uniqueness across those, while leaving any number
 * of drafts — which have no `no` at all — perfectly legal.
 */
jobCardSchema.index(
  { no: 1 },
  { unique: true, partialFilterExpression: { no: { $type: 'number' } } },
);

jobCardSchema.index(
  { bookNo: 1 },
  { unique: true, partialFilterExpression: { bookNo: { $type: 'number' } } },
);

export const JobCard =
  models.JobCard || model<IJobCard>('JobCard', jobCardSchema);
