const mongoose = require('mongoose');
const { SERVICE_TYPES } = require('../utils/serviceTypes');

const proofSchema = new mongoose.Schema({
  type: { type: String, enum: ['before', 'after'], required: true },
  stored_name: { type: String, required: true },
  original_name: { type: String, required: true },
  mime_type: { type: String, required: true },
  size: { type: Number, required: true },
  sha256: { type: String, required: true },
  encryption_version: { type: Number, default: 1 },
  encrypted_at: Date,
  client_operation_id: String,
  captured_at: { type: Date, required: true },
  uploaded_at: { type: Date, default: Date.now },
  location: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy_meters: Number,
  },
}, { _id: true });

const statusHistorySchema = new mongoose.Schema({
  from: String,
  to: { type: String, required: true },
  changed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  changed_at: { type: Date, default: Date.now },
  note: String,
}, { _id: false });

const pickupRequestSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  collector_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'WasteCategory', required: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'assigned', 'on_way', 'in_progress', 'completed', 'cancelled', 'failed'],
    default: 'pending',
  },
  address: { type: String, required: true },
  address_details: {
    city: String,
    district: String,
    address_line: String,
    landmark: String,
    postal_code: String,
  },
  latitude: Number,
  longitude: Number,
  collector_location: {
    latitude: Number,
    longitude: Number,
    accuracy_meters: Number,
    updated_at: Date,
  },
  eta_minutes: Number,
  remaining_distance_km: Number,
  quantity_estimate: String,
  quantity_number: { type: Number, default: 1 },
  distance_km: Number,
  notes: String,
  image_url: String,
  proof_url: String,
  proofs: { type: [proofSchema], default: [] },
  proofs_delete_at: Date,
  proofs_deleted_at: Date,
  completion_verification: {
    code_hash: { type: String, select: false },
    encrypted_code: { type: String, select: false },
    expires_at: Date,
    attempts: { type: Number, default: 0 },
    verified_at: Date,
  },
  status_history: { type: [statusHistorySchema], default: [] },
  assignment_metadata: {
    score: Number,
    distance_km: Number,
    zone_match: Boolean,
    vehicle_match: Boolean,
    rating: Number,
    active_tasks: Number,
    assigned_at: Date,
  },
  cancellation: {
    reason: String,
    details: String,
    cancelled_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelled_at: Date,
    fee_amount: { type: Number, default: 0 },
  },
  recurrence_schedule_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RecurringSchedule' },
  business_contract_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessContract' },
  business_site_id: mongoose.Schema.Types.ObjectId,
  service_slot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceSlot' },
  scheduled_at: Date,
  collected_at: Date,
  estimated_price: Number,
  final_price: Number,
  service_type: {
    type: String,
    enum: SERVICE_TYPES,
    default: 'immediate',
  },
  pricing: {
    base_subtotal: Number,
    distance_fee: Number,
    service_multiplier: Number,
    service_fee: Number,
    zone_multiplier: Number,
    zone_fee: Number,
    zone_label: String,
    total: Number,
  },
  business_details: {
    company_name: String,
    registration_number: String,
    tax_id: String,
    billing_email: String,
    billing_address: String,
    contact_name: String,
  },
  is_archived: { type: Boolean, default: false },
  archived_at: Date,
  rating_score: Number,
  rating_comment: String,
  client_operation_id: String,
  processed_operation_ids: { type: [String], default: [] },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  optimisticConcurrency: true,
});


pickupRequestSchema.index({ user_id: 1, is_archived: 1, status: 1, created_at: -1 });
pickupRequestSchema.index({
  collector_id: 1,
  is_archived: 1,
  status: 1,
  created_at: -1,
});
pickupRequestSchema.index({
  status: 1,
  collector_id: 1,
  created_at: -1,
}); // available requests for collectors
pickupRequestSchema.index({ created_at: -1 });             // admin recent requests sort
pickupRequestSchema.index({ recurrence_schedule_id: 1, scheduled_at: 1 });
pickupRequestSchema.index({ proofs_delete_at: 1, proofs_deleted_at: 1 });
pickupRequestSchema.index(
  { user_id: 1, client_operation_id: 1 },
  { unique: true, partialFilterExpression: { client_operation_id: { $type: 'string' } } }
);

module.exports = mongoose.model('PickupRequest', pickupRequestSchema);
