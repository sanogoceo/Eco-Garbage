const mongoose = require('mongoose');

const siteSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  city: { type: String, required: true, trim: true, maxlength: 100 },
  district: { type: String, required: true, trim: true, maxlength: 120 },
  address_line: { type: String, required: true, trim: true, maxlength: 300 },
  landmark: { type: String, trim: true, maxlength: 160 },
  latitude: { type: Number, required: true, min: -90, max: 90 },
  longitude: { type: Number, required: true, min: -180, max: 180 },
  contact_name: { type: String, trim: true, maxlength: 120 },
  contact_phone: { type: String, trim: true, maxlength: 30 },
  is_active: { type: Boolean, default: true },
  status: {
    type: String,
    enum: ['pending', 'active', 'suspended', 'rejected'],
    default: 'pending',
  },
  reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewed_at: Date,
  review_notes: { type: String, trim: true, maxlength: 500 },
}, { _id: true });

const businessContractSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  company_name: { type: String, required: true, trim: true, maxlength: 160 },
  registration_number: { type: String, required: true, trim: true, maxlength: 80 },
  tax_id: { type: String, trim: true, maxlength: 80 },
  billing_email: { type: String, required: true, lowercase: true, trim: true },
  billing_address: { type: String, required: true, trim: true, maxlength: 300 },
  contact_name: { type: String, required: true, trim: true, maxlength: 120 },
  monthly_quota: { type: Number, min: 1, max: 10_000, default: 20 },
  billing_cycle: {
    type: String,
    enum: ['per_collection', 'monthly'],
    default: 'monthly',
  },
  payment_terms_days: { type: Number, min: 0, max: 90, default: 30 },
  credit_limit: { type: Number, min: 0, max: 100_000_000, default: 0 },
  negotiated_pricing: {
    price_multiplier: { type: Number, min: 0.1, max: 10, default: 1 },
    fixed_fee: { type: Number, min: 0, max: 1_000_000, default: 0 },
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'suspended', 'rejected', 'expired'],
    default: 'pending',
  },
  reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewed_at: Date,
  review_notes: { type: String, trim: true, maxlength: 500 },
  starts_at: { type: Date, default: Date.now },
  expires_at: Date,
  sites: { type: [siteSchema], default: [] },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

businessContractSchema.index({ user_id: 1, status: 1, created_at: -1 });
businessContractSchema.index({ status: 1, created_at: -1 });

module.exports = mongoose.model('BusinessContract', businessContractSchema);
