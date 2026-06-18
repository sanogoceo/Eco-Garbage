const mongoose = require('mongoose');
const { SERVICE_TYPES } = require('../utils/serviceTypes');

const serviceSlotSchema = new mongoose.Schema({
  service_type: { type: String, enum: SERVICE_TYPES, required: true },
  start_at: { type: Date, required: true },
  end_at: { type: Date, required: true },
  capacity: { type: Number, required: true, min: 1 },
  reserved_count: { type: Number, default: 0, min: 0 },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

serviceSlotSchema.index({ service_type: 1, start_at: 1 }, { unique: true });
serviceSlotSchema.index({ start_at: 1 });

module.exports = mongoose.model('ServiceSlot', serviceSlotSchema);
