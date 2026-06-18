const mongoose = require('mongoose');

const apiMetricSchema = new mongoose.Schema({
  method: { type: String, required: true },
  route: { type: String, required: true },
  status_code: { type: Number, required: true },
  duration_ms: { type: Number, required: true },
  is_error: { type: Boolean, default: false },
  user_role: String,
  recorded_at: { type: Date, default: Date.now },
  expires_at: { type: Date, required: true },
}, { versionKey: false });

apiMetricSchema.index({ recorded_at: -1 });
apiMetricSchema.index({ route: 1, recorded_at: -1 });
apiMetricSchema.index({ is_error: 1, recorded_at: -1 });
apiMetricSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ApiMetric', apiMetricSchema);
