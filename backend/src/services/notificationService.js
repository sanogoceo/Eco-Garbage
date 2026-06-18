const Notification = require('../models/Notification');
const { randomUUID } = require('crypto');
const { sendPushToUser } = require('./pushService');
const {
  isEmailConfigured,
  sendNotificationFallbackEmail,
} = require('./emailService');

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const MAX_ATTEMPTS = positiveInteger(
  process.env.NOTIFICATION_MAX_ATTEMPTS,
  4
);
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const TERMINAL_STATUSES = ['delivered', 'failed', 'unavailable', 'not_required'];

const errorMessage = (error) => String(
  error?.message || error || 'Erreur de livraison inconnue'
).slice(0, 500);

const getRetryDate = (attempts, now = new Date()) => new Date(
  now.getTime() + RETRY_DELAYS_MS[
    Math.min(Math.max(0, attempts - 1), RETRY_DELAYS_MS.length - 1)
  ]
);

const isDue = (channel, now, force) => {
  if (force) return channel.status !== 'delivered';
  if (!['pending', 'retry_scheduled'].includes(channel.status)) return false;
  return !channel.next_attempt_at || channel.next_attempt_at <= now;
};

const scheduleOrFail = (channel, retryable, now) => {
  if (retryable && channel.attempts < channel.max_attempts) {
    channel.status = 'retry_scheduled';
    channel.next_attempt_at = getRetryDate(channel.attempts, now);
  } else {
    channel.status = 'failed';
    channel.next_attempt_at = undefined;
  }
};

const refreshOverallStatus = (notification, now) => {
  const pushStatus = notification.delivery.push.status;
  const emailStatus = notification.delivery.email.status;
  if (pushStatus === 'delivered' || emailStatus === 'delivered') {
    notification.delivery.status = 'delivered';
    notification.delivery.completed_at ||= now;
    return;
  }
  if ([pushStatus, emailStatus].includes('retry_scheduled')
    || [pushStatus, emailStatus].includes('pending')
    || [pushStatus, emailStatus].includes('processing')) {
    notification.delivery.status = 'retry_scheduled';
    notification.delivery.completed_at = undefined;
    return;
  }
  if (TERMINAL_STATUSES.includes(pushStatus)
    && TERMINAL_STATUSES.includes(emailStatus)) {
    notification.delivery.status = 'failed';
    notification.delivery.completed_at = now;
    return;
  }
  notification.delivery.status = 'pending';
};

const attemptPush = async (notification, now, force) => {
  const channel = notification.delivery.push;
  if (!isDue(channel, now, force)) return;

  channel.status = 'processing';
  channel.last_attempt_at = now;
  channel.attempts += 1;
  channel.max_attempts = MAX_ATTEMPTS;
  channel.next_attempt_at = undefined;
  await notification.save();

  try {
    const result = await sendPushToUser(notification.user_id._id || notification.user_id, {
      title: notification.title,
      message: notification.message,
      data: {
        notification_id: notification._id,
        type: notification.type,
        ...notification.data,
      },
    });
    channel.sent_count = result.sent || 0;
    channel.failed_count = result.failed || 0;
    channel.last_error = result.reason || undefined;

    if (result.sent > 0) {
      channel.status = 'delivered';
      channel.delivered_at = now;
      channel.next_attempt_at = undefined;
      if (notification.delivery.email.status !== 'delivered') {
        notification.delivery.email.status = 'not_required';
        notification.delivery.email.next_attempt_at = undefined;
      }
      return;
    }

    if (notification.delivery.email_fallback_enabled !== false) {
      notification.delivery.fallback_email_triggered = true;
      if (!['delivered', 'processing', 'retry_scheduled'].includes(
        notification.delivery.email.status
      )) {
        notification.delivery.email.status = 'pending';
        notification.delivery.email.next_attempt_at = now;
      }
    }

    if (result.unavailable) {
      channel.status = 'unavailable';
      channel.next_attempt_at = undefined;
    } else {
      scheduleOrFail(channel, result.retryable !== false, now);
    }
  } catch (error) {
    channel.failed_count += 1;
    channel.last_error = errorMessage(error);
    if (notification.delivery.email_fallback_enabled !== false) {
      notification.delivery.fallback_email_triggered = true;
      if (!['delivered', 'processing', 'retry_scheduled'].includes(
        notification.delivery.email.status
      )) {
        notification.delivery.email.status = 'pending';
        notification.delivery.email.next_attempt_at = now;
      }
    }
    scheduleOrFail(channel, true, now);
  }
};

const attemptEmail = async (notification, now, force) => {
  const channel = notification.delivery.email;
  if (!notification.delivery.fallback_email_triggered || !isDue(channel, now, force)) {
    return;
  }
  channel.status = 'processing';
  channel.last_attempt_at = now;
  channel.attempts += 1;
  channel.max_attempts = MAX_ATTEMPTS;
  channel.next_attempt_at = undefined;
  await notification.save();

  if (!isEmailConfigured()) {
    channel.status = 'unavailable';
    channel.last_error = 'Service email non configure';
    return;
  }
  const user = notification.user_id;
  if (!user?.email) {
    channel.status = 'unavailable';
    channel.last_error = 'Adresse email utilisateur indisponible';
    return;
  }

  try {
    await sendNotificationFallbackEmail({
      toEmail: user.email,
      userName: user.name,
      title: notification.title,
      message: notification.message,
      targetPath: notification.data?.target_path,
    });
    channel.status = 'delivered';
    channel.sent_count = 1;
    channel.delivered_at = now;
    channel.last_error = undefined;
  } catch (error) {
    channel.failed_count += 1;
    channel.last_error = errorMessage(error);
    scheduleOrFail(channel, true, now);
  }
};

const processNotificationDelivery = async (
  notificationId,
  { force = false } = {}
) => {
  const now = new Date();
  const lockToken = randomUUID();
  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      $or: [
        { 'delivery.locked_until': null },
        { 'delivery.locked_until': { $lt: now } },
      ],
    },
    {
      $set: {
        'delivery.lock_token': lockToken,
        'delivery.locked_until': new Date(now.getTime() + 2 * 60_000),
      },
    },
    { new: true }
  ).populate('user_id', 'name email is_active');
  if (!notification) return null;

  try {
    if (!notification.user_id?.is_active) return null;
    if (!force && notification.delivery.status === 'delivered') {
      return notification;
    }
    await attemptPush(notification, now, force);
    await attemptEmail(notification, now, force);
    refreshOverallStatus(notification, now);
    await notification.save();
    return notification;
  } finally {
    await Notification.updateOne(
      { _id: notificationId, 'delivery.lock_token': lockToken },
      {
        $unset: {
          'delivery.lock_token': 1,
          'delivery.locked_until': 1,
        },
      }
    ).catch(() => {});
  }
};

const processDueNotifications = async ({ limit = 50 } = {}) => {
  const now = new Date();
  const staleProcessing = new Date(now.getTime() - 5 * 60_000);
  await Notification.updateMany(
    { 'delivery.status': { $exists: false } },
    {
      $set: {
        'delivery.status': 'delivered',
        'delivery.fallback_email_triggered': false,
        'delivery.email_fallback_enabled': false,
        'delivery.push.status': 'not_required',
        'delivery.email.status': 'not_required',
        'delivery.completed_at': now,
      },
    }
  );
  await Promise.all([
    Notification.updateMany(
      {
        'delivery.push.status': 'processing',
        'delivery.push.last_attempt_at': { $lt: staleProcessing },
      },
      {
        $set: {
          'delivery.status': 'retry_scheduled',
          'delivery.push.status': 'retry_scheduled',
          'delivery.push.next_attempt_at': now,
        },
      }
    ),
    Notification.updateMany(
      {
        'delivery.email.status': 'processing',
        'delivery.email.last_attempt_at': { $lt: staleProcessing },
      },
      {
        $set: {
          'delivery.status': 'retry_scheduled',
          'delivery.email.status': 'retry_scheduled',
          'delivery.email.next_attempt_at': now,
        },
      }
    ),
  ]);

  const notifications = await Notification.find({
    'delivery.status': { $in: ['pending', 'retry_scheduled'] },
    $or: [
      {
        'delivery.push.status': { $in: ['pending', 'retry_scheduled'] },
        $or: [
          { 'delivery.push.next_attempt_at': null },
          { 'delivery.push.next_attempt_at': { $lte: now } },
        ],
      },
      {
        'delivery.email.status': { $in: ['pending', 'retry_scheduled'] },
        $or: [
          { 'delivery.email.next_attempt_at': null },
          { 'delivery.email.next_attempt_at': { $lte: now } },
        ],
      },
    ],
  }).select('_id').sort({ created_at: 1 }).limit(limit).lean();

  const results = await Promise.allSettled(
    notifications.map((notification) => processNotificationDelivery(
      notification._id
    ))
  );
  return {
    processed: results.length,
    failed: results.filter((result) => result.status === 'rejected').length,
  };
};

const retryNotificationDelivery = async (notificationId) => {
  const notification = await Notification.findById(notificationId);
  if (!notification) return null;
  const now = new Date();
  if (notification.delivery.push.status !== 'delivered') {
    notification.delivery.push.status = 'pending';
    notification.delivery.push.next_attempt_at = now;
    notification.delivery.push.last_error = undefined;
  }
  if (notification.delivery.email.status !== 'delivered') {
    notification.delivery.email.status = 'not_required';
    notification.delivery.email.next_attempt_at = undefined;
    notification.delivery.email.last_error = undefined;
  }
  notification.delivery.status = 'pending';
  notification.delivery.fallback_email_triggered = false;
  notification.delivery.completed_at = undefined;
  await notification.save();
  return processNotificationDelivery(notification._id, { force: true });
};

const notifyUser = async ({
  userId,
  title,
  message,
  type = 'info',
  data = {},
  priority = 'normal',
  emailFallback = true,
}) => {
  const notification = await Notification.create({
    user_id: userId,
    title: String(title || '').slice(0, 160),
    message: String(message || '').slice(0, 1000),
    type,
    data,
    priority,
    delivery: {
      status: 'pending',
      email_fallback_enabled: emailFallback,
      push: { status: 'pending', max_attempts: MAX_ATTEMPTS },
      email: { status: 'not_required', max_attempts: MAX_ATTEMPTS },
    },
  });

  setImmediate(() => {
    processNotificationDelivery(notification._id).catch((error) => {
      console.error('Notification delivery error:', error.message);
    });
  });
  return notification;
};

let deliveryTimer;

const startNotificationDeliveryScheduler = () => {
  if (process.env.NODE_ENV === 'test' || deliveryTimer) return;
  const intervalSeconds = positiveInteger(
    process.env.NOTIFICATION_RETRY_INTERVAL_SECONDS,
    30
  );
  const run = () => processDueNotifications().catch((error) => {
    console.error('Notification retry worker error:', error.message);
  });
  const initialTimer = setTimeout(run, 5_000);
  initialTimer.unref();
  deliveryTimer = setInterval(run, intervalSeconds * 1000);
  deliveryTimer.unref();
};

module.exports = {
  notifyUser,
  processDueNotifications,
  processNotificationDelivery,
  retryNotificationDelivery,
  startNotificationDeliveryScheduler,
  _internals: {
    getRetryDate,
    MAX_ATTEMPTS,
    refreshOverallStatus,
  },
};
