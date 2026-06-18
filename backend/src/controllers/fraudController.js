const mongoose = require('mongoose');
const FraudAlert = require('../models/FraudAlert');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');

const CATEGORIES = [
  'fake_collector',
  'otp_abuse',
  'suspicious_payment',
  'suspicious_refund',
  'multiple_accounts',
];
const STATUSES = ['open', 'investigating', 'resolved', 'dismissed'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const serializeAlert = (alert) => ({
  id: alert._id.toString(),
  uuid: alert.uuid,
  category: alert.category,
  severity: alert.severity,
  risk_score: alert.risk_score,
  status: alert.status,
  title: alert.title,
  description: alert.description,
  signals: alert.signals,
  subject_user: alert.subject_user_id
    ? {
        id: alert.subject_user_id._id?.toString(),
        name: alert.subject_user_id.name,
        email: alert.subject_user_id.email,
        phone: alert.subject_user_id.phone,
        role: alert.subject_user_id.role,
        is_active: alert.subject_user_id.is_active,
      }
    : null,
  related_users: (alert.related_user_ids || []).map((user) => ({
    id: user._id?.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  })),
  collector_application_uuid: alert.collector_application_id?.uuid,
  pickup_request_uuid: alert.pickup_request_id?.uuid,
  payment_uuid: alert.payment_id?.uuid,
  occurrences: alert.occurrences,
  first_detected_at: alert.first_detected_at,
  last_detected_at: alert.last_detected_at,
  assigned_to: alert.assigned_to
    ? {
        id: alert.assigned_to._id?.toString(),
        name: alert.assigned_to.name,
        email: alert.assigned_to.email,
      }
    : null,
  resolution_notes: alert.resolution_notes,
  resolved_at: alert.resolved_at,
});

const listFraudAlerts = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const filter = {};
    if (req.query.category) {
      if (!CATEGORIES.includes(req.query.category)) {
        return res.status(400).json({ success: false, message: 'Categorie invalide' });
      }
      filter.category = req.query.category;
    }
    if (req.query.status) {
      if (!STATUSES.includes(req.query.status)) {
        return res.status(400).json({ success: false, message: 'Statut invalide' });
      }
      filter.status = req.query.status;
    }
    if (req.query.severity) {
      if (!SEVERITIES.includes(req.query.severity)) {
        return res.status(400).json({ success: false, message: 'Severite invalide' });
      }
      filter.severity = req.query.severity;
    }
    if (req.query.search) {
      const escaped = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const expression = new RegExp(escaped, 'i');
      const users = await User.find({
        $or: [{ name: expression }, { email: expression }, { phone: expression }],
      }).select('_id').limit(100).lean();
      filter.$or = [
        { title: expression },
        { description: expression },
        { subject_user_id: { $in: users.map((user) => user._id) } },
      ];
    }

    const [alerts, total, grouped] = await Promise.all([
      FraudAlert.find(filter)
        .populate('subject_user_id', 'name email phone role is_active')
        .populate('related_user_ids', 'name email role')
        .populate('collector_application_id', 'uuid')
        .populate('pickup_request_id', 'uuid')
        .populate('payment_id', 'uuid')
        .populate('assigned_to', 'name email')
        .sort({ risk_score: -1, last_detected_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      FraudAlert.countDocuments(filter),
      FraudAlert.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            open: {
              $sum: { $cond: [{ $in: ['$status', ['open', 'investigating']] }, 1, 0] },
            },
            critical: {
              $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] },
            },
            high: { $sum: { $cond: [{ $eq: ['$severity', 'high'] }, 1, 0] } },
            resolved: {
              $sum: { $cond: [{ $in: ['$status', ['resolved', 'dismissed']] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    res.json({
      success: true,
      data: alerts.map(serializeAlert),
      summary: grouped[0] || { open: 0, critical: 0, high: 0, resolved: 0 },
      pagination: {
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error('listFraudAlerts error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const updateFraudAlert = async (req, res) => {
  try {
    const status = String(req.body.status || '');
    const notes = String(req.body.notes || '').trim();
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Statut invalide' });
    }
    if (['resolved', 'dismissed'].includes(status) && notes.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Une justification de cinq caracteres minimum est requise',
      });
    }
    const alert = await FraudAlert.findOneAndUpdate(
      { uuid: req.params.uuid },
      {
        $set: {
          status,
          assigned_to: req.user.id,
          resolution_notes: notes || undefined,
          resolved_at: ['resolved', 'dismissed'].includes(status) ? new Date() : null,
        },
      },
      { new: true, runValidators: true }
    );
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alerte introuvable' });
    }
    await AuditLog.create({
      actor_id: req.user.id,
      action: 'fraud_alert.reviewed',
      target_type: 'FraudAlert',
      target_id: alert._id,
      metadata: { alert_uuid: alert.uuid, status, notes },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    res.json({ success: true, message: 'Alerte antifraude mise a jour' });
  } catch (error) {
    console.error('updateFraudAlert error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = { listFraudAlerts, updateFraudAlert };
