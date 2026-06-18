const mongoose = require('mongoose');
const { SERVICE_TYPES } = require('../utils/serviceTypes');

const serviceConfigurationSchema = new mongoose.Schema({
  service_type: { type: String, enum: SERVICE_TYPES, required: true, unique: true },
  price_multiplier: { type: Number, min: 0.1, max: 10, default: 1 },
  fixed_fee: { type: Number, min: 0, max: 1_000_000, default: 0 },
  slot_duration_minutes: { type: Number, min: 15, max: 240, default: 60 },
  max_requests_per_slot: { type: Number, min: 1, max: 500, default: 10 },
  zone_pricing: {
    type: [{
      city: { type: String, required: true, trim: true, maxlength: 100 },
      district: { type: String, trim: true, maxlength: 120 },
      price_multiplier: { type: Number, min: 0.1, max: 10, default: 1 },
      fixed_fee: { type: Number, min: 0, max: 1_000_000, default: 0 },
    }],
    default: [],
  },
  weekly_schedule: {
    type: [{
      day_of_week: { type: Number, required: true, min: 0, max: 6 },
      is_open: { type: Boolean, default: true },
      opening_time: { type: String, default: '07:00' },
      closing_time: { type: String, default: '19:00' },
      capacity_override: { type: Number, min: 1, max: 500 },
    }],
    default: [],
  },
  blackout_dates: { type: [String], default: [] },
  is_active: { type: Boolean, default: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

module.exports = mongoose.model('ServiceConfiguration', serviceConfigurationSchema);
