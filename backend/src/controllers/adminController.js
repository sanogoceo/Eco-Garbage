const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { randomUUID: uuidv4 } = require('crypto');
const User = require('../models/User');
const PickupRequest = require('../models/PickupRequest');
const Payment = require('../models/Payment');
const Complaint = require('../models/Complaint');
const Rating = require('../models/Rating');
const WasteCategory = require('../models/WasteCategory');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const FraudAlert = require('../models/FraudAlert');
const CollectorApplication = require('../models/CollectorApplication');
const ServiceConfiguration = require('../models/ServiceConfiguration');
const { collectorProfilePhotoDir } = require('../config/storage');
const { deleteStoredFile } = require('../utils/secureFileStorage');
const { decrypt } = require('../utils/sensitiveData');
const { invalidateCategoriesCache } = require('./miscController');
const { notifyUser } = require('../services/notificationService');
const {
  listServiceConfigurations,
} = require('../services/serviceConfigurationService');
const { SERVICE_TYPES } = require('../utils/serviceTypes');

const CM_PHONE_REGEX = /^(\+?237)?[62]\d{8}$/;
const AUDIT_ACTIONS = [
  'collector_application.approved',
  'collector_application.rejected',
  'collector_application.document_viewed',
  'collector_application.document_replacement_requested',
  'collector_application.document_replacement_completed',
  'payment.refund_requested',
  'pickup_request.proof_viewed',
  'complaint.evidence_viewed',
  'complaint.decision_recorded',
  'notification.delivery_retried',
  'sensitive_data.retention_deleted',
  'fraud_alert.reviewed',
  'admin_security.unusual_login',
  'admin_security.two_factor_enabled',
  'admin_security.two_factor_disabled',
  'admin_security.session_revoked',
  'admin_security.step_up_granted',
  'admin_security.user_status_changed',
  'service_configuration.updated',
  'collector.hazardous_certification_updated',
  'business_contract.approved',
  'business_contract.rejected',
  'business_contract.suspended',
  'business_contract.site_approved',
  'business_contract.site_rejected',
  'business_contract.site_suspended',
  'business_contract.terms_updated',
  'business_contract.invoice_generated',
  'business_contract.invoice_issued',
  'business_contract.invoice_paid',
  'business_contract.invoice_overdue',
  'business_contract.invoice_cancelled',
];

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sanitizeAuditMetadata = (action, metadata = {}) => {
  if (action.startsWith('collector_application.')) {
    return {
      applicant_id: metadata.applicant_id,
      document_type: metadata.document_type,
      document_types: metadata.document_types,
      notes: metadata.notes,
    };
  }
  if (action === 'payment.refund_requested') {
    return {
      payment_uuid: metadata.payment_uuid,
      refund_uuid: metadata.refund_uuid,
      amount: metadata.amount,
    };
  }
  if (action === 'pickup_request.proof_viewed') {
    return {
      proof_id: metadata.proof_id,
      proof_type: metadata.proof_type,
    };
  }
  if (action === 'complaint.evidence_viewed') {
    return {
      complaint_uuid: metadata.complaint_uuid,
      evidence_id: metadata.evidence_id,
    };
  }
  if (action === 'complaint.decision_recorded') {
    return {
      complaint_uuid: metadata.complaint_uuid,
      outcome: metadata.outcome,
      status: metadata.status,
      compensation_amount: metadata.compensation_amount,
    };
  }
  if (action === 'notification.delivery_retried') {
    return {
      previous_status: metadata.previous_status,
      recipient_id: metadata.recipient_id,
    };
  }
  if (action === 'sensitive_data.retention_deleted') {
    return {
      reason: metadata.reason,
      deleted_document_types: metadata.deleted_document_types,
      deleted_proof_count: metadata.deleted_proof_count,
      deleted_evidence_count: metadata.deleted_evidence_count,
    };
  }
  if (action === 'fraud_alert.reviewed') {
    return {
      alert_uuid: metadata.alert_uuid,
      status: metadata.status,
      notes: metadata.notes,
    };
  }
  if (action.startsWith('admin_security.')) {
    return {
      session_uuid: metadata.session_uuid,
      device_name: metadata.device_name,
      platform: metadata.platform,
      scope: metadata.scope,
      target_user_id: metadata.target_user_id,
      is_active: metadata.is_active,
      method: metadata.method,
    };
  }
  if (action === 'service_configuration.updated') {
    return {
      service_type: metadata.service_type,
      price_multiplier: metadata.price_multiplier,
      fixed_fee: metadata.fixed_fee,
      max_requests_per_slot: metadata.max_requests_per_slot,
    };
  }
  if (action === 'collector.hazardous_certification_updated') {
    return {
      collector_id: metadata.collector_id,
      status: metadata.status,
      expires_at: metadata.expires_at,
    };
  }
  if (action.startsWith('business_contract.')) {
    return {
      contract_uuid: metadata.contract_uuid,
      company_name: metadata.company_name,
      decision: metadata.decision,
      notes: metadata.notes,
      site_id: metadata.site_id,
      site_name: metadata.site_name,
      invoice_number: metadata.invoice_number,
      month: metadata.month,
      amount: metadata.amount,
      status: metadata.status,
      credit_limit: metadata.credit_limit,
      payment_terms_days: metadata.payment_terms_days,
      negotiated_pricing: metadata.negotiated_pricing,
    };
  }
  return {};
};

const getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const filter = { action: { $in: AUDIT_ACTIONS } };
    const action = String(req.query.action || '').trim();
    const actorType = String(req.query.actor_type || '').trim();
    const search = String(req.query.search || '').trim().slice(0, 100);

    if (action) {
      if (!AUDIT_ACTIONS.includes(action)) {
        return res.status(400).json({ success: false, message: 'Action d audit invalide' });
      }
      filter.action = action;
    }
    if (actorType) {
      if (!['user', 'system'].includes(actorType)) {
        return res.status(400).json({ success: false, message: 'Type d acteur invalide' });
      }
      filter.actor_type = actorType;
    }

    const createdAt = {};
    if (req.query.from) {
      const from = new Date(req.query.from);
      if (Number.isNaN(from.getTime())) {
        return res.status(400).json({ success: false, message: 'Date de debut invalide' });
      }
      createdAt.$gte = from;
    }
    if (req.query.to) {
      const to = new Date(req.query.to);
      if (Number.isNaN(to.getTime())) {
        return res.status(400).json({ success: false, message: 'Date de fin invalide' });
      }
      to.setHours(23, 59, 59, 999);
      createdAt.$lte = to;
    }
    if (Object.keys(createdAt).length) filter.created_at = createdAt;

    if (search) {
      const expression = new RegExp(escapeRegex(search), 'i');
      const matchingActors = await User.find({
        $or: [{ name: expression }, { email: expression }],
      }).select('_id').limit(100).lean();
      filter.$or = [
        { actor_id: { $in: matchingActors.map((actor) => actor._id) } },
        { action: expression },
        { target_type: expression },
        { 'metadata.payment_uuid': expression },
      ];
    }

    const [logs, total, grouped] = await Promise.all([
      AuditLog.find(filter)
        .populate('actor_id', 'name email role')
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
      AuditLog.aggregate([
        { $match: filter },
        { $group: { _id: '$action', count: { $sum: 1 } } },
      ]),
    ]);

    const summary = Object.fromEntries(AUDIT_ACTIONS.map((item) => [item, 0]));
    grouped.forEach((item) => {
      summary[item._id] = item.count;
    });

    res.json({
      success: true,
      data: logs.map((log) => ({
        id: log._id.toString(),
        action: log.action,
        actor_type: log.actor_type,
        actor: log.actor_id
          ? {
              id: log.actor_id._id?.toString(),
              name: log.actor_id.name,
              email: log.actor_id.email,
              role: log.actor_id.role,
            }
          : null,
        target_type: log.target_type,
        target_id: log.target_id?.toString(),
        metadata: sanitizeAuditMetadata(log.action, log.metadata),
        ip: log.ip,
        created_at: log.created_at,
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
    console.error('getAuditLogs error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const staleLocationSince = new Date(now.getTime() - 15 * 60 * 1000);
    const delayedImmediateSince = new Date(now.getTime() - 60 * 60 * 1000);
    const activeStatuses = ['assigned', 'on_way', 'in_progress'];
    const delayedFilter = {
      status: { $nin: ['completed', 'cancelled', 'failed'] },
      $or: [
        { scheduled_at: { $lt: now } },
        {
          service_type: 'immediate',
          status: { $in: ['pending', 'approved'] },
          created_at: { $lt: delayedImmediateSince },
        },
      ],
    };

    const [
      users, collectors, totalReq, completedReq, pendingReq, openComplaints,
      activeReq, delayedReq, unassignedReq, availableCollectors, staleCollectors,
      failedNotifications,
      openFraudAlerts,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'collector' }),
      PickupRequest.countDocuments(),
      PickupRequest.countDocuments({ status: 'completed' }),
      PickupRequest.countDocuments({ status: 'pending' }),
      Complaint.countDocuments({ status: 'open' }),
      PickupRequest.countDocuments({ status: { $in: activeStatuses } }),
      PickupRequest.countDocuments(delayedFilter),
      PickupRequest.countDocuments({
        status: { $in: ['pending', 'approved'] },
        collector_id: null,
      }),
      User.countDocuments({
        role: 'collector',
        is_active: true,
        'collector_profile.is_available': true,
      }),
      User.countDocuments({
        role: 'collector',
        is_active: true,
        'collector_profile.is_available': true,
        $or: [
          { 'collector_profile.last_location_update': { $lt: staleLocationSince } },
          { 'collector_profile.last_location_update': null },
        ],
      }),
      Notification.countDocuments({ 'delivery.status': 'failed' }),
      FraudAlert.countDocuments({
        status: { $in: ['open', 'investigating'] },
        severity: { $in: ['high', 'critical'] },
      }),
    ]);

    const [
      revenueResult,
      pendingRevenueResult,
      statusBreakdown,
      completionDuration,
    ] = await Promise.all([
      Payment.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Payment.aggregate([
        { $match: { status: { $in: ['pending', 'processing'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      PickupRequest.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } },
        { $sort: { count: -1 } },
      ]),
      PickupRequest.aggregate([
        { $match: { status: 'completed', collected_at: { $type: 'date' } } },
        {
          $group: {
            _id: null,
            averageMs: { $avg: { $subtract: ['$collected_at', '$created_at'] } },
          },
        },
      ]),
    ]);
    const revenue = revenueResult[0]?.total || 0;
    const pendingRevenue = pendingRevenueResult[0]?.total || 0;
    const totalRevenue = revenue + pendingRevenue;

    const rawRecent = await PickupRequest.find()
      .populate('user_id', 'name')
      .populate('category_id', 'name')
      .sort({ created_at: -1 })
      .limit(8)
      .lean();
    const recentRequests = rawRecent.map(r => ({
      uuid: r.uuid, status: r.status, service_type: r.service_type,
      estimated_price: r.estimated_price, created_at: r.created_at,
      user_name: r.user_id?.name, category_name: r.category_id?.name,
    }));

    const rawCollectors = await User.find({ role: 'collector' })
      .select('name collector_profile')
      .sort({ 'collector_profile.total_collections': -1 })
      .limit(5).lean();
    const topCollectors = rawCollectors.map(c => ({
      name: c.name,
      total_collections: c.collector_profile?.total_collections || 0,
      rating_avg: c.collector_profile?.rating_avg || 0,
    }));

    const rawActiveOperations = await PickupRequest.find({
      status: { $in: [...activeStatuses, 'pending', 'approved'] },
    })
      .populate('user_id', 'name')
      .populate('collector_id', 'name collector_profile.last_location_update')
      .populate('category_id', 'name')
      .sort({ created_at: 1 })
      .limit(12)
      .lean();
    const activeOperations = rawActiveOperations.map((row) => ({
      uuid: row.uuid,
      status: row.status,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      eta_minutes: row.eta_minutes,
      scheduled_at: row.scheduled_at,
      created_at: row.created_at,
      user_name: row.user_id?.name,
      collector_name: row.collector_id?.name,
      category_name: row.category_id?.name,
      last_location_update: row.collector_id?.collector_profile?.last_location_update,
      delayed: (
        (row.scheduled_at && new Date(row.scheduled_at) < now)
        || (
          row.service_type === 'immediate'
          && ['pending', 'approved'].includes(row.status)
          && new Date(row.created_at) < delayedImmediateSince
        )
      ),
    }));

    const operationalAlerts = [
      delayedReq > 0 && {
        level: 'critical',
        label: `${delayedReq} collecte(s) en retard`,
        target: '/admin/requests',
      },
      unassignedReq > 0 && {
        level: 'warning',
        label: `${unassignedReq} demande(s) sans collecteur`,
        target: '/admin/requests',
      },
      staleCollectors > 0 && {
        level: 'warning',
        label: `${staleCollectors} collecteur(s) disponible(s) sans GPS récent`,
        target: '/admin/users',
      },
      openComplaints > 0 && {
        level: 'info',
        label: `${openComplaints} réclamation(s) ouverte(s)`,
        target: '/admin/complaints',
      },
      failedNotifications > 0 && {
        level: 'critical',
        label: `${failedNotifications} notification(s) non livree(s)`,
        target: '/admin/notification-deliveries',
      },
      openFraudAlerts > 0 && {
        level: 'critical',
        label: `${openFraudAlerts} alerte(s) antifraude prioritaire(s)`,
        target: '/admin/fraud-alerts',
      },
    ].filter(Boolean);

    res.json({
      success: true,
      data: {
        stats: {
          users,
          collectors,
          totalRequests: totalReq,
          completedRequests: completedReq,
          pendingRequests: pendingReq,
          activeRequests: activeReq,
          delayedRequests: delayedReq,
          unassignedRequests: unassignedReq,
          availableCollectors,
          staleCollectors,
          failedNotifications,
          openFraudAlerts,
          averageCompletionMinutes: Math.round((completionDuration[0]?.averageMs || 0) / 60000),
          revenue: totalRevenue,
          paidRevenue: revenue,
          pendingRevenue,
          openComplaints,
        },
        recentRequests,
        topCollectors,
        statusBreakdown,
        activeOperations,
        operationalAlerts,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const getUsers = async (req, res) => {
  try {
    const { role, page = 1, limit = 15, search } = req.query;
    const filter = {};
    if (role) {
      filter.role = role;
    }
    if (search) {
      const safe = escapeRegex(search);
      filter.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { email: { $regex: safe, $options: 'i' } },
      ];
    }
    const [rows, total] = await Promise.all([
      User.find(filter).select(
        '-password_hash -email_verification_token -email_verification_expires '
        + '-password_reset_token -password_reset_expires '
        + '-collector_profile.national_id_number -collector_profile.id_front_url '
        + '-collector_profile.id_back_url -collector_profile.selfie_url '
        + '-collector_profile.selfie_video_url -collector_profile.verification_notes '
        + '-collector_profile.profile_photo'
      ).sort({ created_at: -1 })
        .skip((page - 1) * parseInt(limit)).limit(parseInt(limit)).lean(),
      User.countDocuments(filter),
    ]);
    const users = rows.map(u => ({ ...u, id: u._id.toString() }));
    res.json({ success: true, data: users, pagination: { total, page: parseInt(page) } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const toggleUserStatus = async (req, res) => {
  try {
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean')
      return res.status(400).json({ success: false, message: 'Valeur is_active invalide' });
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ success: false, message: 'ID utilisateur invalide' });
    const updated = await User.findByIdAndUpdate(req.params.id, { $set: { is_active } });
    if (!updated)
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    await AuditLog.create({
      actor_id: req.user.id,
      action: 'admin_security.user_status_changed',
      target_type: 'User',
      target_id: updated._id,
      metadata: { target_user_id: updated._id, is_active },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    res.json({ success: true, message: is_active ? 'Compte activé' : 'Compte suspendu' });
  } catch (err) {
    console.error('toggleUserStatus error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const getComplaints = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const [raw, total] = await Promise.all([
      Complaint.find(filter)
        .populate('user_id', 'name email')
        .populate('request_id', 'uuid')
        .sort({ created_at: -1 })
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit))
        .lean(),
      Complaint.countDocuments(filter),
    ]);
    const rows = raw.map(c => ({
      ...c, id: c._id.toString(),
      user_name: c.user_id?.name, user_email: c.user_id?.email,
      request_uuid: c.request_id?.uuid,
      user_id: c.user_id?._id?.toString(), request_id: c.request_id?._id?.toString(),
    }));
    res.json({ success: true, data: rows, pagination: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const respondComplaint = async (req, res) => {
  try {
    const { status, admin_response } = req.body;
    const updated = await Complaint.findOneAndUpdate(
      { uuid: req.params.uuid },
      { $set: { status, admin_response } }
    );
    if (!updated)
      return res.status(404).json({ success: false, message: 'Réclamation non trouvée' });
    res.json({ success: true, message: 'Reclamation mise a jour' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const getReports = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const days = period === 'week' ? 7 : period === 'year' ? 365 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [byCategory, byStatus, dailyRevenue] = await Promise.all([
      PickupRequest.aggregate([
        { $match: { created_at: { $gte: since }, status: 'completed' } },
        { $lookup: { from: 'wastecategories', localField: 'category_id', foreignField: '_id', as: 'category' } },
        { $unwind: '$category' },
        { $group: { _id: '$category._id', name: { $first: '$category.name' }, count: { $sum: 1 }, revenue: { $sum: '$estimated_price' } } },
        { $project: { _id: 0, name: 1, count: 1, revenue: 1 } },
      ]),
      PickupRequest.aggregate([
        { $match: { created_at: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } },
      ]),
      Payment.aggregate([
        { $match: { status: 'completed', paid_at: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paid_at' } }, amount: { $sum: '$amount' } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', amount: 1 } },
      ]),
    ]);

    res.json({ success: true, data: { byCategory, byStatus, dailyRevenue } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const getCategories = async (req, res) => {
  try {
    const rows = await WasteCategory.find().sort({ name: 1 }).lean();
    const data = rows.map(c => ({ ...c, id: c._id.toString() }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const createCategory = async (req, res) => {
  try {
    const { name, description, icon, base_price, is_hazardous, is_recyclable } = req.body;
    const normalizedName = String(name || '').trim();
    const price = Number(base_price);
    if (normalizedName.length < 2 || normalizedName.length > 80) {
      return res.status(400).json({ success: false, message: 'Nom de categorie invalide' });
    }
    if (!Number.isFinite(price) || price < 100 || price > 1_000_000) {
      return res.status(400).json({ success: false, message: 'Prix de base invalide' });
    }
    await WasteCategory.create({
      name: normalizedName,
      description: String(description || '').trim(),
      icon: String(icon || 'trash').trim(),
      base_price: price,
      is_hazardous: Boolean(is_hazardous),
      is_recyclable: Boolean(is_recyclable),
    });
    invalidateCategoriesCache();
    res.status(201).json({ success: true, message: 'Categorie creee' });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Cette categorie existe deja' });
    }
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const updateCategory = async (req, res) => {
  try {
    const { name, description, icon, base_price, is_hazardous, is_recyclable, is_active } = req.body;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Categorie invalide' });
    }
    const normalizedName = String(name || '').trim();
    const price = Number(base_price);
    if (normalizedName.length < 2 || normalizedName.length > 80) {
      return res.status(400).json({ success: false, message: 'Nom de categorie invalide' });
    }
    if (!Number.isFinite(price) || price < 100 || price > 1_000_000) {
      return res.status(400).json({ success: false, message: 'Prix de base invalide' });
    }
    const category = await WasteCategory.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          name: normalizedName,
          description: String(description || '').trim(),
          icon: String(icon || 'trash').trim(),
          base_price: price,
          is_hazardous: Boolean(is_hazardous),
          is_recyclable: Boolean(is_recyclable),
          is_active: Boolean(is_active),
        },
      },
      { new: true, runValidators: true }
    );
    if (!category) {
      return res.status(404).json({ success: false, message: 'Categorie introuvable' });
    }
    invalidateCategoriesCache();
    res.json({ success: true, message: 'Categorie mise a jour' });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Cette categorie existe deja' });
    }
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getServiceConfigurations = async (req, res) => {
  try {
    const rows = await listServiceConfigurations();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const updateServiceConfiguration = async (req, res) => {
  try {
    const serviceType = String(req.params.serviceType || '');
    if (!SERVICE_TYPES.includes(serviceType)) {
      return res.status(400).json({ success: false, message: 'Type de service invalide' });
    }
    const priceMultiplier = Number(req.body.price_multiplier);
    const fixedFee = Number(req.body.fixed_fee);
    const slotDuration = Number(req.body.slot_duration_minutes);
    const maxCapacity = Number(req.body.max_requests_per_slot);
    const zonePricing = Array.isArray(req.body.zone_pricing)
      ? req.body.zone_pricing.slice(0, 100).map((zone) => ({
          city: String(zone.city || '').trim().slice(0, 100),
          district: String(zone.district || '').trim().slice(0, 120),
          price_multiplier: Number(zone.price_multiplier),
          fixed_fee: Number(zone.fixed_fee),
        }))
      : [];
    const weeklySchedule = Array.isArray(req.body.weekly_schedule)
      ? req.body.weekly_schedule.slice(0, 7).map((day) => ({
          day_of_week: Number(day.day_of_week),
          is_open: day.is_open !== false,
          opening_time: String(day.opening_time || '07:00'),
          closing_time: String(day.closing_time || '19:00'),
          capacity_override: day.capacity_override
            ? Number(day.capacity_override)
            : undefined,
        }))
      : [];
    const blackoutDates = Array.isArray(req.body.blackout_dates)
      ? [...new Set(req.body.blackout_dates
          .map((date) => String(date || '').trim())
          .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        )].slice(0, 365)
      : [];
    if (
      !Number.isFinite(priceMultiplier) || priceMultiplier < 0.1 || priceMultiplier > 10
      || !Number.isFinite(fixedFee) || fixedFee < 0 || fixedFee > 1_000_000
      || !Number.isInteger(slotDuration) || slotDuration < 15 || slotDuration > 240
      || !Number.isInteger(maxCapacity) || maxCapacity < 1 || maxCapacity > 500
      || zonePricing.some((zone) => (
        !zone.city
        || !Number.isFinite(zone.price_multiplier)
        || zone.price_multiplier < 0.1 || zone.price_multiplier > 10
        || !Number.isFinite(zone.fixed_fee)
        || zone.fixed_fee < 0 || zone.fixed_fee > 1_000_000
      ))
      || weeklySchedule.some((day) => (
        !Number.isInteger(day.day_of_week)
        || day.day_of_week < 0 || day.day_of_week > 6
        || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(day.opening_time)
        || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(day.closing_time)
        || (
          day.capacity_override !== undefined
          && (
            !Number.isInteger(day.capacity_override)
            || day.capacity_override < 1 || day.capacity_override > 500
          )
        )
      ))
    ) {
      return res.status(400).json({
        success: false,
        message: 'Configuration tarifaire ou capacite invalide',
      });
    }
    const configuration = await ServiceConfiguration.findOneAndUpdate(
      { service_type: serviceType },
      {
        $set: {
          price_multiplier: priceMultiplier,
          fixed_fee: fixedFee,
          slot_duration_minutes: slotDuration,
          max_requests_per_slot: maxCapacity,
          zone_pricing: zonePricing,
          weekly_schedule: weeklySchedule,
          blackout_dates: blackoutDates,
          is_active: req.body.is_active !== false,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    await AuditLog.create({
      actor_id: req.user.id,
      action: 'service_configuration.updated',
      target_type: 'ServiceConfiguration',
      target_id: configuration._id,
      metadata: {
        service_type: serviceType,
        price_multiplier: priceMultiplier,
        fixed_fee: fixedFee,
        max_requests_per_slot: maxCapacity,
      },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    res.json({
      success: true,
      message: 'Configuration du service mise a jour',
      data: configuration,
    });
  } catch (error) {
    console.error('updateServiceConfiguration error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const updateHazardousCertification = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'ID collecteur invalide' });
    }
    const status = String(req.body.status || '');
    if (!['none', 'pending', 'verified', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Statut de certification invalide' });
    }
    const certificateNumber = String(req.body.certificate_number || '').trim();
    const issuedAt = req.body.issued_at ? new Date(req.body.issued_at) : null;
    const expiresAt = req.body.expires_at ? new Date(req.body.expires_at) : null;
    if (
      status === 'verified'
      && (
        certificateNumber.length < 3
        || !issuedAt || Number.isNaN(issuedAt.getTime())
        || !expiresAt || Number.isNaN(expiresAt.getTime())
        || expiresAt <= new Date()
        || issuedAt > new Date()
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Numero et dates valides requis pour certifier le collecteur',
      });
    }
    const collector = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'collector' },
      {
        $set: {
          'collector_profile.hazardous_certification': {
            status,
            certificate_number: status === 'verified' ? certificateNumber : undefined,
            issued_at: status === 'verified' ? issuedAt : undefined,
            expires_at: status === 'verified' ? expiresAt : undefined,
            verified_by: req.user.id,
            verified_at: new Date(),
            notes: String(req.body.notes || '').trim().slice(0, 500),
          },
        },
      },
      { new: true, runValidators: true }
    );
    if (!collector) {
      return res.status(404).json({ success: false, message: 'Collecteur introuvable' });
    }
    await Promise.allSettled([
      notifyUser({
        userId: collector._id,
        title: status === 'verified'
          ? 'Certification dechets dangereux validee'
          : 'Certification dechets dangereux mise a jour',
        message: status === 'verified'
          ? 'Vous pouvez maintenant recevoir les missions dangereuses compatibles.'
          : `Statut de certification: ${status}.`,
        type: 'collector_application',
        data: { target_path: '/collector/profile' },
      }),
      AuditLog.create({
        actor_id: req.user.id,
        action: 'collector.hazardous_certification_updated',
        target_type: 'User',
        target_id: collector._id,
        metadata: {
          collector_id: collector._id,
          status,
          expires_at: expiresAt,
        },
        ip: req.ip,
        user_agent: req.get('user-agent'),
      }),
    ]);
    res.json({
      success: true,
      message: 'Certification du collecteur mise a jour',
      data: collector.collector_profile.hazardous_certification,
    });
  } catch (error) {
    console.error('updateHazardousCertification error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const createUser = async (req, res) => {
  try {
    const { name, email, phone, role, password } = req.body;
    if (!name || !email || !password || !role)
      return res.status(400).json({ success: false, message: 'Nom, email, mot de passe et rôle requis' });
    if (!['user', 'admin'].includes(role))
      return res.status(400).json({ success: false, message: 'Rôle invalide' });
    if (phone) {
      const cleaned = phone.replace(/[\s\-().]/g, '');
      if (!CM_PHONE_REGEX.test(cleaned))
        return res.status(400).json({ success: false, message: 'Numero de telephone camerounais invalide' });
    }
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing)
      return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé' });
    const password_hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      uuid: uuidv4(),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone || undefined,
      password_hash,
      role,
      is_verified: true,
      is_active: true,
    });
    res.status(201).json({ success: true, message: 'Utilisateur créé', data: { id: user._id.toString() } });
  } catch (err) {
    console.error('createUser error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const deleteUser = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ success: false, message: 'ID utilisateur invalide' });
    const user = await User.findById(req.params.id);
    if (!user)
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    if (user.role === 'admin')
      return res.status(403).json({ success: false, message: 'Impossible de supprimer un administrateur' });

    const activeReqs = await PickupRequest.countDocuments({
      $or: [{ user_id: user._id }, { collector_id: user._id }],
      status: { $in: ['assigned', 'on_way', 'in_progress'] },
    });
    if (activeReqs > 0)
      return res.status(400).json({ success: false, message: 'Cet utilisateur a des collectes en cours. Terminez-les d\'abord.' });
    await User.findByIdAndDelete(req.params.id);
    if (user.collector_profile?.profile_photo?.stored_name) {
      await deleteStoredFile({
        directory: collectorProfilePhotoDir,
        storedName: user.collector_profile.profile_photo.stored_name,
      }).catch((error) => {
        console.error('Collector profile photo deletion error:', error.message);
      });
    }
    res.json({ success: true, message: 'Utilisateur supprimé' });
  } catch (err) {
    console.error('deleteUser error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const getCollectorDetails = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ success: false, message: 'ID collecteur invalide' });
    
    const user = await User.findById(req.params.id).select(
      '-password_hash -email_verification_token -email_verification_expires '
      + '-password_reset_token -password_reset_expires '
      + '-collector_profile.national_id_number -collector_profile.id_front_url '
      + '-collector_profile.id_back_url -collector_profile.selfie_url '
      + '-collector_profile.selfie_video_url -collector_profile.profile_photo'
    ).lean();
    if (!user)
      return res.status(404).json({ success: false, message: 'Collecteur non trouvé' });
    if (user.role !== 'collector')
      return res.status(400).json({ success: false, message: 'Cet utilisateur n\'est pas un collecteur' });
    

    const [totalRequests, completedRequests, ratings, application] = await Promise.all([
      PickupRequest.countDocuments({ collector_id: user._id }),
      PickupRequest.countDocuments({ collector_id: user._id, status: 'completed' }),
      Rating.countDocuments({ collector_id: user._id }),
      CollectorApplication.findOne({
        user_id: user._id,
        status: 'approved',
      })
        .select('+national_id_number')
        .sort({ reviewed_at: -1, created_at: -1 })
        .lean(),
    ]);

    const collectorApplication = application
      ? {
          uuid: application.uuid,
          full_name: application.full_name,
          birth_date: application.birth_date,
          gender: application.gender,
          phone: application.phone,
          national_id_number: decrypt(application.national_id_number),
          national_id_expiry_date: application.national_id_expiry_date,
          application_type: application.application_type || 'initial',
          city: application.city,
          neighborhood: application.neighborhood,
          residence_address: application.residence_address || application.address,
          service_area: application.service_area,
          vehicle_type: application.vehicle_type,
          vehicle_plate: application.vehicle_plate,
          vehicle_details: application.vehicle_details,
          emergency_contact: application.emergency_contact,
          consent: application.consent,
          status: application.status,
          review_notes: application.review_notes,
          submitted_at: application.submitted_at,
          reviewed_at: application.reviewed_at,
          verification_valid_until: application.verification_valid_until,
          identity_verification: application.identity_verification,
          documents_delete_at: application.documents_delete_at,
          documents_deleted_at: application.documents_deleted_at,
          documents: {
            profile_photo: !!application.documents?.profile_photo?.stored_name,
            id_front: !!application.documents?.id_front?.stored_name,
            id_back: !!application.documents?.id_back?.stored_name,
            selfie_with_id: !!application.documents?.selfie_with_id?.stored_name,
            vehicle_photo: !!application.documents?.vehicle_photo?.stored_name,
          },
        }
      : null;

    if (application) {
      await AuditLog.create({
        actor_id: req.user.id,
        action: 'collector_application.document_viewed',
        target_type: 'CollectorApplication',
        target_id: application._id,
        metadata: {
          applicant_id: user._id,
          document_type: 'national_id_number',
        },
        ip: req.ip,
        user_agent: req.get('user-agent'),
      });
    }
    
    res.json({ 
      success: true, 
      data: { 
        ...user, 
        id: user._id.toString(),
        stats: { totalRequests, completedRequests, ratings },
        collector_application: collectorApplication,
      } 
    });
  } catch (err) {
    console.error('getCollectorDetails error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = {
  getDashboard,
  getAuditLogs,
  getUsers,
  toggleUserStatus,
  createUser,
  deleteUser,
  getComplaints,
  respondComplaint,
  getReports,
  getCategories,
  createCategory,
  updateCategory,
  getServiceConfigurations,
  updateServiceConfiguration,
  getCollectorDetails,
  updateHazardousCertification,
};
