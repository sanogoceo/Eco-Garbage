const path = require('path');
const crypto = require('crypto');
const { randomUUID: uuidv4 } = crypto;
const CollectorApplication = require('../models/CollectorApplication');
const AuditLog = require('../models/AuditLog');
const { notifyUser } = require('../services/notificationService');
const User = require('../models/User');
const { sendCollectorDecisionEmail } = require('../services/emailService');
const { decrypt, encrypt, fingerprint } = require('../utils/sensitiveData');
const {
  collectorApplicationDir,
  collectorProfilePhotoDir,
} = require('../config/storage');
const {
  deleteStoredFile,
  ENCRYPTION_VERSION,
  readEncryptedFile,
  writeEncryptedFile,
} = require('../utils/secureFileStorage');
const {
  getCollectorDocumentDeleteAt,
} = require('../services/sensitiveDataLifecycle');
const {
  getRenewalReminderDate,
  getVerificationValidUntil,
} = require('../services/collectorVerificationService');
const {
  hasBlockingCollectorAlert,
  recordFraudAlert,
} = require('../services/fraudDetectionService');
const ACTIVE_STATUSES = ['submitted', 'under_review', 'changes_requested'];
const REVIEWABLE_STATUSES = ['submitted', 'under_review'];
const DOCUMENT_TYPES = [
  'profile_photo',
  'id_front',
  'id_back',
  'selfie_with_id',
  'vehicle_photo',
];
const CM_PHONE_REGEX = /^(\+?237)?[62]\d{8}$/;
const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'];
const VEHICLE_TYPES = ['foot', 'motorcycle', 'tricycle', 'car', 'van'];
const TERMS_VERSION = '2026-06-collector-v1';
const NATIONAL_ID_REGEX = /^[A-Z0-9]{8,20}$/;

const isSupportedImage = (file) => {
  if (!file?.buffer || file.buffer.length < 8) return false;
  const isJpeg = file.buffer[0] === 0xff
    && file.buffer[1] === 0xd8
    && file.buffer[2] === 0xff;
  const isPng = file.buffer[0] === 0x89
    && file.buffer[1] === 0x50
    && file.buffer[2] === 0x4e
    && file.buffer[3] === 0x47
    && file.buffer[4] === 0x0d
    && file.buffer[5] === 0x0a
    && file.buffer[6] === 0x1a
    && file.buffer[7] === 0x0a;
  return isJpeg || isPng;
};

const extensionFor = (file) => (
  file.buffer[0] === 0x89 ? '.png' : '.jpg'
);

const saveDocument = async (file) => {
  const effectiveName = await writeEncryptedFile({
    directory: collectorApplicationDir,
    storedName: `${uuidv4()}.enc`,
    buffer: file.buffer,
    context: 'collector-document',
  });
  return {
    stored_name: effectiveName,
    original_name: path.basename(file.originalname || 'document'),
    mime_type: extensionFor(file) === '.png' ? 'image/png' : 'image/jpeg',
    size: file.size,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    encryption_version: ENCRYPTION_VERSION,
    encrypted_at: new Date(),
  };
};

const saveVerifiedProfilePhoto = async (document) => {
  if (!document?.stored_name) {
    throw new Error('Photo de profil de la candidature introuvable');
  }
  const { buffer } = await readEncryptedFile({
    directory: collectorApplicationDir,
    storedName: document.stored_name,
    context: 'collector-document',
    migrateLegacy: false,
  });
  const effectiveName = await writeEncryptedFile({
    directory: collectorProfilePhotoDir,
    storedName: `${uuidv4()}.enc`,
    buffer,
    context: 'collector-profile-photo',
  });
  return {
    stored_name: effectiveName,
    mime_type: document.mime_type,
    size: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    encryption_version: ENCRYPTION_VERSION,
    encrypted_at: new Date(),
    verified_at: new Date(),
  };
};

const deleteSavedDocuments = (documents) => Promise.all(
  Object.values(documents || {})
    .filter((document) => document?.stored_name)
    .map((document) => deleteStoredFile({
      directory: collectorApplicationDir,
      storedName: document.stored_name,
    }))
);

const serializeApplication = (application, includeDetails = false) => {
  const data = application.toObject ? application.toObject() : application;
  const result = {
    id: data._id?.toString(),
    uuid: data.uuid,
    user: data.user_id && typeof data.user_id === 'object'
      ? {
          id: data.user_id._id?.toString(),
          name: data.user_id.name,
          email: data.user_id.email,
          phone: data.user_id.phone,
        }
      : undefined,
    full_name: data.full_name || data.user_id?.name,
    service_area: data.service_area,
    vehicle_type: data.vehicle_type,
    status: data.status,
    application_type: data.application_type || 'initial',
    review_notes: data.review_notes,
    submitted_at: data.submitted_at,
    reviewed_at: data.reviewed_at,
    national_id_expiry_date: data.national_id_expiry_date,
    verification_valid_until: data.verification_valid_until,
    identity_verification: data.identity_verification,
    document_replacement: data.document_replacement?.requested_types?.length
      ? {
          requested_types: data.document_replacement.requested_types,
          reason: data.document_replacement.reason,
          requested_at: data.document_replacement.requested_at,
          completed_at: data.document_replacement.completed_at,
        }
      : undefined,
    documents_delete_at: data.documents_delete_at,
    documents_deleted_at: data.documents_deleted_at,
    created_at: data.created_at,
    documents: {
      profile_photo: !!data.documents?.profile_photo,
      id_front: !!data.documents?.id_front,
      id_back: !!data.documents?.id_back,
      selfie_with_id: !!data.documents?.selfie_with_id,
      vehicle_photo: !!data.documents?.vehicle_photo,
    },
  };

  if (includeDetails) {
    result.phone = data.phone;
    result.birth_date = data.birth_date;
    result.gender = data.gender;
    result.national_id_number = decrypt(data.national_id_number);
    result.city = data.city;
    result.neighborhood = data.neighborhood;
    result.residence_address = data.residence_address || data.address;
    result.emergency_contact = data.emergency_contact;
    result.consent = data.consent
      ? {
          accepted: data.consent.accepted,
          terms_version: data.consent.terms_version,
          accepted_at: data.consent.accepted_at,
        }
      : undefined;
  }

  return result;
};

const submitApplication = async (req, res) => {
  const savedDocuments = {};
  let applicationCreated = false;
  try {
    if (!['user', 'collector'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Ce compte ne peut pas deposer de dossier collecteur.' });
    }
    const applicationType = req.user.role === 'collector' ? 'renewal' : 'initial';

    const existing = await CollectorApplication.findOne({
      user_id: req.user.id,
      status: { $in: ACTIVE_STATUSES },
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Une candidature est deja en cours de verification.' });
    }

    const {
      full_name, birth_date, gender, phone, national_id_number,
      national_id_expiry_date,
      city, neighborhood, residence_address,
      service_area, vehicle_type,
      emergency_contact_name, emergency_contact_phone,
      consent_accepted,
    } = req.body;
    const normalizedPhone = String(phone || '').replace(/[\s\-().]/g, '');
    const normalizedEmergencyPhone = String(emergency_contact_phone || '').replace(/[\s\-().]/g, '');
    const normalizedNationalId = String(national_id_number || '').trim().toUpperCase();
    const parsedBirthDate = new Date(birth_date);
    const parsedNationalIdExpiryDate = new Date(national_id_expiry_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minimumBirthDate = new Date(
      today.getFullYear() - 18,
      today.getMonth(),
      today.getDate()
    );

    if (!full_name?.trim() || full_name.trim().length < 3 || full_name.trim().length > 120) {
      return res.status(400).json({ success: false, message: 'Le nom complet doit contenir entre 3 et 120 caracteres.' });
    }
    if (Number.isNaN(parsedBirthDate.getTime()) || parsedBirthDate > minimumBirthDate) {
      return res.status(400).json({ success: false, message: 'Le candidat doit avoir au moins 18 ans.' });
    }
    if (!GENDERS.includes(gender)) {
      return res.status(400).json({ success: false, message: 'Sexe invalide.' });
    }
    if (!NATIONAL_ID_REGEX.test(normalizedNationalId)) {
      return res.status(400).json({
        success: false,
        message: 'Le numero de CNI est obligatoire et doit contenir entre 8 et 20 lettres ou chiffres.',
      });
    }
    if (
      Number.isNaN(parsedNationalIdExpiryDate.getTime())
      || parsedNationalIdExpiryDate <= today
    ) {
      return res.status(400).json({
        success: false,
        message: 'La date d expiration de la CNI est obligatoire et doit etre future.',
      });
    }
    const maximumNationalIdExpiryDate = new Date(today);
    maximumNationalIdExpiryDate.setFullYear(maximumNationalIdExpiryDate.getFullYear() + 20);
    if (parsedNationalIdExpiryDate > maximumNationalIdExpiryDate) {
      return res.status(400).json({
        success: false,
        message: 'La date d expiration de la CNI semble invalide.',
      });
    }
    if (!CM_PHONE_REGEX.test(normalizedPhone)) {
      return res.status(400).json({ success: false, message: 'Numero de telephone camerounais invalide.' });
    }
    if (!CM_PHONE_REGEX.test(normalizedEmergencyPhone)) {
      return res.status(400).json({ success: false, message: 'Numero du contact d urgence invalide.' });
    }
    if (!emergency_contact_name?.trim() || emergency_contact_name.trim().length < 3) {
      return res.status(400).json({ success: false, message: 'Le nom du contact d urgence est requis.' });
    }
    if (!city?.trim() || !neighborhood?.trim() || !residence_address?.trim() || !service_area?.trim()) {
      return res.status(400).json({ success: false, message: 'La ville, le quartier, l adresse et la zone de collecte sont requis.' });
    }
    if (!VEHICLE_TYPES.includes(vehicle_type)) {
      return res.status(400).json({ success: false, message: 'Moyen de transport invalide.' });
    }
    if (consent_accepted !== 'true') {
      return res.status(400).json({ success: false, message: 'Vous devez accepter les conditions et la politique de confidentialite.' });
    }

    const nationalIdFingerprint = fingerprint(normalizedNationalId);
    const duplicateNationalId = await CollectorApplication.findOne({
      national_id_fingerprint: nationalIdFingerprint,
      user_id: { $ne: req.user.id },
      status: { $in: ['submitted', 'under_review', 'approved'] },
    }).select('_id user_id uuid');
    if (duplicateNationalId) {
      await recordFraudAlert({
        category: 'fake_collector',
        dedupeKey: `duplicate-cni:${req.user.id}:${nationalIdFingerprint}`,
        score: 95,
        title: 'CNI reutilisee pour une candidature collecteur',
        description: 'Le numero de CNI est deja rattache a un autre dossier collecteur.',
        signals: [{
          code: 'duplicate_national_id',
          weight: 95,
          details: { existing_application_uuid: duplicateNationalId.uuid },
        }],
        subjectUserId: req.user.id,
        relatedUserIds: [duplicateNationalId.user_id],
        collectorApplicationId: duplicateNationalId._id,
      });
      return res.status(409).json({
        success: false,
        message: 'Ce numero de CNI est deja associe a un autre dossier.',
      });
    }
    if (
      city.trim().length > 100
      || neighborhood.trim().length > 120
      || residence_address.trim().length > 300
      || service_area.trim().length > 120
      || emergency_contact_name.trim().length > 120
    ) {
      return res.status(400).json({ success: false, message: 'Une ou plusieurs informations sont trop longues.' });
    }

    const requiredFiles = {
      profile_photo: req.files?.profile_photo?.[0],
      id_front: req.files?.id_front?.[0],
      id_back: req.files?.id_back?.[0],
      selfie_with_id: req.files?.selfie_with_id?.[0],
    };
    if (Object.values(requiredFiles).some((file) => !file)) {
      return res.status(400).json({ success: false, message: 'La photo d identite, la CNI recto/verso et le selfie avec CNI sont requis.' });
    }
    const optionalFiles = {
      vehicle_photo: req.files?.vehicle_photo?.[0],
    };
    const providedFiles = [...Object.values(requiredFiles), ...Object.values(optionalFiles).filter(Boolean)];
    if (providedFiles.some((file) => !isSupportedImage(file))) {
      return res.status(400).json({ success: false, message: 'Les documents doivent etre des images JPEG ou PNG valides.' });
    }
    const identityHashes = Object.values(requiredFiles).map(
      (file) => crypto.createHash('sha256').update(file.buffer).digest('hex')
    );
    const identityDocumentPaths = [
      'documents.profile_photo.sha256',
      'documents.id_front.sha256',
      'documents.id_back.sha256',
      'documents.selfie_with_id.sha256',
    ];
    const duplicateDocument = await CollectorApplication.findOne({
      user_id: { $ne: req.user.id },
      status: { $in: ['submitted', 'under_review', 'approved'] },
      $or: identityDocumentPaths.flatMap((documentPath) => (
        identityHashes.map((sha256) => ({ [documentPath]: sha256 }))
      )),
    }).select('_id user_id uuid');
    if (duplicateDocument) {
      await recordFraudAlert({
        category: 'fake_collector',
        dedupeKey: `duplicate-document:${req.user.id}:${identityHashes.sort().join(':')}`,
        score: 90,
        title: 'Pieces collecteur reutilisees',
        description: 'Une ou plusieurs photos d identite sont identiques a un autre dossier.',
        signals: [{
          code: 'duplicate_identity_document',
          weight: 90,
          details: { existing_application_uuid: duplicateDocument.uuid },
        }],
        subjectUserId: req.user.id,
        relatedUserIds: [duplicateDocument.user_id],
        collectorApplicationId: duplicateDocument._id,
      });
      return res.status(409).json({
        success: false,
        message: 'Une ou plusieurs pieces sont deja associees a un autre dossier.',
      });
    }

    for (const [key, file] of Object.entries({
      ...requiredFiles,
      ...optionalFiles,
    })) {
      if (file) savedDocuments[key] = await saveDocument(file);
    }

    const previousApprovedApplication = applicationType === 'renewal'
      ? await CollectorApplication.findOne({
          user_id: req.user.id,
          status: 'approved',
        }).select('_id').sort({ reviewed_at: -1, created_at: -1 }).lean()
      : null;

    const application = await CollectorApplication.create({
      uuid: uuidv4(),
      user_id: req.user.id,
      application_type: applicationType,
      renewal_of: previousApprovedApplication?._id,
      full_name: full_name.trim(),
      birth_date: parsedBirthDate,
      gender,
      national_id_number: encrypt(normalizedNationalId),
      national_id_fingerprint: nationalIdFingerprint,
      national_id_expiry_date: parsedNationalIdExpiryDate,
      phone: normalizedPhone,
      city: city.trim(),
      neighborhood: neighborhood.trim(),
      residence_address: residence_address.trim(),
      service_area: service_area.trim(),
      vehicle_type,
      emergency_contact: {
        name: emergency_contact_name.trim(),
        phone: normalizedEmergencyPhone,
      },
      consent: {
        accepted: true,
        terms_version: TERMS_VERSION,
        accepted_at: new Date(),
      },
      documents: savedDocuments,
      status: 'submitted',
    });
    applicationCreated = true;

    try {
      const admins = await User.find({ role: 'admin', is_active: true }).select('_id').lean();
      await Promise.all([
        User.findByIdAndUpdate(req.user.id, {
          $set: {
            name: full_name.trim(),
            phone: normalizedPhone,
            address: residence_address.trim(),
          },
        }),
        notifyUser({
          userId: req.user.id,
          title: applicationType === 'renewal'
            ? 'Renouvellement collecteur envoye'
            : 'Candidature collecteur envoyee',
          message: applicationType === 'renewal'
            ? 'Votre dossier de renouvellement a ete transmis a l administration.'
            : 'Votre dossier a ete transmis a l administration pour verification.',
          type: 'collector_application',
          data: {
            target_path: applicationType === 'renewal'
              ? '/collector/verification'
              : '/dashboard/become-collector',
          },
        }),
        admins.length
          ? Promise.all(admins.map((admin) => notifyUser({
              userId: admin._id,
              title: applicationType === 'renewal'
                ? 'Renouvellement collecteur a verifier'
                : 'Nouvelle candidature collecteur',
              message: applicationType === 'renewal'
                ? 'Un dossier de renouvellement collecteur attend votre verification.'
                : 'Un nouveau dossier collecteur attend votre verification.',
              type: 'collector_application',
              data: { target_path: '/admin/collector-applications' },
            })))
          : Promise.resolve(),
      ]);
    } catch (sideEffectError) {
      console.error('Application submission side effect error:', sideEffectError);
    }

    res.status(201).json({
      success: true,
      message: 'Votre candidature a ete envoyee.',
      data: serializeApplication(application),
    });
  } catch (err) {
    if (!applicationCreated) await deleteSavedDocuments(savedDocuments);
    console.error('submitApplication error:', err);
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Une candidature est deja en cours de verification.' });
    }
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getCurrentApplication = async (req, res) => {
  try {
    const [application, user] = await Promise.all([
      CollectorApplication.findOne({ user_id: req.user.id })
        .sort({ created_at: -1 }),
      User.findById(req.user.id)
        .select('role collector_profile.verification_expires_at collector_profile.renewal_status')
        .lean(),
    ]);
    const data = application ? serializeApplication(application) : null;
    if (data && user?.role === 'collector') {
      const validUntil = user.collector_profile?.verification_expires_at
        || application.verification_valid_until;
      data.renewal = {
        valid_until: validUntil,
        status: user.collector_profile?.renewal_status || 'current',
        eligible: !validUntil || getRenewalReminderDate(validUntil) <= new Date(),
        required: !validUntil || new Date(validUntil) <= new Date(),
      };
    }
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getApplications = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const filter = status ? { status } : {};
    const [applications, total] = await Promise.all([
      CollectorApplication.find(filter)
        .populate('user_id', 'name email phone')
        .sort({ submitted_at: -1 })
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit),
      CollectorApplication.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: applications.map((application) => serializeApplication(application)),
      pagination: { total, page: parsedPage, limit: parsedLimit },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const requestDocumentReplacement = async (req, res) => {
  try {
    const requestedTypes = [...new Set(
      Array.isArray(req.body.document_types) ? req.body.document_types : []
    )];
    const reason = String(req.body.reason || '').trim();
    if (
      requestedTypes.length < 1
      || requestedTypes.some((type) => !DOCUMENT_TYPES.includes(type))
    ) {
      return res.status(400).json({
        success: false,
        message: 'Selectionnez au moins un document valide a remplacer.',
      });
    }
    if (reason.length < 10 || reason.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Le motif doit contenir entre 10 et 1000 caracteres.',
      });
    }

    const application = await CollectorApplication.findOneAndUpdate(
      {
        uuid: req.params.uuid,
        status: { $in: ['submitted', 'under_review'] },
      },
      {
        $set: {
          status: 'changes_requested',
          review_notes: reason,
          document_replacement: {
            requested_types: requestedTypes,
            reason,
            requested_by: req.user.id,
            requested_at: new Date(),
          },
        },
      },
      { new: true }
    ).populate('user_id', 'name email role');

    if (!application) {
      return res.status(409).json({
        success: false,
        message: 'Ce dossier ne peut plus recevoir une demande de remplacement.',
      });
    }

    const sideEffects = await Promise.allSettled([
      notifyUser({
        userId: application.user_id._id,
        title: 'Documents collecteur a remplacer',
        message: reason,
        type: 'collector_application',
        priority: 'high',
        data: {
          target_path: application.user_id.role === 'collector'
            ? '/collector/verification'
            : '/dashboard/become-collector',
          application_uuid: application.uuid,
          document_types: requestedTypes,
        },
      }),
      AuditLog.create({
        actor_id: req.user.id,
        action: 'collector_application.document_replacement_requested',
        target_type: 'CollectorApplication',
        target_id: application._id,
        metadata: {
          applicant_id: application.user_id._id,
          document_types: requestedTypes,
          notes: reason,
        },
        ip: req.ip,
        user_agent: req.get('user-agent'),
      }),
    ]);
    sideEffects
      .filter((result) => result.status === 'rejected')
      .forEach((result) => console.error(
        'requestDocumentReplacement side effect error:',
        result.reason
      ));

    return res.json({
      success: true,
      message: 'Demande de remplacement envoyee.',
      data: serializeApplication(application),
    });
  } catch (error) {
    console.error('requestDocumentReplacement error:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const replaceDocuments = async (req, res) => {
  const savedDocuments = {};
  let replacementCommitted = false;
  try {
    const application = await CollectorApplication.findOne({
      uuid: req.params.uuid,
      user_id: req.user.id,
      status: 'changes_requested',
    });
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Aucune demande de remplacement active pour ce dossier.',
      });
    }

    const requestedTypes = application.document_replacement?.requested_types || [];
    if (!requestedTypes.length) {
      return res.status(409).json({
        success: false,
        message: 'La liste des documents a remplacer est vide.',
      });
    }

    const uploadedFiles = Object.fromEntries(
      DOCUMENT_TYPES
        .map((type) => [type, req.files?.[type]?.[0]])
        .filter(([, file]) => file)
    );
    if (
      requestedTypes.some((type) => !uploadedFiles[type])
      || Object.keys(uploadedFiles).some((type) => !requestedTypes.includes(type))
    ) {
      return res.status(400).json({
        success: false,
        message: 'Envoyez uniquement toutes les pieces demandees.',
      });
    }
    if (Object.values(uploadedFiles).some((file) => !isSupportedImage(file))) {
      return res.status(400).json({
        success: false,
        message: 'Les documents doivent etre des images JPEG ou PNG valides.',
      });
    }

    for (const [type, file] of Object.entries(uploadedFiles)) {
      savedDocuments[type] = await saveDocument(file);
    }

    const previousDocuments = Object.fromEntries(
      requestedTypes.map((type) => [type, application.documents?.[type]?.toObject
        ? application.documents[type].toObject()
        : application.documents?.[type]])
    );
    const setOperations = {
      status: 'submitted',
      review_notes: null,
      'document_replacement.completed_at': new Date(),
    };
    for (const [type, document] of Object.entries(savedDocuments)) {
      setOperations[`documents.${type}`] = document;
    }
    const updated = await CollectorApplication.findOneAndUpdate(
      {
        _id: application._id,
        status: 'changes_requested',
      },
      {
        $set: setOperations,
        $unset: {
          'document_replacement.requested_types': 1,
          'document_replacement.reason': 1,
          'document_replacement.requested_by': 1,
          'document_replacement.requested_at': 1,
        },
      },
      { new: true }
    );
    if (!updated) {
      await deleteSavedDocuments(savedDocuments);
      return res.status(409).json({
        success: false,
        message: 'Le dossier a ete modifie. Rechargez la page.',
      });
    }
    replacementCommitted = true;

    await Promise.all(
      Object.values(previousDocuments)
        .filter((document) => document?.stored_name)
        .map((document) => deleteStoredFile({
          directory: collectorApplicationDir,
          storedName: document.stored_name,
        }).catch(() => {}))
    );

    const admins = await User.find({ role: 'admin', is_active: true })
      .select('_id')
      .lean();
    const sideEffects = await Promise.allSettled([
      ...admins.map((admin) => notifyUser({
        userId: admin._id,
        title: 'Documents collecteur remplaces',
        message: 'Le candidat a fourni les nouvelles pieces demandees.',
        type: 'collector_application',
        data: {
          target_path: '/admin/collector-applications',
          application_uuid: application.uuid,
        },
      })),
      AuditLog.create({
        actor_id: req.user.id,
        action: 'collector_application.document_replacement_completed',
        target_type: 'CollectorApplication',
        target_id: application._id,
        metadata: { document_types: requestedTypes },
        ip: req.ip,
        user_agent: req.get('user-agent'),
      }),
    ]);
    sideEffects
      .filter((result) => result.status === 'rejected')
      .forEach((result) => console.error(
        'replaceDocuments side effect error:',
        result.reason
      ));

    return res.json({
      success: true,
      message: 'Les documents ont ete remplaces.',
      data: serializeApplication(updated),
    });
  } catch (error) {
    if (!replacementCommitted) {
      await deleteSavedDocuments(savedDocuments);
    }
    console.error('replaceDocuments error:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getApplication = async (req, res) => {
  try {
    const application = await CollectorApplication.findOne({ uuid: req.params.uuid })
      .select('+national_id_number')
      .populate('user_id', 'name email phone');
    if (!application) {
      return res.status(404).json({ success: false, message: 'Candidature introuvable.' });
    }
    res.json({ success: true, data: serializeApplication(application, true) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const reviewApplication = async (req, res) => {
  try {
    const { decision, notes, identity_verification: identityVerification } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision invalide.' });
    }
    if (decision === 'rejected' && !notes?.trim()) {
      return res.status(400).json({ success: false, message: 'Un motif de refus est requis.' });
    }
    if (notes && notes.trim().length > 1000) {
      return res.status(400).json({ success: false, message: 'La note de decision est trop longue.' });
    }

    let candidate;
    if (decision === 'approved') {
      candidate = await CollectorApplication.findOne({
        uuid: req.params.uuid,
        status: { $in: REVIEWABLE_STATUSES },
      }).select('_id user_id national_id_expiry_date');
      if (!candidate) {
        return res.status(409).json({
          success: false,
          message: 'Ce dossier a deja ete traite ou n existe pas.',
        });
      }
      const requiredChecks = [
        'profile_matches_selfie',
        'selfie_matches_id',
        'id_readable',
        'id_not_expired',
      ];
      if (
        !identityVerification
        || requiredChecks.some((check) => identityVerification[check] !== true)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Toutes les verifications d identite doivent etre confirmees avant approbation.',
        });
      }
      if (
        !candidate.national_id_expiry_date
        || candidate.national_id_expiry_date <= new Date()
      ) {
        return res.status(400).json({
          success: false,
          message: 'La CNI est expiree ou sa date d expiration est absente.',
        });
      }
      const blockingAlert = await hasBlockingCollectorAlert({
        userId: candidate.user_id,
        applicationId: candidate._id,
      });
      if (blockingAlert) {
        await CollectorApplication.updateOne(
          { _id: candidate._id, status: { $in: REVIEWABLE_STATUSES } },
          {
            $set: {
              status: 'under_review',
              review_notes: 'Validation suspendue par le controle antifraude.',
            },
          }
        );
        return res.status(409).json({
          success: false,
          message: 'Une alerte antifraude elevee doit etre traitee avant approbation.',
        });
      }
    }

    const reviewedAt = new Date();
    const standardVerificationValidUntil = decision === 'approved'
      ? getVerificationValidUntil(reviewedAt)
      : undefined;
    const verificationValidUntil = decision === 'approved'
      ? new Date(Math.min(
          standardVerificationValidUntil.getTime(),
          candidate.national_id_expiry_date.getTime()
        ))
      : undefined;
    const application = await CollectorApplication.findOneAndUpdate(
      { uuid: req.params.uuid, status: { $in: REVIEWABLE_STATUSES } },
      {
        $set: {
          status: decision,
          review_notes: notes?.trim(),
          reviewed_by: req.user.id,
          reviewed_at: reviewedAt,
          documents_delete_at: getCollectorDocumentDeleteAt(decision, reviewedAt),
          ...(decision === 'approved' ? {
            verification_valid_until: verificationValidUntil,
            identity_verification: {
              profile_matches_selfie: true,
              selfie_matches_id: true,
              id_readable: true,
              id_not_expired: true,
              method: 'manual',
              checked_by: req.user.id,
              checked_at: reviewedAt,
            },
          } : {}),
        },
      },
      { new: true }
    ).populate('user_id', 'name email role');

    if (!application) {
      return res.status(409).json({ success: false, message: 'Ce dossier a deja ete traite ou n existe pas.' });
    }

    if (decision === 'approved') {
      let verifiedProfilePhoto;
      let previousProfilePhoto;
      try {
        const existingUser = await User.findById(application.user_id._id)
          .select('collector_profile.profile_photo')
          .lean();
        previousProfilePhoto = existingUser?.collector_profile?.profile_photo;
        verifiedProfilePhoto = await saveVerifiedProfilePhoto(
          application.documents?.profile_photo
        );
        const collectorProfileUpdate = {
            role: 'collector',
            phone: application.phone,
            address: application.residence_address || application.address,
            'collector_profile.vehicle_type': application.vehicle_type,
            'collector_profile.service_area': application.service_area,
            'collector_profile.service_zones': [application.service_area],
            'collector_profile.is_available': false,
            'collector_profile.verification_status': 'verified',
            'collector_profile.verification_notes': notes?.trim(),
            'collector_profile.profile_photo': verifiedProfilePhoto,
            'collector_profile.verification_expires_at': verificationValidUntil,
            'collector_profile.renewal_status': 'current',
            'collector_profile.renewal_notified_at': null,
        };
        if ((application.application_type || 'initial') === 'initial') {
          collectorProfileUpdate['collector_profile.rating_avg'] = 0;
          collectorProfileUpdate['collector_profile.total_collections'] = 0;
        }
        await User.findByIdAndUpdate(application.user_id._id, {
          $set: collectorProfileUpdate,
        });
        if (previousProfilePhoto?.stored_name) {
          deleteStoredFile({
            directory: collectorProfilePhotoDir,
            storedName: previousProfilePhoto.stored_name,
          }).catch(() => {});
        }
      } catch (userUpdateError) {
        if (verifiedProfilePhoto?.stored_name) {
          await deleteStoredFile({
            directory: collectorProfilePhotoDir,
            storedName: verifiedProfilePhoto.stored_name,
          }).catch(() => {});
        }
        await CollectorApplication.findByIdAndUpdate(application._id, {
          $set: {
            status: 'submitted',
            review_notes: null,
            reviewed_by: null,
            reviewed_at: null,
            documents_delete_at: null,
            verification_valid_until: null,
            identity_verification: null,
          },
        });
        throw userUpdateError;
      }
    }

    const approved = decision === 'approved';
    try {
      await notifyUser({
        userId: application.user_id._id,
        title: approved ? 'Candidature approuvee' : 'Candidature refusee',
        message: approved
          ? (
            application.application_type === 'renewal'
              ? 'Votre verification collecteur a ete renouvelee.'
              : 'Votre compte est maintenant active comme collecteur.'
          )
          : `Votre candidature a ete refusee. Motif : ${notes.trim()}`,
        type: 'collector_application',
        data: {
          target_path: approved
            ? '/collector'
            : (
              application.application_type === 'renewal'
                ? '/collector/verification'
                : '/dashboard/become-collector'
            ),
        },
      });
    } catch (notificationError) {
      console.error('Collector decision notification error:', notificationError);
    }

    if (process.env.MAIL_HOST && process.env.MAIL_USER) {
      try {
        await sendCollectorDecisionEmail(
          application.user_id.email,
          application.user_id.name,
          decision,
          notes?.trim()
        );
      } catch (mailError) {
        console.error('Collector decision email error:', mailError);
      }
    }

    try {
      await AuditLog.create({
        actor_id: req.user.id,
        action: `collector_application.${decision}`,
        target_type: 'CollectorApplication',
        target_id: application._id,
        metadata: { applicant_id: application.user_id._id, notes: notes?.trim() || null },
        ip: req.ip,
        user_agent: req.get('user-agent'),
      });
    } catch (auditError) {
      console.error('Collector decision audit error:', auditError);
    }

    res.json({
      success: true,
      message: approved ? 'Candidature approuvee.' : 'Candidature refusee.',
      data: serializeApplication(application),
    });
  } catch (err) {
    console.error('reviewApplication error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getDocument = async (req, res) => {
  try {
    if (!DOCUMENT_TYPES.includes(req.params.type)) {
      return res.status(400).json({ success: false, message: 'Type de document invalide.' });
    }
    const application = await CollectorApplication.findOne({ uuid: req.params.uuid });
    if (!application) {
      return res.status(404).json({ success: false, message: 'Candidature introuvable.' });
    }
    const document = application.documents?.[req.params.type];
    if (!document?.stored_name) {
      return res.status(404).json({ success: false, message: 'Document introuvable.' });
    }
    const { buffer, migrated } = await readEncryptedFile({
      directory: collectorApplicationDir,
      storedName: document.stored_name,
      context: 'collector-document',
    });
    if (migrated) {
      document.encryption_version = ENCRYPTION_VERSION;
      document.encrypted_at = new Date();
      await application.save();
    }
    await AuditLog.create({
      actor_id: req.user.id,
      action: 'collector_application.document_viewed',
      target_type: 'CollectorApplication',
      target_id: application._id,
      metadata: { document_type: req.params.type },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    res.type(document.mime_type);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Disposition', 'inline');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = {
  submitApplication,
  getCurrentApplication,
  getApplications,
  getApplication,
  replaceDocuments,
  requestDocumentReplacement,
  reviewApplication,
  getDocument,
};
