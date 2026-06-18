const mongoose = require('mongoose');

const authSessionSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  device_fingerprint: { type: String, required: true, select: false },
  ip_fingerprint: { type: String, select: false },
  device_name: { type: String, trim: true },
  platform: {
    type: String,
    enum: ['android', 'ios', 'web', 'unknown'],
    default: 'unknown',
  },
  user_agent: String,
  is_unusual: { type: Boolean, default: false },
  last_seen_at: { type: Date, default: Date.now },
  expires_at: { type: Date, required: true },
  revoked_at: Date,
  revoked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  revocation_reason: String,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

authSessionSchema.index({ user_id: 1, revoked_at: 1, last_seen_at: -1 });
authSessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuthSession', authSessionSchema);
