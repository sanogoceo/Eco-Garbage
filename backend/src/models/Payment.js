const mongoose = require('mongoose');

const refundSchema = new mongoose.Schema({
  uuid: { type: String, required: true },
  provider_ref: String,
  idempotency_key: { type: String, required: true },
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
  },
  requested_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requested_at: { type: Date, default: Date.now },
  completed_at: Date,
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  request_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PickupRequest', required: true, unique: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  method: {
    type: String,
    enum: ['mobile_money', 'card', 'bank_transfer', 'cash'],
    default: 'mobile_money',
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refund_pending', 'refunded'],
    default: 'pending',
  },
  provider: {
    type: String,
    enum: ['mtn_momo', 'orange_money', 'card_gateway', 'cash', 'sandbox'],
    default: 'sandbox',
  },
  payer_phone: String,
  idempotency_key: String,
  transaction_ref: String,
  provider_transaction_id: String,
  receipt_number: String,
  invoice_number: String,
  initiated_at: Date,
  paid_at: Date,
  refunded_amount: { type: Number, default: 0 },
  refunded_at: Date,
  refunds: { type: [refundSchema], default: [] },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

paymentSchema.index({ user_id: 1, created_at: -1 });   // user payment history
paymentSchema.index({ status: 1, paid_at: 1 });         // revenue aggregations
paymentSchema.index({ user_id: 1, status: 1, updated_at: -1 });
paymentSchema.index(
  { user_id: 1, idempotency_key: 1 },
  { unique: true, partialFilterExpression: { idempotency_key: { $type: 'string' } } }
);
paymentSchema.index(
  { provider: 1, provider_transaction_id: 1 },
  { unique: true, partialFilterExpression: { provider_transaction_id: { $type: 'string' } } }
);
paymentSchema.index(
  { receipt_number: 1 },
  { unique: true, partialFilterExpression: { receipt_number: { $type: 'string' } } }
);
paymentSchema.index(
  { invoice_number: 1 },
  { unique: true, partialFilterExpression: { invoice_number: { $type: 'string' } } }
);

module.exports = mongoose.model('Payment', paymentSchema);
