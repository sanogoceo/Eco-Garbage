const mongoose = require('mongoose');

const channelDeliverySchema = new mongoose.Schema({
  status: {
    type: String,
    enum: [
      'pending',
      'processing',
      'retry_scheduled',
      'delivered',
      'failed',
      'unavailable',
      'not_required',
    ],
    default: 'pending',
  },
  attempts: { type: Number, default: 0 },
  max_attempts: { type: Number, default: 4 },
  next_attempt_at: Date,
  last_attempt_at: Date,
  delivered_at: Date,
  last_error: String,
  sent_count: { type: Number, default: 0 },
  failed_count: { type: Number, default: 0 },
}, { _id: false });

const notificationSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, default: 'info' },
  is_read: { type: Boolean, default: false },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  priority: {
    type: String,
    enum: ['normal', 'high', 'critical'],
    default: 'normal',
  },
  delivery: {
    status: {
      type: String,
      enum: ['pending', 'retry_scheduled', 'delivered', 'failed'],
      default: 'pending',
    },
    fallback_email_triggered: { type: Boolean, default: false },
    email_fallback_enabled: { type: Boolean, default: true },
    lock_token: String,
    locked_until: Date,
    push: {
      type: channelDeliverySchema,
      default: () => ({ status: 'pending' }),
    },
    email: {
      type: channelDeliverySchema,
      default: () => ({ status: 'not_required' }),
    },
    completed_at: Date,
  },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

notificationSchema.index({ user_id: 1, created_at: -1 });  // list sorted
notificationSchema.index({ user_id: 1, is_read: 1 });       // unread count
notificationSchema.index({ 'delivery.status': 1, created_at: -1 });
notificationSchema.index({
  'delivery.status': 1,
  'delivery.push.status': 1,
  'delivery.push.next_attempt_at': 1,
  created_at: 1,
});
notificationSchema.index({
  'delivery.status': 1,
  'delivery.email.status': 1,
  'delivery.email.next_attempt_at': 1,
  created_at: 1,
});

module.exports = mongoose.model('Notification', notificationSchema);
