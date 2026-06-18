const crypto = require('crypto');
const mongoose = require('mongoose');
const ApiMetric = require('../models/ApiMetric');
const MonitoringIncident = require('../models/MonitoringIncident');
const User = require('../models/User');
const { notifyUser } = require('./notificationService');

const METRIC_RETENTION_DAYS = Math.max(
  1,
  Number.parseInt(process.env.MONITORING_METRIC_RETENTION_DAYS, 10) || 30
);
const ALERT_THRESHOLD = Math.max(
  1,
  Number.parseInt(process.env.MONITORING_ALERT_THRESHOLD, 10) || 3
);
const ALERT_COOLDOWN_MS = Math.max(
  1,
  Number.parseInt(process.env.MONITORING_ALERT_COOLDOWN_MINUTES, 10) || 30
) * 60_000;
const SLOW_REQUEST_MS = Math.max(
  100,
  Number.parseInt(process.env.MONITORING_SLOW_REQUEST_MS, 10) || 1500
);

const sanitizeText = (value, maxLength = 1000) => String(value || '')
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
  .replace(/(password|token|secret|authorization)=?[^&\s]*/gi, '$1=[REDACTED]')
  .slice(0, maxLength);

const normalizeRoute = (route) => String(route || '/unknown')
  .replace(/[0-9a-f]{24}/gi, ':id')
  .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':uuid')
  .slice(0, 220);

const createFingerprint = ({ source, kind, message, route, method }) => crypto
  .createHash('sha256')
  .update([
    source,
    kind,
    normalizeRoute(route),
    method,
    sanitizeText(message, 300),
  ].join('|'))
  .digest('hex');

const sendExternalAlert = async (incident) => {
  const webhookUrl = process.env.MONITORING_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      application: 'EcoGarbage',
      severity: incident.severity,
      source: incident.source,
      kind: incident.kind,
      message: incident.message,
      route: incident.route,
      occurrences: incident.occurrences,
      last_seen_at: incident.last_seen_at,
    }),
  });
  if (!response.ok) throw new Error(`Monitoring webhook ${response.status}`);
};

const alertAdministrators = async (incident) => {
  const now = new Date();
  const shouldAlert = incident.severity === 'critical'
    || incident.occurrences >= ALERT_THRESHOLD;
  const cooldownElapsed = !incident.last_alerted_at
    || now.getTime() - incident.last_alerted_at.getTime() >= ALERT_COOLDOWN_MS;
  if (!shouldAlert || !cooldownElapsed) return;

  const administrators = await User.find({
    role: 'admin',
    is_active: true,
  }).select('_id').lean();
  await Promise.allSettled([
    ...administrators.map((administrator) => notifyUser({
      userId: administrator._id,
      title: `Alerte technique ${incident.severity}`,
      message: `${incident.kind}: ${incident.message}`,
      type: 'monitoring',
      priority: incident.severity === 'critical' ? 'critical' : 'high',
      data: { target_path: '/admin/monitoring', incident_id: incident._id },
    })),
    sendExternalAlert(incident),
  ]);
  incident.last_alerted_at = now;
  await incident.save();
};

const recordIncident = async ({
  source,
  severity = 'error',
  kind,
  message,
  stack,
  route,
  method,
  statusCode,
  userId,
  metadata = {},
}) => {
  if (mongoose.connection.readyState !== 1) {
    sendExternalAlert({
      severity,
      source,
      kind,
      message: sanitizeText(message, 500),
      route: normalizeRoute(route),
      occurrences: 1,
      last_seen_at: new Date(),
    }).catch(() => {});
    return null;
  }
  const fingerprint = createFingerprint({
    source,
    kind,
    message,
    route,
    method,
  });
  const now = new Date();
  const incident = await MonitoringIncident.findOneAndUpdate(
    { fingerprint },
    {
      $set: {
        source,
        severity,
        kind: sanitizeText(kind, 120),
        message: sanitizeText(message, 1000),
        stack: sanitizeText(stack, 4000),
        route: normalizeRoute(route),
        method: String(method || '').slice(0, 10),
        status_code: statusCode,
        user_id: mongoose.isValidObjectId(userId) ? userId : undefined,
        metadata,
        last_seen_at: now,
        resolved: false,
        resolved_at: null,
        resolved_by: null,
      },
      $setOnInsert: { first_seen_at: now },
      $inc: { occurrences: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: false }
  );
  await alertAdministrators(incident).catch((error) => {
    console.error('Monitoring alert error:', error.message);
  });
  return incident;
};

const recordApiMetric = ({
  method,
  route,
  statusCode,
  durationMs,
  userRole,
}) => {
  if (mongoose.connection.readyState !== 1) return Promise.resolve();
  const recordedAt = new Date();
  return ApiMetric.create({
    method: String(method || 'GET').slice(0, 10),
    route: normalizeRoute(route),
    status_code: statusCode,
    duration_ms: Math.max(0, Math.round(durationMs * 100) / 100),
    is_error: statusCode >= 500,
    user_role: String(userRole || 'anonymous').slice(0, 30),
    recorded_at: recordedAt,
    expires_at: new Date(
      recordedAt.getTime() + METRIC_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ),
  }).catch((error) => {
    console.error('API metric recording error:', error.message);
  });
};

const pingDatabase = async () => {
  const startedAt = process.hrtime.bigint();
  try {
    if (mongoose.connection.readyState !== 1) {
      return { status: 'down', latency_ms: null };
    }
    await mongoose.connection.db.admin().ping();
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    return {
      status: latencyMs >= 500 ? 'degraded' : 'up',
      latency_ms: Math.round(latencyMs * 100) / 100,
    };
  } catch (error) {
    recordIncident({
      source: 'database',
      severity: 'critical',
      kind: 'mongodb_unavailable',
      message: error.message,
    }).catch(() => {});
    return { status: 'down', latency_ms: null };
  }
};

let eventLoopLagMs = 0;
let eventLoopTimer;
let healthTimer;
const startEventLoopMonitor = () => {
  if (eventLoopTimer) return;
  let expected = Date.now() + 1000;
  eventLoopTimer = setInterval(() => {
    const now = Date.now();
    eventLoopLagMs = Math.max(0, now - expected);
    expected = now + 1000;
  }, 1000);
  eventLoopTimer.unref();
};

const getRuntimeHealth = async () => {
  const database = await pingDatabase();
  const memory = process.memoryUsage();
  return {
    status: database.status === 'down'
      ? 'down'
      : eventLoopLagMs > 500 || database.status === 'degraded'
        ? 'degraded'
        : 'up',
    api: {
      status: 'up',
      uptime_seconds: Math.round(process.uptime()),
      event_loop_lag_ms: eventLoopLagMs,
      memory_rss_mb: Math.round(memory.rss / 1024 / 1024),
      heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
    },
    database,
    timestamp: new Date(),
  };
};

const startHealthMonitoringScheduler = () => {
  startEventLoopMonitor();
  if (process.env.NODE_ENV === 'test' || healthTimer) return;
  const intervalSeconds = Math.max(
    15,
    Number.parseInt(process.env.MONITORING_HEALTH_INTERVAL_SECONDS, 10) || 60
  );
  const check = async () => {
    const health = await getRuntimeHealth();
    if (health.database.status === 'down') {
      await recordIncident({
        source: 'database',
        severity: 'critical',
        kind: 'mongodb_unavailable',
        message: 'MongoDB ne repond pas au controle de disponibilite',
      });
    }
    if (health.api.event_loop_lag_ms > 500) {
      await recordIncident({
        source: 'system',
        severity: health.api.event_loop_lag_ms > 1500 ? 'critical' : 'warning',
        kind: 'event_loop_lag',
        message: `Retard event loop: ${health.api.event_loop_lag_ms} ms`,
        metadata: { event_loop_lag_ms: health.api.event_loop_lag_ms },
      });
    }
  };
  const initialTimer = setTimeout(() => check().catch(() => {}), 10_000);
  initialTimer.unref();
  healthTimer = setInterval(() => check().catch(() => {}), intervalSeconds * 1000);
  healthTimer.unref();
};

module.exports = {
  getRuntimeHealth,
  normalizeRoute,
  recordApiMetric,
  recordIncident,
  SLOW_REQUEST_MS,
  startHealthMonitoringScheduler,
  startEventLoopMonitor,
  _internals: { createFingerprint, sanitizeText },
};
