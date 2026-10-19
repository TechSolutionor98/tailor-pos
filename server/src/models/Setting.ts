import { Schema, model, models, Document } from 'mongoose';

export interface ISetting extends Document {
  key: string;
  taxRate: number;
  bookNo: number;
  salesman: string;
  deliveryDays: number;
  company: {
    name: string;
    address: string;
    phone: string;
    email: string;
    website: string;
    trn: string;
    logo: string;
    brandLogo: string;
    brandTagline: string;
  };
  bank: {
    name: string;
    accountType: string;
    accountName: string;
    accountNo: string;
    iban: string;
    swift: string;
    chequeFavour: string;
    note: string;
  };
  invoiceTitle?: string;
}

const settingSchema = new Schema<ISetting>(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    taxRate: { type: Number, default: 5 },
    bookNo: { type: Number, default: 1 },
    salesman: { type: String, default: 'GENERAL' },
    deliveryDays: { type: Number, default: 7 },
    company: {
      name: { type: String, default: '' },
      address: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      website: { type: String, default: '' },
      trn: { type: String, default: '' },
      logo: { type: String, default: '' },
      brandLogo: { type: String, default: '' },
      brandTagline: { type: String, default: '' },
    },
    bank: {
      name: { type: String, default: '' },
      accountType: { type: String, default: '' },
      accountName: { type: String, default: '' },
      accountNo: { type: String, default: '' },
      iban: { type: String, default: '' },
      swift: { type: String, default: '' },
      chequeFavour: { type: String, default: '' },
      note: { type: String, default: '' },
    },
    invoiceTitle: { type: String, default: 'Order Invoice' },
  },
  { timestamps: true },
);

export const Setting = models.Setting || model<ISetting>('Setting', settingSchema);
