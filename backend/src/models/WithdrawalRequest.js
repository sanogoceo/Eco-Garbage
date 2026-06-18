const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  collector_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  wallet_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },
  amount: { type: Number, required: true, min: 500 },
  method: { type: String, enum: ['mtn_momo', 'orange_money'], required: true },
  phone: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'paid', 'rejected'],
    default: 'pending',
  },
  review_notes: String,
  reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewed_at: Date,
  paid_at: Date,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

withdrawalRequestSchema.index({ collector_id: 1, created_at: -1 });
withdrawalRequestSchema.index({ status: 1, created_at: 1 });

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
