const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const PickupRequest = require('../models/PickupRequest');
const Payment = require('../models/Payment');
const User = require('../models/User');
const WasteCategory = require('../models/WasteCategory');
const AuditLog = require('../models/AuditLog');
const { haversineDistance } = require('../utils/geo');
const { decrypt, encrypt } = require('../utils/sensitiveData');
const {
  findBestCollector,
  isVehicleCompatible,
} = require('../services/assignmentService');
const { notifyUser } = require('../services/notificationService');
const { createPendingEarning } = require('../services/walletService');
const { emitRequestEvent } = require('../services/realtimeService');
const {
  collectorProfilePhotoDir,
  pickupProofDir,
} = require('../config/storage');
const {
  deleteStoredFile,
  ENCRYPTION_VERSION,
  readEncryptedFile,
  writeEncryptedFile,
} = require('../utils/secureFileStorage');
const {
  getPickupProofDeleteAt,
} = require('../services/sensitiveDataLifecycle');
const { recordFraudAlert } = require('../services/fraudDetectionService');
const {
  COLLECTION_START_LEAD_MS,
  SCHEDULED_SERVICE_TYPES,
  validateServiceRequest,
} = require('../utils/serviceTypes');
const { hasValidHazardousCertification } = require('../utils/collectorCertification');
const { normalizeAddress, validateStructuredAddress } = require('../utils/address');
const {
  applyContractPricing,
  getDeferredExposure,
  getOwnedContractSite,
} = require('./businessContractController');
const {
  calculateConfiguredPrice,
  listAvailableSlots,
  releaseServiceSlot,
  reserveServiceSlot,
} = require('../services/serviceConfigurationService');
const ACTIVE_STATUSES = ['assigned', 'on_way', 'in_progress'];
const TERMINAL_STATUSES = ['completed', 'cancelled', 'failed'];
const TRANSITIONS = {
  assigned: ['on_way', 'failed'],
  on_way: ['in_progress', 'failed'],
  in_progress: ['completed', 'failed'],
};
const CANCELLATION_REASONS = [
  'changed_mind', 'duplicate', 'collector_delay', 'price', 'address_error', 'other',
];
const VEHICLE_SPEED_KMH = {
  foot: 4,
  motorcycle: 25,
  tricycle: 18,
  car: 25,
  van: 22,
};
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validateBusinessDetails = (body) => {
  const details = {
    company_name: String(body.company_name || '').trim(),
    registration_number: String(body.registration_number || '').trim(),
    tax_id: String(body.tax_id || '').trim(),
    billing_email: String(body.billing_email || '').trim().toLowerCase(),
    billing_address: String(body.billing_address || '').trim(),
    contact_name: String(body.contact_name || '').trim(),
  };
  if (
    details.company_name.length < 2
    || details.registration_number.length < 3
    || !EMAIL_REGEX.test(details.billing_email)
    || details.billing_address.length < 5
    || details.contact_name.length < 2
  ) {
    return {
      message: 'Informations de facturation entreprise incompletes ou invalides',
    };
  }
  return { details };
};

const calculateCancellationFee = (request) => {
  const rate = request.status === 'on_way' ? 0.2 : request.status === 'assigned' ? 0.1 : 0;
  if (!rate) return 0;
  return Math.max(rate === 0.2 ? 500 : 200, Math.round((request.estimated_price || 0) * rate));
};

const isValidCoordinate = (latitude, longitude) => Number.isFinite(Number(latitude))
  && Number.isFinite(Number(longitude))
  && Number(latitude) >= -90 && Number(latitude) <= 90
  && Number(longitude) >= -180 && Number(longitude) <= 180;

const isSupportedImage = (file) => {
  if (!file || !['image/jpeg', 'image/png'].includes(file.mimetype)) return false;
  const jpeg = file.buffer?.[0] === 0xff && file.buffer?.[1] === 0xd8 && file.buffer?.[2] === 0xff;
  const png = file.buffer?.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
  return jpeg || png;
};

const flattenRequest = (request, payment, viewerRole) => {
  const isAdmin = viewerRole === 'admin';
  const proofs = (request.proofs || []).map((proof) => ({
    _id: proof._id,
    type: proof.type,
    mime_type: proof.mime_type,
    size: proof.size,
    captured_at: proof.captured_at,
    uploaded_at: proof.uploaded_at,
    location: proof.location,
  }));
  return {
    ...request,
    proofs,
    id: request._id?.toString(),
    user_id: request.user_id?._id?.toString() || request.user_id?.toString(),
    user_name: request.user_id?.name,
    user_phone: isAdmin ? request.user_id?.phone : undefined,
    user_email: isAdmin ? request.user_id?.email : undefined,
    collector_id: request.collector_id?._id?.toString() || request.collector_id?.toString(),
    collector_name: request.collector_id?.name,
    collector_phone: isAdmin ? request.collector_id?.phone : undefined,
    collector_avatar_url: request.collector_id?.avatar_url,
    collector_photo_available: Boolean(
      request.collector_id?.collector_profile?.profile_photo?.stored_name
    ),
    category_id: request.category_id?._id?.toString() || request.category_id?.toString(),
    category_name: request.category_id?.name,
    category_icon: request.category_id?.icon,
    base_price: request.category_id?.base_price,
    payment_status: payment?.status,
    payment_uuid: payment?.uuid,
    payment_amount: payment?.amount,
    payment_method: payment?.method,
    cancellation_fee_estimate: calculateCancellationFee(request),
    completion_verification: request.completion_verification
      ? {
          expires_at: request.completion_verification.expires_at,
          verified_at: request.completion_verification.verified_at,
        }
      : undefined,
  };
};

const getRequests = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const filter = { is_archived: req.query.archived === 'true' };
    if (req.user.role === 'user' || req.query.perspective === 'user') filter.user_id = req.user.id;
    else if (req.user.role === 'collector') filter.collector_id = req.user.id;
    if (req.query.status) filter.status = req.query.status;

    const [requests, total] = await Promise.all([
      PickupRequest.find(filter)
        .populate('user_id', 'name phone email')
        .populate(
          'collector_id',
          'name phone avatar_url collector_profile.profile_photo.stored_name'
        )
        .populate('category_id', 'name icon base_price')
        .sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PickupRequest.countDocuments(filter),
    ]);
    const payments = await Payment.find({ request_id: { $in: requests.map((row) => row._id) } }).lean();
    const paymentMap = new Map(payments.map((payment) => [payment.request_id.toString(), payment]));
    res.json({
      success: true,
      data: requests.map((row) => flattenRequest(
        row,
        paymentMap.get(row._id.toString()),
        req.user.role
      )),
      pagination: { total, page, limit },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getRequestById = async (req, res) => {
  try {
    const request = await PickupRequest.findOne({ uuid: req.params.uuid })
      .populate('user_id', 'name phone email')
      .populate(
        'collector_id',
        'name phone avatar_url collector_profile.vehicle_type collector_profile.profile_photo.stored_name'
      )
      .populate('category_id', 'name icon base_price')
      .lean();
    if (!request) return res.status(404).json({ success: false, message: 'Demande non trouvee' });

    const isOwner = request.user_id?._id?.toString() === req.user.id;
    const isCollector = request.collector_id?._id?.toString() === req.user.id;
    if (req.user.role !== 'admin' && !isOwner && !isCollector) {
      return res.status(403).json({ success: false, message: 'Acces interdit' });
    }
    const payment = await Payment.findOne({ request_id: request._id }).lean();
    res.json({ success: true, data: flattenRequest(request, payment, req.user.role) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const buildAssignment = async ({ req, category, address, latitude, longitude, quantity, serviceType }) => {
  const assignment = await findBestCollector({
    latitude,
    longitude,
    address,
    quantity,
    serviceType,
    isHazardous: Boolean(category.is_hazardous),
    excludedUserId: req.user.id,
  });
  if (!assignment) return {
    collectorId: null,
    distanceKm: null,
    status: 'pending',
    metadata: undefined,
  };
  return {
    collectorId: assignment.collector._id,
    distanceKm: assignment.distance_km,
    status: 'assigned',
    metadata: assignment.metadata,
    collector: assignment.collector,
  };
};

const createRequest = async (req, res) => {
  let reservedSlot = null;
  let requestCreated = false;
  try {
    const {
      category_id, address, quantity_estimate, notes, scheduled_at,
      service_type = 'immediate', latitude, longitude, quantity_number = 1,
      client_operation_id, business_contract_id, business_site_id,
    } = req.body;
    let effectiveLatitude = latitude;
    let effectiveLongitude = longitude;
    let effectiveAddress = normalizeAddress(req.body);
    let selectedContract = null;
    let selectedSite = null;
    if (service_type === 'business' && business_contract_id && business_site_id) {
      const selection = await getOwnedContractSite({
        userId: req.user.id,
        contractId: business_contract_id,
        siteId: business_site_id,
      });
      if (selection.message) {
        return res.status(409).json({ success: false, message: selection.message });
      }
      selectedContract = selection.contract;
      selectedSite = selection.site;
      effectiveLatitude = selectedSite.latitude;
      effectiveLongitude = selectedSite.longitude;
      effectiveAddress = normalizeAddress(selectedSite);
    }
    if (client_operation_id) {
      const existing = await PickupRequest.findOne({
        user_id: req.user.id,
        client_operation_id: String(client_operation_id),
      }).lean();
      if (existing) {
        return res.json({
          success: true,
          message: 'Demande deja synchronisee',
          data: {
            uuid: existing.uuid,
            status: existing.status,
            distance_km: existing.distance_km,
            estimated_price: existing.estimated_price,
          },
        });
      }
    }
    const addressError = validateStructuredAddress(effectiveAddress, {
      allowLegacy: !(req.body.city || req.body.district || selectedSite),
    });
    if (!category_id || addressError) {
      return res.status(400).json({ success: false, message: 'Categorie et adresse requises' });
    }
    if (!isValidCoordinate(effectiveLatitude, effectiveLongitude)) {
      return res.status(400).json({ success: false, message: 'Position GPS valide requise' });
    }
    const category = await WasteCategory.findOne({ _id: category_id, is_active: true });
    if (!category) return res.status(404).json({ success: false, message: 'Categorie non trouvee' });
    const serviceValidation = validateServiceRequest({
      serviceType: service_type,
      scheduledAt: scheduled_at,
      category,
    });
    if (serviceValidation.message) {
      return res.status(400).json({
        success: false,
        message: serviceValidation.message,
      });
    }
    const businessValidation = service_type === 'business'
      ? selectedContract
        ? {
            details: {
              company_name: selectedContract.company_name,
              registration_number: selectedContract.registration_number,
              tax_id: selectedContract.tax_id,
              billing_email: selectedContract.billing_email,
              billing_address: selectedContract.billing_address,
              contact_name: selectedContract.contact_name,
            },
          }
        : validateBusinessDetails(req.body)
      : { details: undefined };
    if (businessValidation.message) {
      return res.status(400).json({
        success: false,
        message: businessValidation.message,
      });
    }

    const quantity = Math.min(20, Math.max(1, Number(quantity_number) || 1));
    const assignment = await buildAssignment({
      req,
      category,
      address: effectiveAddress.formatted,
      latitude: effectiveLatitude,
      longitude: effectiveLongitude,
      quantity,
      serviceType: service_type,
    });
    let pricing = await calculateConfiguredPrice({
      basePrice: category.base_price,
      quantity,
      distanceKm: assignment.distanceKm || 0,
      serviceType: service_type,
      city: effectiveAddress.city,
      district: effectiveAddress.district,
    });
    if (pricing.message) {
      return res.status(409).json({ success: false, message: pricing.message });
    }
    if (selectedContract) {
      pricing = applyContractPricing({ pricing, contract: selectedContract });
      const exposure = await getDeferredExposure(selectedContract._id);
      if (
        selectedContract.billing_cycle === 'monthly'
        && selectedContract.credit_limit > 0
        && exposure.amount + pricing.total > selectedContract.credit_limit
      ) {
        return res.status(409).json({
          success: false,
          message: 'Plafond de credit entreprise atteint. Reglez une facture ou contactez l administration.',
        });
      }
    }
    if (SCHEDULED_SERVICE_TYPES.includes(service_type)) {
      reservedSlot = await reserveServiceSlot({
        serviceType: service_type,
        scheduledAt: serviceValidation.scheduledDate,
      });
      if (!reservedSlot) {
        return res.status(409).json({
          success: false,
          message: 'Ce creneau est complet. Choisissez un autre horaire.',
        });
      }
    }
    const estimatedPrice = pricing.total;
    const request = await PickupRequest.create({
      uuid: uuidv4(),
      user_id: req.user.id,
      collector_id: assignment.collectorId,
      category_id,
      status: assignment.status,
      address: effectiveAddress.formatted,
      address_details: effectiveAddress,
      latitude: Number(effectiveLatitude),
      longitude: Number(effectiveLongitude),
      quantity_estimate: String(quantity_estimate || '').trim(),
      quantity_number: quantity,
      notes: String(notes || '').trim(),
      distance_km: assignment.distanceKm,
      scheduled_at: reservedSlot?.start_at || serviceValidation.scheduledDate,
      service_slot_id: reservedSlot?._id,
      service_type,
      business_contract_id: selectedContract?._id,
      business_site_id: selectedSite?._id,
      estimated_price: estimatedPrice,
      final_price: estimatedPrice,
      pricing: pricing.breakdown,
      business_details: businessValidation.details,
      assignment_metadata: assignment.metadata,
      client_operation_id: client_operation_id ? String(client_operation_id) : undefined,
      status_history: [{
        to: assignment.status,
        changed_by: req.user.id,
        note: assignment.collectorId ? 'Attribution intelligente automatique' : 'En attente de collecteur',
      }],
    });
    requestCreated = true;

    if (selectedContract?.billing_cycle === 'monthly') {
      await Payment.create({
        uuid: uuidv4(),
        request_id: request._id,
        user_id: req.user.id,
        amount: estimatedPrice,
        method: 'bank_transfer',
        provider: 'sandbox',
        status: 'pending',
        initiated_at: new Date(),
      });
    }

    await notifyUser({
      userId: req.user.id,
      title: assignment.collectorId ? 'Collecteur assigne' : 'Demande recue',
      message: assignment.collectorId
        ? `${assignment.collector.name} a ete selectionne. Prix estime: ${estimatedPrice.toLocaleString()} FCFA.`
        : 'Votre demande est enregistree. Nous recherchons un collecteur compatible.',
      type: 'request',
      data: { request_uuid: request.uuid, target_path: `/dashboard/requests/${request.uuid}` },
    });
    if (assignment.collectorId) {
      await notifyUser({
        userId: assignment.collectorId,
        title: 'Nouvelle mission',
        message: `Collecte a ${effectiveAddress.formatted}, a ${assignment.distanceKm} km.`,
        type: 'request',
        data: { request_uuid: request.uuid, target_path: `/collector/tasks/${request.uuid}` },
      });
    }

    return res.status(201).json({
      success: true,
      message: assignment.collectorId ? 'Demande creee et collecteur assigne' : 'Demande creee',
      data: {
        uuid: request.uuid,
        status: request.status,
        collector_name: assignment.collector?.name || null,
        distance_km: assignment.distanceKm,
        estimated_price: estimatedPrice,
      },
    });
  } catch (error) {
    if (reservedSlot && !requestCreated) {
      await releaseServiceSlot(reservedSlot._id).catch(() => {});
    }
    if (error?.code === 11000 && req.body.client_operation_id) {
      const existing = await PickupRequest.findOne({
        user_id: req.user.id,
        client_operation_id: String(req.body.client_operation_id),
      }).lean();
      if (existing) {
        return res.json({
          success: true,
          message: 'Demande deja synchronisee',
          data: {
            uuid: existing.uuid,
            status: existing.status,
            distance_km: existing.distance_km,
            estimated_price: existing.estimated_price,
          },
        });
      }
    }
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const generateCompletionCode = async (request) => {
  const code = String(crypto.randomInt(100000, 1000000));
  request.completion_verification = {
    code_hash: await bcrypt.hash(code, 10),
    encrypted_code: encrypt(code),
    expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
    attempts: 0,
  };
  return code;
};

const updateStatus = async (req, res) => {
  try {
    const { status, completion_code, note, client_operation_id } = req.body;
    if (![...Object.keys(TRANSITIONS), ...TERMINAL_STATUSES, 'approved'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Statut invalide' });
    }
    const request = await PickupRequest.findOne({ uuid: req.params.uuid })
      .select('+completion_verification.code_hash +completion_verification.encrypted_code');
    if (!request) return res.status(404).json({ success: false, message: 'Demande non trouvee' });
    if (client_operation_id && request.processed_operation_ids.includes(String(client_operation_id))) {
      return res.json({
        success: true,
        message: 'Statut deja synchronise',
        data: { status: request.status },
      });
    }

    if (req.user.role === 'collector' && status === 'assigned' && !request.collector_id) {
      const [collector, category] = await Promise.all([
        User.findById(req.user.id)
          .select('collector_profile.vehicle_type collector_profile.hazardous_certification')
          .lean(),
        WasteCategory.findById(request.category_id).select('is_hazardous').lean(),
      ]);
      if (!isVehicleCompatible({
        vehicleType: collector?.collector_profile?.vehicle_type || 'foot',
        quantity: request.quantity_number,
        serviceType: request.service_type,
        isHazardous: Boolean(category?.is_hazardous),
        hazardousCertified: hasValidHazardousCertification(collector),
      })) {
        return res.status(409).json({
          success: false,
          message: 'Votre moyen de transport n est pas compatible avec cette collecte',
        });
      }
      const accepted = await PickupRequest.findOneAndUpdate(
        { _id: request._id, status: 'pending', collector_id: null },
        {
          $set: { status: 'assigned', collector_id: req.user.id },
          $push: {
            status_history: {
              from: 'pending', to: 'assigned', changed_by: req.user.id,
              note: 'Mission acceptee par le collecteur',
            },
          },
        },
        { new: true }
      );
      if (!accepted) {
        return res.status(409).json({ success: false, message: 'Cette demande n est plus disponible' });
      }
      await notifyUser({
        userId: request.user_id,
        title: 'Collecteur assigne',
        message: 'Un collecteur compatible a accepte votre demande. Utilisez le chat pour communiquer.',
        type: 'request',
        data: { request_uuid: request.uuid, target_path: `/dashboard/requests/${request.uuid}` },
      });
      emitRequestEvent(request.uuid, 'status_updated', { status: 'assigned' });
      return res.json({ success: true, message: 'Mission acceptee' });
    }

    if (req.user.role === 'collector') {
      if (request.collector_id?.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Acces interdit' });
      }
      if (!TRANSITIONS[request.status]?.includes(status)) {
        return res.status(409).json({
          success: false,
          message: `Transition ${request.status} vers ${status} interdite`,
        });
      }
      if (
        status === 'on_way'
        && request.scheduled_at
        && request.scheduled_at.getTime() > Date.now() + COLLECTION_START_LEAD_MS
      ) {
        return res.status(409).json({
          success: false,
          message: 'Cette mission peut demarrer au maximum une heure avant l horaire prevu',
        });
      }
      if (status === 'in_progress' && !request.proofs.some((proof) => proof.type === 'before')) {
        return res.status(400).json({ success: false, message: 'Ajoutez une photo avant la collecte' });
      }
      if (status === 'failed' && !String(note || '').trim()) {
        return res.status(400).json({ success: false, message: 'Le motif de l echec est obligatoire' });
      }
      if (status === 'completed') {
        if (!request.proofs.some((proof) => proof.type === 'after')) {
          return res.status(400).json({ success: false, message: 'Ajoutez une photo apres la collecte' });
        }
        if (!completion_code || !request.completion_verification?.code_hash) {
          return res.status(400).json({ success: false, message: 'Code OTP du client requis' });
        }
        if (request.completion_verification.expires_at < new Date()) {
          return res.status(400).json({ success: false, message: 'Le code OTP a expire' });
        }
        if (request.completion_verification.attempts >= 5) {
          return res.status(429).json({ success: false, message: 'Trop de tentatives OTP' });
        }
        const validCode = await bcrypt.compare(
          String(completion_code),
          request.completion_verification.code_hash
        );
        if (!validCode) {
          request.completion_verification.attempts += 1;
          await request.save();
          const attempts = request.completion_verification.attempts;
          if (attempts >= 3) {
            await recordFraudAlert({
              category: 'otp_abuse',
              dedupeKey: `request:${request._id}`,
              score: attempts >= 5 ? 80 : 50,
              title: 'Tentatives OTP anormales',
              description: 'Le collecteur a saisi plusieurs codes de confirmation incorrects.',
              signals: [{
                code: attempts >= 5 ? 'otp_attempt_limit_reached' : 'repeated_invalid_otp',
                weight: attempts >= 5 ? 80 : 50,
                details: { attempts },
              }],
              subjectUserId: req.user.id,
              relatedUserIds: [request.user_id],
              pickupRequestId: request._id,
            });
          }
          return res.status(attempts >= 5 ? 429 : 400).json({
            success: false,
            message: attempts >= 5 ? 'Trop de tentatives OTP' : 'Code OTP incorrect',
          });
        }
        request.completion_verification.verified_at = new Date();
      }
    }
    if (req.user.role === 'admin' && !['approved', 'cancelled', 'failed'].includes(status)) {
      return res.status(403).json({
        success: false,
        message: 'Utilisez l attribution dediee; les etapes terrain sont reservees au collecteur',
      });
    }
    if (req.user.role === 'admin' && ['cancelled', 'failed'].includes(status) && !String(note || '').trim()) {
      return res.status(400).json({ success: false, message: 'Un motif administratif est obligatoire' });
    }

    const previousStatus = request.status;
    request.status = status;
    if (client_operation_id) {
      request.processed_operation_ids.push(String(client_operation_id));
    }
    request.status_history.push({
      from: previousStatus,
      to: status,
      changed_by: req.user.id,
      note: String(note || '').trim(),
    });

    let generatedCode = null;
    if (status === 'in_progress' && !request.completion_verification?.code_hash) {
      generatedCode = await generateCompletionCode(request);
    }
    if (status === 'completed') {
      request.collected_at = new Date();
      request.final_price = request.estimated_price;
    }
    if (status === 'cancelled') {
      request.cancellation = {
        reason: 'other',
        details: String(note || '').trim(),
        cancelled_by: req.user.id,
        cancelled_at: new Date(),
        fee_amount: 0,
      };
    }
    if (TERMINAL_STATUSES.includes(status)) {
      request.collector_location = undefined;
      request.eta_minutes = undefined;
      request.remaining_distance_km = undefined;
      if (request.proofs.length && !request.proofs_delete_at) {
        request.proofs_delete_at = getPickupProofDeleteAt(new Date());
      }
    }
    await request.save();
    if (
      ['cancelled', 'failed'].includes(status)
      && request.service_slot_id
      && request.scheduled_at > new Date()
    ) {
      await releaseServiceSlot(request.service_slot_id).catch(() => {});
    }
    emitRequestEvent(request.uuid, 'status_updated', {
      status,
      collected_at: request.collected_at,
    });

    if (status === 'completed') {
      await Payment.findOneAndUpdate(
        { request_id: request._id },
        {
          $setOnInsert: {
            uuid: uuidv4(),
            request_id: request._id,
            user_id: request.user_id,
            amount: request.final_price,
            status: 'pending',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      await Promise.all([
        User.findByIdAndUpdate(request.collector_id, {
          $inc: { 'collector_profile.total_collections': 1 },
        }),
        createPendingEarning({
          collectorId: request.collector_id,
          requestId: request._id,
          grossAmount: request.final_price,
        }),
      ]);
    }

    const statusMessages = {
      on_way: 'Votre collecteur est en route.',
      in_progress: `La collecte commence. Votre code de confirmation est ${generatedCode}. Ne le donnez qu apres verification du travail.`,
      completed: 'Collecte terminee et confirmee avec votre code OTP.',
      failed: `La collecte a echoue. Motif: ${String(note || 'non precise')}`,
      cancelled: `La collecte a ete annulee. Motif: ${String(note || 'non precise')}`,
    };
    if (statusMessages[status]) {
      await notifyUser({
        userId: request.user_id,
        title: `Collecte: ${status}`,
        message: statusMessages[status],
        type: 'update',
        data: { request_uuid: request.uuid, target_path: `/dashboard/requests/${request.uuid}` },
      });
    }
    res.json({ success: true, message: 'Statut mis a jour' });
  } catch (error) {
    console.error(error);
    if (error?.name === 'VersionError') {
      return res.status(409).json({
        success: false,
        message: 'La collecte vient d etre modifiee. Actualisez puis reessayez.',
      });
    }
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getCompletionCode = async (req, res) => {
  try {
    const request = await PickupRequest.findOne({
      uuid: req.params.uuid,
      user_id: req.user.id,
      status: 'in_progress',
    }).select('+completion_verification.encrypted_code');
    if (!request?.completion_verification?.encrypted_code) {
      return res.status(404).json({ success: false, message: 'Code OTP indisponible' });
    }
    res.json({
      success: true,
      data: {
        code: decrypt(request.completion_verification.encrypted_code),
        expires_at: request.completion_verification.expires_at,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const uploadProof = async (req, res) => {
  let storedName;
  let proofPersisted = false;
  try {
    const {
      type, latitude, longitude, accuracy_meters, captured_at, client_operation_id,
    } = req.body;
    if (!['before', 'after'].includes(type) || !isSupportedImage(req.file)) {
      return res.status(400).json({ success: false, message: 'Photo JPEG/PNG et type de preuve valides requis' });
    }
    if (!isValidCoordinate(latitude, longitude)) {
      return res.status(400).json({ success: false, message: 'Geolocalisation valide requise' });
    }
    const capturedAt = new Date(captured_at);
    if (Number.isNaN(capturedAt.getTime())
      || capturedAt < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      || capturedAt > new Date(Date.now() + 5 * 60 * 1000)) {
      return res.status(400).json({ success: false, message: 'Horodatage de la photo invalide' });
    }

    const request = await PickupRequest.findOne({
      uuid: req.params.uuid,
      collector_id: req.user.id,
      status: { $in: ['on_way', 'in_progress'] },
    });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Mission active introuvable' });
    }
    if (client_operation_id && request.proofs.some(
      (proof) => proof.client_operation_id === String(client_operation_id)
    )) {
      return res.json({ success: true, message: `Photo ${type} deja synchronisee` });
    }
    const distance = haversineDistance(
      request.latitude, request.longitude, Number(latitude), Number(longitude)
    );
    if (distance > 2.5) {
      return res.status(400).json({
        success: false,
        message: `La photo doit etre prise pres du lieu de collecte (${distance.toFixed(1)} km detectes)`,
      });
    }

    const extension = req.file.mimetype === 'image/png' ? '.png' : '.jpg';
    storedName = await writeEncryptedFile({
      directory: pickupProofDir,
      storedName: `${request.uuid}-${type}-${uuidv4()}.enc`,
      buffer: req.file.buffer,
      context: 'pickup-proof',
    });
    const previousProof = request.proofs.find((proof) => proof.type === type);
    request.proofs = request.proofs.filter((proof) => proof.type !== type);
    request.proofs.push({
      type,
      stored_name: storedName,
      original_name: path.basename(req.file.originalname || `preuve-${type}${extension}`),
      mime_type: req.file.mimetype,
      size: req.file.size,
      sha256: crypto.createHash('sha256').update(req.file.buffer).digest('hex'),
      encryption_version: ENCRYPTION_VERSION,
      encrypted_at: new Date(),
      client_operation_id: client_operation_id ? String(client_operation_id) : undefined,
      captured_at: capturedAt,
      location: {
        latitude: Number(latitude),
        longitude: Number(longitude),
        accuracy_meters: Number(accuracy_meters) || undefined,
      },
    });
    await request.save();
    proofPersisted = true;
    if (previousProof?.stored_name) {
      deleteStoredFile({
        directory: pickupProofDir,
        storedName: previousProof.stored_name,
      }).catch(() => {});
    }
    res.status(201).json({ success: true, message: `Photo ${type} enregistree` });
  } catch (error) {
    if (storedName && !proofPersisted) {
      await deleteStoredFile({
        directory: pickupProofDir,
        storedName,
      }).catch(() => {});
    }
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getProof = async (req, res) => {
  try {
    const request = await PickupRequest.findOne({ uuid: req.params.uuid });
    if (!request) return res.status(404).json({ success: false, message: 'Demande introuvable' });
    const allowed = req.user.role === 'admin'
      || request.user_id.toString() === req.user.id
      || request.collector_id?.toString() === req.user.id;
    if (!allowed) return res.status(403).json({ success: false, message: 'Acces interdit' });
    const proof = request.proofs.id(req.params.proofId);
    if (!proof) return res.status(404).json({ success: false, message: 'Preuve introuvable' });
    const { buffer, migrated } = await readEncryptedFile({
      directory: pickupProofDir,
      storedName: proof.stored_name,
      context: 'pickup-proof',
    });
    if (migrated) {
      proof.encryption_version = ENCRYPTION_VERSION;
      proof.encrypted_at = new Date();
      await request.save();
    }
    await AuditLog.create({
      actor_id: req.user.id,
      action: 'pickup_request.proof_viewed',
      target_type: 'PickupRequest',
      target_id: request._id,
      metadata: { proof_id: proof._id, proof_type: proof.type },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    res.type(proof.mime_type);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', 'inline');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getCollectorPhoto = async (req, res) => {
  try {
    const request = await PickupRequest.findOne({ uuid: req.params.uuid })
      .select('user_id collector_id')
      .lean();
    if (!request?.collector_id) {
      return res.status(404).json({ success: false, message: 'Collecteur non assigne' });
    }
    const allowed = req.user.role === 'admin'
      || request.user_id.toString() === req.user.id
      || request.collector_id.toString() === req.user.id;
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Acces interdit' });
    }
    const collector = await User.findOne({
      _id: request.collector_id,
      role: 'collector',
      is_active: true,
      'collector_profile.verification_status': 'verified',
    }).select('collector_profile.profile_photo');
    const photo = collector?.collector_profile?.profile_photo;
    if (!photo?.stored_name) {
      return res.status(404).json({ success: false, message: 'Photo du collecteur indisponible' });
    }
    const { buffer, migrated } = await readEncryptedFile({
      directory: collectorProfilePhotoDir,
      storedName: photo.stored_name,
      context: 'collector-profile-photo',
    });
    if (migrated) {
      photo.encryption_version = ENCRYPTION_VERSION;
      photo.encrypted_at = new Date();
      await collector.save();
    }
    res.type(photo.mime_type);
    res.set('Cache-Control', 'private, max-age=300');
    res.set('Content-Disposition', 'inline');
    return res.send(buffer);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ success: false, message: 'Photo du collecteur indisponible' });
    }
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude, accuracy_meters } = req.body;
    if (!isValidCoordinate(latitude, longitude)) {
      return res.status(400).json({ success: false, message: 'Coordonnees invalides' });
    }
    const request = await PickupRequest.findOne({
      uuid: req.params.uuid,
      collector_id: req.user.id,
      status: { $in: ACTIVE_STATUSES },
    });
    if (!request) return res.status(404).json({ success: false, message: 'Mission active introuvable' });

    const remainingDistance = haversineDistance(
      Number(latitude), Number(longitude), request.latitude, request.longitude
    );
    const collector = await User.findById(req.user.id).select('collector_profile.vehicle_type');
    const speed = VEHICLE_SPEED_KMH[collector?.collector_profile?.vehicle_type] || 18;
    const etaMinutes = Math.max(1, Math.ceil((remainingDistance / speed) * 60 * 1.25));
    const now = new Date();
    request.collector_location = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy_meters: Number(accuracy_meters) || undefined,
      updated_at: now,
    };
    request.remaining_distance_km = Math.round(remainingDistance * 100) / 100;
    request.eta_minutes = etaMinutes;
    await request.save();
    await User.findByIdAndUpdate(req.user.id, {
      $set: {
        'collector_profile.location': {
          type: 'Point',
          coordinates: [Number(longitude), Number(latitude)],
        },
        'collector_profile.last_location_update': now,
      },
    });
    emitRequestEvent(request.uuid, 'location_updated', {
      collector_location: request.collector_location,
      eta_minutes: etaMinutes,
      remaining_distance_km: request.remaining_distance_km,
    });
    res.json({
      success: true,
      data: { eta_minutes: etaMinutes, remaining_distance_km: request.remaining_distance_km },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const assignCollector = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.body.collector_id)) {
      return res.status(400).json({ success: false, message: 'ID collecteur invalide' });
    }
    const collector = await User.findOne({
      _id: req.body.collector_id,
      role: 'collector',
      is_active: true,
      'collector_profile.verification_status': 'verified',
    });
    if (!collector) return res.status(404).json({ success: false, message: 'Collecteur introuvable' });
    const requestToAssign = await PickupRequest.findOne({
      uuid: req.params.uuid,
      status: { $in: ['pending', 'approved'] },
    }).populate('category_id', 'is_hazardous');
    if (!requestToAssign) {
      return res.status(404).json({ success: false, message: 'Demande non assignable' });
    }
    if (!isVehicleCompatible({
      vehicleType: collector.collector_profile?.vehicle_type || 'foot',
      quantity: requestToAssign.quantity_number,
      serviceType: requestToAssign.service_type,
      isHazardous: Boolean(requestToAssign.category_id?.is_hazardous),
      hazardousCertified: hasValidHazardousCertification(collector),
    })) {
      return res.status(409).json({
        success: false,
        message: 'Le moyen de transport du collecteur n est pas compatible',
      });
    }
    const request = await PickupRequest.findOneAndUpdate(
      {
        _id: requestToAssign._id,
        status: { $in: ['pending', 'approved'] },
        collector_id: null,
      },
      {
        $set: { collector_id: collector._id, status: 'assigned' },
        $push: {
          status_history: {
            from: 'pending', to: 'assigned', changed_by: req.user.id,
            note: 'Attribution manuelle par administration',
          },
        },
      },
      { new: true }
    );
    if (!request) return res.status(404).json({ success: false, message: 'Demande non assignable' });
    await notifyUser({
      userId: collector._id,
      title: 'Nouvelle mission assignee',
      message: `Une mission vous a ete assignee a ${request.address}.`,
      type: 'request',
      data: { request_uuid: request.uuid, target_path: `/collector/tasks/${request.uuid}` },
    });
    res.json({ success: true, message: 'Collecteur assigne' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const cancelRequest = async (req, res) => {
  try {
    const { reason, details } = req.body || {};
    if (!CANCELLATION_REASONS.includes(reason)) {
      return res.status(400).json({ success: false, message: 'Motif d annulation obligatoire' });
    }
    const request = await PickupRequest.findOne({ uuid: req.params.uuid, user_id: req.user.id });
    if (!request) return res.status(404).json({ success: false, message: 'Demande non trouvee' });
    if (['in_progress', ...TERMINAL_STATUSES].includes(request.status)) {
      return res.status(400).json({ success: false, message: 'Cette collecte ne peut plus etre annulee' });
    }
    const fee = calculateCancellationFee(request);
    const previousStatus = request.status;
    request.status = 'cancelled';
    request.collector_location = undefined;
    request.eta_minutes = undefined;
    request.remaining_distance_km = undefined;
    request.final_price = fee;
    if (request.proofs.length && !request.proofs_delete_at) {
      request.proofs_delete_at = getPickupProofDeleteAt(new Date());
    }
    request.cancellation = {
      reason,
      details: String(details || '').trim().slice(0, 500),
      cancelled_by: req.user.id,
      cancelled_at: new Date(),
      fee_amount: fee,
    };
    request.status_history.push({
      from: previousStatus,
      to: 'cancelled',
      changed_by: req.user.id,
      note: `Annulation: ${reason}`,
    });
    await request.save();
    if (request.service_slot_id && request.scheduled_at > new Date()) {
      await releaseServiceSlot(request.service_slot_id).catch(() => {});
    }
    emitRequestEvent(request.uuid, 'status_updated', {
      status: 'cancelled',
      cancellation: request.cancellation,
    });
    if (fee > 0) {
      await Payment.findOneAndUpdate(
        { request_id: request._id },
        {
          $setOnInsert: {
            uuid: uuidv4(), request_id: request._id, user_id: request.user_id,
            amount: fee, status: 'pending',
          },
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
      if (request.collector_id) {
        await createPendingEarning({
          collectorId: request.collector_id,
          requestId: request._id,
          grossAmount: fee,
        });
      }
    }
    if (request.collector_id) {
      await notifyUser({
        userId: request.collector_id,
        title: 'Mission annulee',
        message: `La collecte a ${request.address} a ete annulee par le client.`,
        type: 'request',
        data: { request_uuid: request.uuid, target_path: `/collector/tasks/${request.uuid}` },
      });
    }
    res.json({
      success: true,
      message: fee ? `Demande annulee. Frais: ${fee} FCFA` : 'Demande annulee sans frais',
      data: { cancellation_fee: fee },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const estimatePrice = async (req, res) => {
  try {
    const category = await WasteCategory.findOne({ _id: req.body.category_id, is_active: true });
    if (!category) return res.status(404).json({ success: false, message: 'Categorie non trouvee' });
    const serviceValidation = validateServiceRequest({
      serviceType: req.body.service_type || 'immediate',
      category,
      requireSchedule: false,
    });
    if (serviceValidation.message) {
      return res.status(400).json({
        success: false,
        message: serviceValidation.message,
      });
    }
    const quantity = Math.min(20, Math.max(1, Number(req.body.quantity_number) || 1));
    const addressDetails = normalizeAddress(req.body);
    const assignment = await buildAssignment({
      req,
      category,
      address: addressDetails.formatted,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      quantity,
      serviceType: req.body.service_type,
    });
    const pricing = await calculateConfiguredPrice({
      basePrice: category.base_price,
      quantity,
      distanceKm: assignment.distanceKm || 0,
      serviceType: req.body.service_type || 'immediate',
      city: addressDetails.city,
      district: addressDetails.district,
    });
    if (pricing.message) {
      return res.status(409).json({ success: false, message: pricing.message });
    }
    res.json({
      success: true,
      data: {
        base_price: category.base_price,
        quantity,
        distance_km: assignment.distanceKm || 0,
        estimated_price: pricing.total,
        pricing: pricing.breakdown,
        collector_found: Boolean(assignment.collectorId),
        collector_name: assignment.collector?.name || null,
        assignment_score: assignment.metadata?.score,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getServiceSlots = async (req, res) => {
  try {
    const serviceType = String(req.query.service_type || '');
    const date = String(req.query.date || '');
    if (!SCHEDULED_SERVICE_TYPES.includes(serviceType)
      || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: 'Service planifie et date valides requis',
      });
    }
    const slots = await listAvailableSlots({ serviceType, date });
    return res.json({ success: true, data: slots });
  } catch (error) {
    console.error('getServiceSlots error:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const archiveRequest = async (req, res) => {
  try {
    const request = await PickupRequest.findOne({ uuid: req.params.uuid });
    if (!request) return res.status(404).json({ success: false, message: 'Demande non trouvee' });
    const allowed = request.user_id.toString() === req.user.id
      || request.collector_id?.toString() === req.user.id;
    if (!allowed) return res.status(403).json({ success: false, message: 'Acces interdit' });
    if (!TERMINAL_STATUSES.includes(request.status)) {
      return res.status(400).json({ success: false, message: 'Seules les demandes terminees peuvent etre archivees' });
    }
    request.is_archived = true;
    request.archived_at = new Date();
    await request.save();
    res.json({ success: true, message: 'Demande archivee' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const restoreRequest = async (req, res) => {
  try {
    const request = await PickupRequest.findOne({ uuid: req.params.uuid });
    if (!request) return res.status(404).json({ success: false, message: 'Demande non trouvee' });
    const allowed = request.user_id.toString() === req.user.id
      || request.collector_id?.toString() === req.user.id;
    if (!allowed) return res.status(403).json({ success: false, message: 'Acces interdit' });
    if (!request.is_archived) return res.status(400).json({ success: false, message: 'Demande non archivee' });
    request.is_archived = false;
    request.archived_at = null;
    await request.save();
    res.json({ success: true, message: 'Demande restauree' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = {
  _internals: { calculateCancellationFee, TRANSITIONS },
  archiveRequest,
  assignCollector,
  cancelRequest,
  createRequest,
  estimatePrice,
  getCompletionCode,
  getCollectorPhoto,
  getProof,
  getRequestById,
  getRequests,
  getServiceSlots,
  restoreRequest,
  updateLocation,
  updateStatus,
  uploadProof,
};
