import { Schema, model, models, Document, Types } from 'mongoose';

export interface ISaleItem {
  code?: string;
  productName?: string;
  /** How this line is sold — PIECE, GRAMS, METER. Copied off the product. */
  unit?: string;
  qty: number;
  rate: number;
  netRate: number;
  /** What was typed in the discount box, and whether it was a sum or a rate. */
  discType?: 'fixed' | 'percent';
  discInput?: number;
  discPercent: number;
  discAmt: number;
  grossAmt: number;
  taxPercent: number;
  taxAmt: number;
  netAmount: number;
  /** Months of warranty given on this line, 0 for none. */
  warranty?: number;
  /** Anything the counter wants printed against the line. */
  info?: string;
  completed?: boolean;
  status?: string;
}

export interface ISale extends Document {
  billNo: number;
  billDate: Date;
  saleType: 'retail' | 'wholesale' | 'distributor';
  paymentType: 'cash' | 'credit';
  category: 'A' | 'B';
  creditCardNo?: string;
  jobCardRef?: string;
  jobCardId?: Types.ObjectId;
  jobCardIds?: Types.ObjectId[];
  orderStatus?: string;
  /** The stitching order this bill came out of, and the bill's own reference.
      Both are set by the system and are not the counter's to change. */
  bookingNo?: string;
  refNo?: string;
  salesman: string;
  partyName?: string;
  phone?: string;
  ledgerId?: Types.ObjectId;
  delDate?: Date;
  landmark?: string;
  trn?: string;
  vehicleNo?: string;
  items: ISaleItem[];
  totQty: number;
  grossAmount: number;
  discountAmt: number;
  additionalDiscount: number;
  additionalCharges?: number;
  additionalChargesType?: 'percent' | 'fixed';
  additionalChargesInput?: number;
  /** The bill-wide discount as it was entered — a rate or a flat sum. */
  discountType?: 'percent' | 'fixed';
  discountInput?: number;
  taxAmt: number;
  freight: number;
  advanceAmount: number;
  netAmount: number;
  balance: number;
  isReturn: boolean;
  /** How the money was taken, where it was put, and anything said about it. */
  paymentMethod?: string;
  paymentAccount?: string;
  paymentNote?: string;
  paidOn?: Date;
  /** Enough to find the card on a statement. The number and the security code
      are never sent here and never stored. */
  cardHolder?: string;
  cardLast4?: string;
  cardExpiry?: string;
  /** Where a transfer came from. */
  bankName?: string;
  accountName?: string;
  iban?: string;
  swift?: string;
  /** Handed back when the customer pays more than the bill. */
  changeReturn?: number;
  cashPaid?: number;
  cardPaid?: number;
  bankPaid?: number;
  materialsUsed?: {
    code?: string;
    productName?: string;
    qty?: number;
    rate?: number;
  }[];
  materialTotal?: number;
  isDeleted?: boolean;
  deletedAt?: Date;
  deletedBy?: string;
  status?: string;
}

const materialSchema = new Schema(
  {
    code: String,
    productName: String,
    qty: { type: Number, default: 0 },
    rate: { type: Number, default: 0 },
  },
  { _id: false },
);

const saleItemSchema = new Schema<ISaleItem>(
  {
    code: String,
    productName: String,
    unit: String,
    qty: { type: Number, default: 0 },
    rate: { type: Number, default: 0 },
    netRate: { type: Number, default: 0 },
    discType: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
    discInput: { type: Number, default: 0 },
    discPercent: { type: Number, default: 0 },
    discAmt: { type: Number, default: 0 },
    grossAmt: { type: Number, default: 0 },
    taxPercent: { type: Number, default: 5 },
    taxAmt: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    warranty: { type: Number, default: 0 },
    info: { type: String, trim: true },
    completed: { type: Boolean, default: false },
    status: { type: String, default: 'ready' },
  },
  { _id: false },
);

const saleSchema = new Schema<ISale>(
  {
    billNo: { type: Number, unique: true, index: true },
    billDate: { type: Date, default: Date.now },
    saleType: {
      type: String,
      enum: ['retail', 'wholesale', 'distributor'],
      default: 'retail',
    },
    paymentType: { type: String, enum: ['cash', 'credit'], default: 'cash' },
    category: { type: String, enum: ['A', 'B'], default: 'A' },
    creditCardNo: String,
    jobCardRef: { type: String, trim: true },
    jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard' },
    jobCardIds: [{ type: Schema.Types.ObjectId, ref: 'JobCard' }],
    orderStatus: { type: String, trim: true },
    bookingNo: { type: String, trim: true },
    refNo: { type: String, trim: true },
    salesman: { type: String, default: 'GENERAL' },
    partyName: { type: String, trim: true },
    phone: { type: String, trim: true },
    ledgerId: { type: Schema.Types.ObjectId, ref: 'Ledger' },
    delDate: Date,
    landmark: String,
    trn: String,
    vehicleNo: String,
    items: { type: [saleItemSchema], default: [] },
    materialsUsed: { type: [materialSchema], default: [] },
    materialTotal: { type: Number, default: 0 },
    totQty: { type: Number, default: 0 },
    grossAmount: { type: Number, default: 0 },
    discountAmt: { type: Number, default: 0 },
    additionalDiscount: { type: Number, default: 0 },
    additionalCharges: { type: Number, default: 0 },
    additionalChargesType: { type: String, enum: ['percent', 'fixed'], default: 'fixed' },
    additionalChargesInput: { type: Number, default: 0 },
    discountType: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
    discountInput: { type: Number, default: 0 },
    taxAmt: { type: Number, default: 0 },
    freight: { type: Number, default: 0 },
    advanceAmount: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    isReturn: { type: Boolean, default: false },
    paymentMethod: { type: String, trim: true, default: 'cash' },
    paymentAccount: { type: String, trim: true },
    paymentNote: { type: String, trim: true },
    paidOn: { type: Date },
    cardHolder: { type: String, trim: true },
    cardLast4: { type: String, trim: true },
    cardExpiry: { type: String, trim: true },
    bankName: { type: String, trim: true },
    accountName: { type: String, trim: true },
    iban: { type: String, trim: true },
    swift: { type: String, trim: true },
    changeReturn: { type: Number, default: 0 },
    cashPaid: { type: Number, default: 0 },
    cardPaid: { type: Number, default: 0 },
    bankPaid: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: String, trim: true },
    status: { type: String, trim: true, default: 'closed' },
  },
  { timestamps: true },
);

export const Sale = models.Sale || model<ISale>('Sale', saleSchema);
