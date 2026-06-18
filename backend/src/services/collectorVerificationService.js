const User = require('../models/User');
const { notifyUser } = require('./notificationService');

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const addDays = (date, days) => new Date(
  new Date(date).getTime() + days * 24 * 60 * 60 * 1000
);

const getVerificationValidUntil = (verifiedAt = new Date()) => addDays(
  verifiedAt,
  positiveInteger(process.env.COLLECTOR_VERIFICATION_VALIDITY_DAYS, 365)
);

const getRenewalReminderDate = (validUntil) => addDays(
  validUntil,
  -positiveInteger(process.env.COLLECTOR_RENEWAL_REMINDER_DAYS, 60)
);

const backfillCollectorVerificationDeadlines = async ({ now = new Date() } = {}) => {
  const legacyGraceDays = positiveInteger(
    process.env.LEGACY_COLLECTOR_VERIFICATION_GRACE_DAYS,
    90
  );
  const result = await User.updateMany(
    {
      role: 'collector',
      'collector_profile.verification_status': 'verified',
      'collector_profile.verification_expires_at': null,
    },
    {
      $set: {
        'collector_profile.verification_expires_at': addDays(now, legacyGraceDays),
        'collector_profile.renewal_status': 'due',
        'collector_profile.renewal_notified_at': null,
      },
    }
  );
  return result.modifiedCount;
};

const processCollectorVerificationRenewals = async ({ now = new Date() } = {}) => {
  const backfilled = await backfillCollectorVerificationDeadlines({ now });
  const reminderDays = positiveInteger(
    process.env.COLLECTOR_RENEWAL_REMINDER_DAYS,
    60
  );
  const reminderLimit = addDays(now, reminderDays);
  const collectors = await User.find({
    role: 'collector',
    is_active: true,
    'collector_profile.verification_expires_at': { $lte: reminderLimit },
  }).select('collector_profile.verification_expires_at collector_profile.renewal_status collector_profile.renewal_notified_at');

  let due = 0;
  let expired = 0;
  let notified = 0;

  for (const collector of collectors) {
    const expiresAt = collector.collector_profile?.verification_expires_at;
    if (!expiresAt) continue;

    const isExpired = expiresAt <= now;
    const nextStatus = isExpired ? 'expired' : 'due';
    const alreadyNotified = collector.collector_profile?.renewal_notified_at
      && collector.collector_profile?.renewal_status === nextStatus;

    const update = {
      'collector_profile.renewal_status': nextStatus,
    };
    if (isExpired) {
      update['collector_profile.verification_status'] = 'pending';
      update['collector_profile.is_available'] = false;
      expired += 1;
    } else {
      due += 1;
    }

    if (!alreadyNotified) {
      update['collector_profile.renewal_notified_at'] = now;
    }

    await User.updateOne({ _id: collector._id }, { $set: update });

    if (!alreadyNotified) {
      await notifyUser({
        userId: collector._id,
        title: isExpired
          ? 'Verification collecteur expiree'
          : 'Renouvellement collecteur requis',
        message: isExpired
          ? 'Votre verification a expire. Renouvelez votre dossier pour reprendre les collectes.'
          : `Votre verification expire le ${expiresAt.toLocaleDateString('fr-FR')}. Renouvelez votre dossier maintenant.`,
        type: 'collector_verification',
        priority: isExpired ? 'critical' : 'high',
        data: { target_path: '/collector/verification' },
      });
      notified += 1;
    }
  }

  return { backfilled, due, expired, notified };
};

let verificationTimer;

const startCollectorVerificationScheduler = () => {
  if (process.env.NODE_ENV === 'test' || verificationTimer) return;
  const intervalHours = positiveInteger(
    process.env.COLLECTOR_VERIFICATION_CHECK_INTERVAL_HOURS,
    6
  );
  const run = () => processCollectorVerificationRenewals().catch((error) => {
    console.error('Collector verification maintenance failed:', error);
  });
  const initialTimer = setTimeout(run, 45 * 1000);
  initialTimer.unref();
  verificationTimer = setInterval(run, intervalHours * 60 * 60 * 1000);
  verificationTimer.unref();
};

module.exports = {
  backfillCollectorVerificationDeadlines,
  getRenewalReminderDate,
  getVerificationValidUntil,
  processCollectorVerificationRenewals,
  startCollectorVerificationScheduler,
};
