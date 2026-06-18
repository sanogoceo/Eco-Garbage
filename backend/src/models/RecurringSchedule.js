const mongoose = require('mongoose');

const recurringScheduleSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'WasteCategory', required: true },
  frequency: { type: String, enum: ['weekly', 'biweekly', 'monthly'], required: true },
  day_of_week: { type: Number, min: 0, max: 6 },
  day_of_month: { type: Number, min: 1, max: 28 },
  preferred_time: { type: String, required: true },
  next_run_at: { type: Date, required: true },
  address: { type: String, required: true },
  address_details: {
    city: String,
    district: String,
    address_line: String,
    landmark: String,
    postal_code: String,
  },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  quantity_estimate: String,
  quantity_number: { type: Number, default: 1 },
  notes: String,
  is_active: { type: Boolean, default: true },
  last_generated_at: Date,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

recurringScheduleSchema.index({ is_active: 1, next_run_at: 1 });
recurringScheduleSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model('RecurringSchedule', recurringScheduleSchema);
