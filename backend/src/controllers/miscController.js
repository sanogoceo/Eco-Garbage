const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const PickupRequest = require('../models/PickupRequest');
const Rating = require('../models/Rating');
const Complaint = require('../models/Complaint');
const Payment = require('../models/Payment');
const WasteCategory = require('../models/WasteCategory');
const User = require('../models/User');
const { isVehicleCompatible } = require('../services/assignmentService');
const {
  hasValidHazardousCertification,
  isCollectorVerified,
} = require('../utils/collectorCertification');

const parsePagination = ({ page, limit }) => ({
  page: Math.max(1, Number.parseInt(page, 10) || 1),
  limit: Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 10)),
});



const getNotifications = async (req, res) => {
  try {
    const [rows, unreadCount] = await Promise.all([
      Notification.find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(50).lean({ virtuals: true }),
      Notification.countDocuments({ user_id: req.user.id, is_read: false }),
    ]);
    res.json({ success: true, data: rows, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ user_id: req.user.id }, { $set: { is_read: true } });
    res.json({ success: true, message: 'Notifications marquees comme lues' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};



const createRating = async (req, res) => {
  try {
    const { request_uuid, score, comment } = req.body;
    if (!score || score < 1 || score > 5)
      return res.status(400).json({ success: false, message: 'Note entre 1 et 5 requise' });

    const pickupReq = await PickupRequest.findOne({ uuid: request_uuid, user_id: req.user.id, status: 'completed' });
    if (!pickupReq)
      return res.status(404).json({ success: false, message: 'Demande non trouvee ou non completee' });

    await Rating.findOneAndUpdate(
      { request_id: pickupReq._id },
      { $set: { user_id: req.user.id, collector_id: pickupReq.collector_id, score, comment } },
      { upsert: true }
    );


    const [avgResult] = await Rating.aggregate([
      { $match: { collector_id: pickupReq.collector_id } },
      { $group: { _id: null, avg: { $avg: '$score' } } },
    ]);
    const avg = avgResult?.avg || 0;
    await User.findByIdAndUpdate(pickupReq.collector_id, {
      $set: { 'collector_profile.rating_avg': parseFloat(avg.toFixed(2)) },
    });

    res.json({ success: true, message: 'Note enregistree' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};



const createComplaint = async (req, res) => {
  try {
    const { request_uuid, type, description } = req.body;
    if (!description) return res.status(400).json({ success: false, message: 'Description requise' });

    let request_id;
    if (request_uuid) {
      const r = await PickupRequest.findOne({ uuid: request_uuid });
      if (r) request_id = r._id;
    }

    const uuid = uuidv4();
    await Complaint.create({ uuid, user_id: req.user.id, request_id, type: type || 'other', description });
    res.status(201).json({ success: true, message: 'Reclamation enregistree', data: { uuid } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getMyComplaints = async (req, res) => {
  try {
    const rows = await Complaint.find({ user_id: req.user.id }).sort({ created_at: -1 }).lean({ virtuals: true });
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};



const getPayments = async (req, res) => {
  try {
    const raw = await Payment.find({ user_id: req.user.id })
      .populate({ path: 'request_id', select: 'uuid category_id', populate: { path: 'category_id', select: 'name' } })
      .sort({ created_at: -1 }).lean();
    const rows = raw.map(p => ({
      ...p, id: p._id.toString(),
      request_uuid: p.request_id?.uuid,
      category_name: p.request_id?.category_id?.name,
      request_id: p.request_id?._id?.toString(),
    }));
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const payRequest = async (req, res) => {
  try {
    const { payment_uuid, method } = req.body;
    if (!payment_uuid || !method)
      return res.status(400).json({ success: false, message: 'UUID et méthode de paiement requis' });
    const updated = await Payment.findOneAndUpdate(
      { uuid: payment_uuid, user_id: req.user.id },
      { $set: { status: 'completed', method, paid_at: new Date(), transaction_ref: `TXN-${Date.now()}` } }
    );
    if (!updated)
      return res.status(404).json({ success: false, message: 'Paiement non trouvé' });
    res.json({ success: true, message: 'Paiement enregistre' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};




let _categoriesCache = null;
let _categoriesCachedAt = 0;
const CATEGORIES_TTL_MS = 5 * 60 * 1000; // 5 minutes

const getCategories = async (req, res) => {
  try {
    if (_categoriesCache && Date.now() - _categoriesCachedAt < CATEGORIES_TTL_MS) {
      return res.json({ success: true, data: _categoriesCache });
    }
    const rows = await WasteCategory.find({ is_active: true }).sort({ name: 1 }).lean();
    _categoriesCache = rows.map(c => ({ ...c, id: c._id.toString() }));
    _categoriesCachedAt = Date.now();
    res.json({ success: true, data: _categoriesCache });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};



const getCollectorTasks = async (req, res) => {
  try {
    const { status, archived = 'false' } = req.query;
    const { page, limit } = parsePagination(req.query);
    const filter = { collector_id: req.user.id, is_archived: archived === 'true' };
    if (status) filter.status = status;
    const [raw, total] = await Promise.all([
      PickupRequest.find(filter)
        .populate('user_id', 'name phone')
        .populate('category_id', 'name icon')
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      PickupRequest.countDocuments(filter),
    ]);
    const rows = raw.map(r => ({
      ...r, id: r._id.toString(),
      user_name: r.user_id?.name, user_phone: r.user_id?.phone,
      category_name: r.category_id?.name, category_icon: r.category_id?.icon,
      user_id: r.user_id?._id?.toString(), category_id: r.category_id?._id?.toString(),
    }));
    res.json({ success: true, data: rows, pagination: { total, page, limit } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getAvailableCollectorRequests = async (req, res) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const collector = await User.findById(req.user.id)
      .select('collector_profile.vehicle_type collector_profile.verification_status collector_profile.verification_expires_at collector_profile.hazardous_certification')
      .lean();
    if (!isCollectorVerified(collector)) {
      return res.json({ success: true, data: [], pagination: { total: 0, page, limit } });
    }
    const filter = { status: 'pending', collector_id: null, user_id: { $ne: req.user.id } };
    const [raw, total] = await Promise.all([
      PickupRequest.find(filter)
        .select('uuid status service_type estimated_price quantity_number address_details created_at user_id category_id')
        .populate('user_id', 'name')
        .populate('category_id', 'name icon is_hazardous')
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      PickupRequest.countDocuments(filter),
    ]);

    const rows = raw.map((request) => ({
      uuid: request.uuid,
      status: request.status,
      service_type: request.service_type,
      estimated_price: request.estimated_price,
      created_at: request.created_at,
      address: [request.address_details?.district, request.address_details?.city]
        .filter(Boolean)
        .join(', ') || 'Adresse communiquee apres acceptation',
      user_name: request.user_id?.name?.trim().split(/\s+/)[0],
      category_name: request.category_id?.name,
      category_icon: request.category_id?.icon,
      vehicle_compatible: isVehicleCompatible({
        vehicleType: collector.collector_profile?.vehicle_type || 'foot',
        quantity: request.quantity_number,
        serviceType: request.service_type,
        isHazardous: Boolean(request.category_id?.is_hazardous),
        hazardousCertified: hasValidHazardousCertification(collector),
      }),
    }));

    res.json({ success: true, data: rows, pagination: { total, page, limit } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const updateCollectorAvailability = async (req, res) => {
  try {
    const { is_available } = req.body;
    await User.findByIdAndUpdate(req.user.id, { $set: { 'collector_profile.is_available': is_available } });
    res.json({ success: true, message: is_available ? 'Vous etes maintenant disponible' : 'Vous etes maintenant indisponible' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const updateCollectorLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number')
      return res.status(400).json({ success: false, message: 'Coordonnées doivent être des nombres' });
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
      return res.status(400).json({ success: false, message: 'Coordonnees invalides' });

    await User.findByIdAndUpdate(req.user.id, {
      $set: {
        'collector_profile.location': { type: 'Point', coordinates: [longitude, latitude] },
        'collector_profile.last_location_update': new Date(),
      },
    });
    res.json({ success: true, message: 'Position mise a jour' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getCollectorStats = async (req, res) => {
  try {
    const collectorOid = new mongoose.Types.ObjectId(req.user.id);


    const [user, completed, earningsResult] = await Promise.all([
      User.findById(req.user.id).select('collector_profile').lean(),
      PickupRequest.countDocuments({ collector_id: req.user.id, status: 'completed' }),
      PickupRequest.aggregate([
        { $match: { collector_id: collectorOid, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$final_price' } } },
      ]),
    ]);
    const profile = user?.collector_profile || {};
    const earnings = earningsResult[0]?.total || 0;
    res.json({ success: true, data: { profile, completed, earnings } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = {
  getNotifications, markAllRead,
  createRating, createComplaint, getMyComplaints,
  getPayments, payRequest, getCategories,
  getCollectorTasks, getAvailableCollectorRequests, updateCollectorAvailability, updateCollectorLocation, getCollectorStats,
};