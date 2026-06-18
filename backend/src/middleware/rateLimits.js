const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const createRateLimitKey = (req) => (
  req.user?.id
    ? `user:${req.user.id}`
    : `ip:${ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown')}`
);

const createLimiter = ({ windowMs, max, message }) => rateLimit({
  windowMs,
  max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: createRateLimitKey,
  handler: (req, res, next, options) => {
    const retryAfter = Number.parseInt(res.getHeader('Retry-After'), 10);
    res.status(options.statusCode).json({
      success: false,
      code: 'RATE_LIMITED',
      message,
      retry_after_seconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    });
  },
});

const globalApiLimiter = createLimiter({
  windowMs: 60_000,
  max: positiveInteger(process.env.API_RATE_LIMIT_PER_MINUTE, 600),
  message: 'Trop de requetes vers l API. Patientez quelques instants.',
});

const authLimiter = createLimiter({
  windowMs: 15 * 60_000,
  max: positiveInteger(process.env.AUTH_RATE_LIMIT_PER_15_MINUTES, 15),
  message: 'Trop de tentatives. Reessayez dans 15 minutes.',
});

const collectorApplicationLimiter = createLimiter({
  windowMs: 24 * 60 * 60_000,
  max: positiveInteger(process.env.COLLECTOR_APPLICATION_RATE_LIMIT_PER_DAY, 5),
  message: 'Trop de tentatives de candidature. Reessayez plus tard.',
});

const gpsLimiter = createLimiter({
  windowMs: 60_000,
  max: positiveInteger(process.env.GPS_RATE_LIMIT_PER_MINUTE, 120),
  message: 'Trop de mises a jour GPS. Patientez quelques secondes.',
});

const chatWriteLimiter = createLimiter({
  windowMs: 60_000,
  max: positiveInteger(process.env.CHAT_WRITE_RATE_LIMIT_PER_MINUTE, 30),
  message: 'Trop de messages envoyes.',
});

const chatReadLimiter = createLimiter({
  windowMs: 60_000,
  max: positiveInteger(process.env.CHAT_READ_RATE_LIMIT_PER_MINUTE, 120),
  message: 'Trop d actualisations du chat.',
});

const notificationLimiter = createLimiter({
  windowMs: 60_000,
  max: positiveInteger(process.env.NOTIFICATION_RATE_LIMIT_PER_MINUTE, 120),
  message: 'Trop d actualisations des notifications.',
});

const requestReadLimiter = createLimiter({
  windowMs: 60_000,
  max: positiveInteger(process.env.REQUEST_READ_RATE_LIMIT_PER_MINUTE, 180),
  message: 'Trop d actualisations des collectes.',
});

const expensiveOperationLimiter = createLimiter({
  windowMs: 60_000,
  max: positiveInteger(process.env.EXPENSIVE_OPERATION_RATE_LIMIT_PER_MINUTE, 30),
  message: 'Trop de calculs demandes. Patientez quelques instants.',
});

const webhookLimiter = createLimiter({
  windowMs: 60_000,
  max: positiveInteger(process.env.WEBHOOK_RATE_LIMIT_PER_MINUTE, 180),
  message: 'Trop d appels webhook.',
});

const sensitiveActionLimiter = createLimiter({
  windowMs: 60 * 60_000,
  max: positiveInteger(process.env.SENSITIVE_ACTION_RATE_LIMIT_PER_HOUR, 10),
  message: 'Trop de tentatives. Reessayez plus tard.',
});

const sensitiveReadLimiter = createLimiter({
  windowMs: 60 * 60_000,
  max: positiveInteger(process.env.SENSITIVE_READ_RATE_LIMIT_PER_HOUR, 120),
  message: 'Trop de consultations de documents sensibles.',
});

const adminStepUpLimiter = createLimiter({
  windowMs: 15 * 60_000,
  max: positiveInteger(process.env.ADMIN_STEP_UP_RATE_LIMIT_PER_15_MINUTES, 20),
  message: 'Trop de confirmations administrateur. Reessayez dans 15 minutes.',
});

module.exports = {
  adminStepUpLimiter,
  authLimiter,
  chatReadLimiter,
  chatWriteLimiter,
  collectorApplicationLimiter,
  createRateLimitKey,
  expensiveOperationLimiter,
  globalApiLimiter,
  gpsLimiter,
  notificationLimiter,
  requestReadLimiter,
  sensitiveActionLimiter,
  sensitiveReadLimiter,
  webhookLimiter,
};
