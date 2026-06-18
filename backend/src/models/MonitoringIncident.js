const mongoose = require('mongoose');

const monitoringIncidentSchema = new mongoose.Schema({
  fingerprint: { type: String, required: true, unique: true },
  source: {
    type: String,
    enum: ['backend', 'frontend', 'database', 'system'],
    required: true,
  },
  severity: {
    type: String,
    enum: ['warning', 'error', 'critical'],
    default: 'error',
  },
  kind: { type: String, required: true },
  message: { type: String, required: true },
  stack: String,
  route: String,
  method: String,
  status_code: Number,
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  occurrences: { type: Number, default: 1 },
  first_seen_at: { type: Date, default: Date.now },
  last_seen_at: { type: Date, default: Date.now },
  last_alerted_at: Date,
  resolved: { type: Boolean, default: false },
  resolved_at: Date,
  resolved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

monitoringIncidentSchema.index({ resolved: 1, severity: 1, last_seen_at: -1 });
monitoringIncidentSchema.index({ source: 1, last_seen_at: -1 });

module.exports = mongoose.model('MonitoringIncident', monitoringIncidentSchema);
