const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actor_type: {
    type: String,
    enum: ['user', 'system'],
    default: 'user',
  },
  action: { type: String, required: true },
  target_type: { type: String, required: true },
  target_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed },
  ip: String,
  user_agent: String,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false },
});

auditLogSchema.index({ target_type: 1, target_id: 1, created_at: -1 });
auditLogSchema.index({ actor_id: 1, created_at: -1 });
auditLogSchema.index({ action: 1, created_at: -1 });
auditLogSchema.index({ created_at: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
