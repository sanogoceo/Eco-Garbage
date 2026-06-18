const mongoose = require('mongoose');

const paymentWebhookEventSchema = new mongoose.Schema({
  event_id: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  payment_uuid: { type: String, required: true },
  provider: { type: String, required: true },
  payload_hash: { type: String, required: true },
  status: {
    type: String,
    enum: ['processing', 'processed', 'ignored', 'failed'],
    default: 'processing',
  },
  error: String,
  processed_at: Date,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

paymentWebhookEventSchema.index({ created_at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('PaymentWebhookEvent', paymentWebhookEventSchema);
