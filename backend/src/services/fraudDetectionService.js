const { randomUUID } = require('crypto');
const FraudAlert = require('../models/FraudAlert');
const User = require('../models/User');
const { fingerprint } = require('../utils/sensitiveData');

const OPEN_STATUSES = ['open', 'investigating'];

const normalizePhone = (value) => String(value || '').replace(/[\s\-().]/g, '');

const severityForScore = (score) => {
  if (score >= 90) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
};

const requestFingerprints = (req) => {
  const deviceId = String(req?.get?.('X-Eco-Device-ID') || '').trim();
  const ip = String(req?.ip || '').trim();
  return {
    device_fingerprint: deviceId ? fingerprint(`device:${deviceId}`) : undefined,
    ip_fingerprint: ip ? fingerprint(`ip:${ip}`) : undefined,
  };
};

const recordFraudAlert = async ({
  category,
  dedupeKey,
  score,
  title,
  description,
  signals = [],
  subjectUserId,
  relatedUserIds = [],
  collectorApplicationId,
  pickupRequestId,
  paymentId,
}) => {
  try {
    const normalizedScore = Math.max(0, Math.min(100, Number(score) || 0));
    const alertFingerprint = fingerprint(`fraud:${category}:${dedupeKey}`);
    const now = new Date();
    const alert = await FraudAlert.findOneAndUpdate(
      { fingerprint: alertFingerprint },
      {
        $set: {
          severity: severityForScore(normalizedScore),
          title: String(title).slice(0, 180),
          description: String(description).slice(0, 1000),
          signals,
          last_detected_at: now,
          ...(subjectUserId ? { subject_user_id: subjectUserId } : {}),
          ...(collectorApplicationId
            ? { collector_application_id: collectorApplicationId }
            : {}),
          ...(pickupRequestId ? { pickup_request_id: pickupRequestId } : {}),
          ...(paymentId ? { payment_id: paymentId } : {}),
        },
        $setOnInsert: {
          uuid: randomUUID(),
          fingerprint: alertFingerprint,
          category,
          status: 'open',
          first_detected_at: now,
        },
        $max: { risk_score: normalizedScore },
        $addToSet: {
          related_user_ids: { $each: relatedUserIds.filter(Boolean) },
        },
        $inc: { occurrences: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return alert;
  } catch (error) {
    if (error?.code === 11000) return null;
    console.error('Fraud detection error:', error);
    return null;
  }
};

const evaluateMultipleAccounts = async ({ user, req }) => {
  if (!user?._id) return null;
  const normalizedPhone = normalizePhone(user.phone);
  const phoneFingerprint = normalizedPhone
    ? fingerprint(`phone:${normalizedPhone}`)
    : undefined;
  const { device_fingerprint: deviceFingerprint, ip_fingerprint: ipFingerprint }
    = requestFingerprints(req);

  await User.findByIdAndUpdate(user._id, {
    $set: {
      ...(phoneFingerprint ? { phone_fingerprint: phoneFingerprint } : {}),
      ...(deviceFingerprint ? { registration_device_fingerprint: deviceFingerprint } : {}),
      ...(ipFingerprint ? { registration_ip_fingerprint: ipFingerprint } : {}),
    },
  });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [samePhone, sameDevice, recentIpAccounts] = await Promise.all([
    normalizedPhone
      ? User.find({
          _id: { $ne: user._id },
          $or: [
            { phone_fingerprint: phoneFingerprint },
            { phone: normalizedPhone },
          ],
        }).select('_id').limit(10).lean()
      : [],
    deviceFingerprint
      ? User.find({
          _id: { $ne: user._id },
          registration_device_fingerprint: deviceFingerprint,
        }).select('_id').limit(10).lean()
      : [],
    ipFingerprint
      ? User.find({
          _id: { $ne: user._id },
          registration_ip_fingerprint: ipFingerprint,
          created_at: { $gte: since },
        }).select('_id').limit(20).lean()
      : [],
  ]);

  const signals = [];
  if (samePhone.length) {
    signals.push({
      code: 'shared_phone',
      weight: 65,
      details: { matching_accounts: samePhone.length },
    });
  }
  if (sameDevice.length) {
    signals.push({
      code: 'shared_device',
      weight: 45,
      details: { matching_accounts: sameDevice.length },
    });
  }
  if (recentIpAccounts.length >= 3) {
    signals.push({
      code: 'registration_ip_cluster',
      weight: 25,
      details: { accounts_in_24h: recentIpAccounts.length + 1 },
    });
  }
  if (!signals.length) return null;

  const score = Math.min(100, signals.reduce((sum, signal) => sum + signal.weight, 0));
  const relatedUserIds = [...new Set(
    [...samePhone, ...sameDevice, ...recentIpAccounts].map((item) => item._id.toString())
  )];
  return recordFraudAlert({
    category: 'multiple_accounts',
    dedupeKey: `user:${user._id}`,
    score,
    title: 'Comptes potentiellement multiples',
    description: 'Plusieurs comptes partagent un telephone, un appareil ou un contexte d inscription.',
    signals,
    subjectUserId: user._id,
    relatedUserIds,
  });
};

const hasBlockingCollectorAlert = async ({ userId, applicationId }) => FraudAlert.exists({
  category: 'fake_collector',
  status: { $in: OPEN_STATUSES },
  severity: { $in: ['high', 'critical'] },
  $or: [
    { subject_user_id: userId },
    ...(applicationId ? [{ collector_application_id: applicationId }] : []),
  ],
});

module.exports = {
  OPEN_STATUSES,
  evaluateMultipleAccounts,
  hasBlockingCollectorAlert,
  normalizePhone,
  recordFraudAlert,
  requestFingerprints,
  severityForScore,
};
