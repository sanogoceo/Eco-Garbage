const mongoose = require('mongoose');

const fraudSignalSchema = new mongoose.Schema({
  code: { type: String, required: true },
  weight: { type: Number, required: true, min: 0, max: 100 },
  details: { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const fraudAlertSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  fingerprint: { type: String, required: true, unique: true, select: false },
  category: {
    type: String,
    enum: [
      'fake_collector',
      'otp_abuse',
      'suspicious_payment',
      'suspicious_refund',
      'multiple_accounts',
    ],
    required: true,
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    required: true,
  },
  risk_score: { type: Number, required: true, min: 0, max: 100 },
  status: {
    type: String,
    enum: ['open', 'investigating', 'resolved', 'dismissed'],
    default: 'open',
  },
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  signals: { type: [fraudSignalSchema], default: [] },
  subject_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  related_user_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  collector_application_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CollectorApplication',
  },
  pickup_request_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PickupRequest' },
  payment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  occurrences: { type: Number, default: 0 },
  first_detected_at: { type: Date, default: Date.now },
  last_detected_at: { type: Date, default: Date.now },
  assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolution_notes: String,
  resolved_at: Date,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

fraudAlertSchema.index({ status: 1, severity: 1, last_detected_at: -1 });
fraudAlertSchema.index({ category: 1, status: 1, last_detected_at: -1 });
fraudAlertSchema.index({ subject_user_id: 1, status: 1, created_at: -1 });
fraudAlertSchema.index({ collector_application_id: 1, status: 1 });
fraudAlertSchema.index({ payment_id: 1, status: 1 });

module.exports = mongoose.model('FraudAlert', fraudAlertSchema);
