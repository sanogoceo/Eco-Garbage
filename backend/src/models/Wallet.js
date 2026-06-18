const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  collector_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  available_balance: { type: Number, default: 0, min: 0 },
  pending_balance: { type: Number, default: 0, min: 0 },
  reserved_balance: { type: Number, default: 0, min: 0 },
  total_earned: { type: Number, default: 0, min: 0 },
  total_withdrawn: { type: Number, default: 0, min: 0 },
  debt_balance: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'XAF' },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

module.exports = mongoose.model('Wallet', walletSchema);
