const mongoose = require('mongoose');

const adminActionGrantSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  session_uuid: { type: String, required: true },
  scope: {
    type: String,
    enum: [
      'collector_review',
      'user_status',
      'payment_refund',
      'service_configuration',
      'business_contract_review',
    ],
    required: true,
  },
  expires_at: { type: Date, required: true },
  consumed_at: Date,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false },
});

adminActionGrantSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
adminActionGrantSchema.index({
  user_id: 1,
  session_uuid: 1,
  scope: 1,
  consumed_at: 1,
});

module.exports = mongoose.model('AdminActionGrant', adminActionGrantSchema);
