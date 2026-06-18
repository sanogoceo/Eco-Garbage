const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema({
  stored_name: { type: String, required: true },
  original_name: { type: String, required: true },
  mime_type: { type: String, required: true },
  size: { type: Number, required: true },
  sha256: { type: String, required: true },
  encryption_version: { type: Number, default: 1 },
  encrypted_at: Date,
  uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploaded_at: { type: Date, default: Date.now },
}, { _id: true });

const complaintSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  request_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PickupRequest' },
  type: {
    type: String,
    enum: ['missed_pickup', 'incorrect_pricing', 'collector_misconduct', 'service_quality', 'other'],
    default: 'other',
  },
  description: { type: String, required: true },
  status: {
    type: String,
    enum: ['open', 'in_review', 'awaiting_user', 'awaiting_collector', 'resolved', 'closed'],
    default: 'open',
  },
  admin_response: String,
  evidence: { type: [evidenceSchema], default: [] },
  decision: {
    outcome: {
      type: String,
      enum: ['upheld', 'rejected', 'partial', 'refund', 'warning', 'no_action'],
    },
    summary: String,
    compensation_amount: { type: Number, min: 0, default: 0 },
    decided_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decided_at: Date,
  },
  last_message_at: Date,
  resolved_at: Date,
  closed_at: Date,
  evidence_delete_at: Date,
  evidence_deleted_at: Date,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

complaintSchema.index({ user_id: 1, created_at: -1 });   // user's complaints
complaintSchema.index({ status: 1, created_at: -1 });    // admin filter by status
complaintSchema.index({ status: 1, last_message_at: -1, created_at: -1 });
complaintSchema.index({ request_id: 1, created_at: -1 });
complaintSchema.index({ evidence_delete_at: 1, evidence_deleted_at: 1 });

module.exports = mongoose.model('Complaint', complaintSchema);
