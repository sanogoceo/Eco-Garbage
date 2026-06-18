const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  wallet_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },
  collector_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  request_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PickupRequest' },
  withdrawal_id: { type: mongoose.Schema.Types.ObjectId, ref: 'WithdrawalRequest' },
  type: {
    type: String,
    enum: ['earning_pending', 'earning_released', 'withdrawal', 'adjustment', 'refund'],
    required: true,
  },
  amount: { type: Number, required: true },
  balance_after: { type: Number, required: true },
  description: String,
  metadata: mongoose.Schema.Types.Mixed,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

walletTransactionSchema.index({ collector_id: 1, created_at: -1 });
walletTransactionSchema.index(
  { request_id: 1, type: 1 },
  { unique: true, partialFilterExpression: { request_id: { $exists: true } } }
);

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
