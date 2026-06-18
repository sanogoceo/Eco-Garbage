const {
  recordApiMetric,
  recordIncident,
  SLOW_REQUEST_MS,
} = require('../services/monitoringService');

const configuredSampleRate = Number.parseFloat(
  process.env.MONITORING_METRIC_SAMPLE_RATE
);
const defaultSampleRate = process.env.NODE_ENV === 'test'
  ? 0
  : process.env.NODE_ENV === 'production'
    ? 0.1
    : 1;
const metricSampleRate = Math.min(
  1,
  Math.max(0, Number.isFinite(configuredSampleRate)
    ? configuredSampleRate
    : defaultSampleRate)
);

const shouldRecordMetric = ({
  statusCode,
  durationMs,
  random = Math.random(),
  sampleRate = metricSampleRate,
}) => (
  statusCode >= 500
  || durationMs >= SLOW_REQUEST_MS
  || random <= (
    statusCode >= 400
      ? Math.max(0.01, sampleRate)
      : sampleRate
  )
);

const monitoringMiddleware = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health') return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const route = req.route?.path
      ? `${req.baseUrl || ''}${req.route.path}`
      : req.originalUrl?.split('?')[0] || req.path;
    if (shouldRecordMetric({ statusCode: res.statusCode, durationMs })) {
      recordApiMetric({
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs,
        userRole: req.user?.role,
      });
    }
    if (res.statusCode >= 500) {
      recordIncident({
        source: 'backend',
        severity: 'error',
        kind: 'http_5xx',
        message: `Reponse HTTP ${res.statusCode}`,
        route,
        method: req.method,
        statusCode: res.statusCode,
        userId: req.user?.id,
        metadata: { duration_ms: Math.round(durationMs) },
      }).catch(() => {});
    } else if (durationMs >= SLOW_REQUEST_MS) {
      recordIncident({
        source: 'backend',
        severity: 'warning',
        kind: 'slow_request',
        message: `Requete lente: ${Math.round(durationMs)} ms`,
        route,
        method: req.method,
        statusCode: res.statusCode,
        userId: req.user?.id,
        metadata: { duration_ms: Math.round(durationMs) },
      }).catch(() => {});
    }
  });
  next();
};

module.exports = {
  monitoringMiddleware,
  _internals: { metricSampleRate, shouldRecordMetric },
};
