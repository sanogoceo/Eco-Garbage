const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true, unique: true },
  platform: { type: String, enum: ['android', 'web', 'ios'], default: 'android' },
  device_name: String,
  is_active: { type: Boolean, default: true },
  last_seen_at: { type: Date, default: Date.now },
  last_delivery_at: Date,
  last_failure_at: Date,
  failure_count: { type: Number, default: 0 },
  last_error: String,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

deviceTokenSchema.index({ user_id: 1, is_active: 1 });

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);
