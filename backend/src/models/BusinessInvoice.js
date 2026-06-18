const mongoose = require('mongoose');

const businessInvoiceSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  invoice_number: { type: String, required: true, unique: true },
  contract_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessContract', required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  amount: { type: Number, required: true, min: 0 },
  request_count: { type: Number, default: 0 },
  request_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PickupRequest' }],
  due_at: { type: Date, required: true },
  status: {
    type: String,
    enum: ['draft', 'issued', 'paid', 'overdue', 'cancelled'],
    default: 'issued',
  },
  payment_method: {
    type: String,
    enum: ['bank_transfer', 'mobile_money', 'cash', 'cheque', 'other'],
  },
  payment_reference: { type: String, trim: true, maxlength: 120 },
  payment_notes: { type: String, trim: true, maxlength: 500 },
  paid_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  issued_at: { type: Date, default: Date.now },
  paid_at: Date,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

businessInvoiceSchema.index({ contract_id: 1, month: 1 }, { unique: true });
businessInvoiceSchema.index({ user_id: 1, status: 1, due_at: 1 });
businessInvoiceSchema.index({ status: 1, due_at: 1 });

module.exports = mongoose.model('BusinessInvoice', businessInvoiceSchema);
