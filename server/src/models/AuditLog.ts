import { Schema, model, models, Document, Types } from 'mongoose';

export interface IAuditChange {
  /** Human label for the field, e.g. "Customer" or "Item 2 · Rate". */
  field: string;
  from: string;
  to: string;
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'payment'
  | 'close'
  | 'reopen'
  | 'convert'
  | 'delete';

export interface IAuditLog extends Document {
  entity: 'jobcard';
  entityId: Types.ObjectId;
  /** Denormalised so the log still reads properly if the order is gone. */
  entityNo?: number;
  entityRef?: string;
  partyName?: string;
  action: AuditAction;
  /** One line of plain English for actions that are not a field edit. */
  summary?: string;
  changes: IAuditChange[];
  userId?: Types.ObjectId;
  username: string;
  userName: string;
  at: Date;
}

const changeSchema = new Schema<IAuditChange>(
  {
    field: { type: String, required: true },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
  },
  { _id: false },
);

const auditLogSchema = new Schema<IAuditLog>(
  {
    entity: { type: String, default: 'jobcard', index: true },
    entityId: { type: Schema.Types.ObjectId, index: true },
    entityNo: Number,
    entityRef: String,
    partyName: String,
    action: {
      type: String,
      enum: ['create', 'update', 'payment', 'close', 'reopen', 'convert', 'delete'],
      required: true,
    },
    summary: String,
    changes: { type: [changeSchema], default: [] },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    username: { type: String, default: 'unknown' },
    userName: { type: String, default: 'Unknown user' },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

// The log is read newest-first, usually filtered to one order.
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ entityId: 1, at: -1 });

export const AuditLog =
  models.AuditLog || model<IAuditLog>('AuditLog', auditLogSchema);
