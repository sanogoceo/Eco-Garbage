const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const {
  retryNotificationDelivery,
} = require('../services/notificationService');

const DELIVERY_STATUSES = ['pending', 'retry_scheduled', 'delivered', 'failed'];

const serializeChannel = (channel = {}) => ({
  status: channel.status,
  attempts: channel.attempts || 0,
  max_attempts: channel.max_attempts || 0,
  next_attempt_at: channel.next_attempt_at,
  last_attempt_at: channel.last_attempt_at,
  delivered_at: channel.delivered_at,
  last_error: channel.last_error,
  sent_count: channel.sent_count || 0,
  failed_count: channel.failed_count || 0,
});

const listNotificationDeliveries = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const status = String(req.query.status || '').trim();
    const channel = String(req.query.channel || '').trim();
    const search = String(req.query.search || '').trim().slice(0, 100);
    const filter = {};
    if (status) {
      if (!DELIVERY_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: 'Statut de livraison invalide' });
      }
      filter['delivery.status'] = status;
    }
    if (channel) {
      if (!['push', 'email'].includes(channel)) {
        return res.status(400).json({ success: false, message: 'Canal invalide' });
      }
      filter[`delivery.${channel}.status`] = { $nin: ['not_required'] };
    }
    if (search) {
      const userIds = await mongoose.model('User').find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ],
      }).distinct('_id');
      filter.$or = [
        { user_id: { $in: userIds } },
        { title: { $regex: search, $options: 'i' } },
        { message: { $regex: search, $options: 'i' } },
      ];
    }

    const [notifications, total, summaryRows] = await Promise.all([
      Notification.find(filter)
        .populate('user_id', 'name email role')
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
      Notification.aggregate([
        {
          $group: {
            _id: '$delivery.status',
            count: { $sum: 1 },
          },
        },
      ]),
    ]);
    const summary = {
      pending: 0,
      retry_scheduled: 0,
      delivered: 0,
      failed: 0,
    };
    summaryRows.forEach((row) => {
      if (Object.hasOwn(summary, row._id)) summary[row._id] = row.count;
    });
    res.json({
      success: true,
      data: notifications.map((notification) => ({
        id: notification._id.toString(),
        title: notification.title,
        message: notification.message,
        type: notification.type,
        priority: notification.priority,
        created_at: notification.created_at,
        user: notification.user_id
          ? {
              id: notification.user_id._id.toString(),
              name: notification.user_id.name,
              email: notification.user_id.email,
              role: notification.user_id.role,
            }
          : null,
        delivery: {
          status: notification.delivery?.status || 'pending',
          fallback_email_triggered: Boolean(
            notification.delivery?.fallback_email_triggered
          ),
          completed_at: notification.delivery?.completed_at,
          push: serializeChannel(notification.delivery?.push),
          email: serializeChannel(notification.delivery?.email),
        },
      })),
      pagination: {
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      summary,
    });
  } catch (error) {
    console.error('listNotificationDeliveries error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const retryDelivery = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Notification invalide' });
    }
    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification introuvable' });
    }
    await AuditLog.create({
      actor_id: req.user.id,
      action: 'notification.delivery_retried',
      target_type: 'Notification',
      target_id: notification._id,
      metadata: {
        previous_status: notification.delivery?.status,
        recipient_id: notification.user_id?.toString(),
      },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    const updated = await retryNotificationDelivery(notification._id);
    res.json({
      success: true,
      message: 'Nouvelle tentative executee',
      data: {
        status: updated?.delivery?.status,
        push_status: updated?.delivery?.push?.status,
        email_status: updated?.delivery?.email?.status,
      },
    });
  } catch (error) {
    console.error('retryDelivery error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = { listNotificationDeliveries, retryDelivery };
