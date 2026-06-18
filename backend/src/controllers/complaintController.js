const crypto = require('crypto');
const path = require('path');
const Complaint = require('../models/Complaint');
const ComplaintMessage = require('../models/ComplaintMessage');
const PickupRequest = require('../models/PickupRequest');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { complaintEvidenceDir } = require('../config/storage');
const {
  deleteStoredFile,
  ENCRYPTION_VERSION,
  readEncryptedFile,
  writeEncryptedFile,
} = require('../utils/secureFileStorage');
const { notifyUser } = require('../services/notificationService');
const { getComplaintEvidenceDeleteAt } = require('../services/sensitiveDataLifecycle');

const TYPES = [
  'missed_pickup',
  'incorrect_pricing',
  'collector_misconduct',
  'service_quality',
  'damaged_property',
  'payment_issue',
  'other',
];
const REVIEW_STATUSES = ['in_review', 'awaiting_user', 'awaiting_collector'];
const DECISION_STATUSES = ['resolved', 'closed'];
const OUTCOMES = ['upheld', 'rejected', 'partial', 'refund', 'warning', 'no_action'];

const isSupportedImage = (file) => {
  if (!file?.buffer || !['image/jpeg', 'image/png'].includes(file.mimetype)) return false;
  const jpeg = file.buffer[0] === 0xff
    && file.buffer[1] === 0xd8
    && file.buffer[2] === 0xff;
  const png = file.buffer.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
  return jpeg || png;
};

const saveEvidence = async (file, userId) => {
  const effectiveName = await writeEncryptedFile({
    directory: complaintEvidenceDir,
    storedName: `${crypto.randomUUID()}.enc`,
    buffer: file.buffer,
    context: 'complaint-evidence',
  });
  return {
    stored_name: effectiveName,
    original_name: path.basename(file.originalname || 'preuve'),
    mime_type: file.buffer[0] === 0x89 ? 'image/png' : 'image/jpeg',
    size: file.size,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    encryption_version: ENCRYPTION_VERSION,
    encrypted_at: new Date(),
    uploaded_by: userId,
  };
};

const deleteEvidenceFiles = (evidence = []) => Promise.all(
  evidence.map((item) => deleteStoredFile({
    directory: complaintEvidenceDir,
    storedName: item.stored_name,
  }))
);

const getRequestParticipants = (request) => [
  request?.user_id?._id || request?.user_id,
  request?.collector_id?._id || request?.collector_id,
].filter(Boolean).map(String);

const canAccessComplaint = (complaint, user) => {
  if (user.role === 'admin') return true;
  if (String(complaint.user_id?._id || complaint.user_id) === user.id) return true;
  return getRequestParticipants(complaint.request_id).includes(user.id);
};

const getComplaintForAccess = async (uuid, user) => {
  const complaint = await Complaint.findOne({ uuid })
    .populate('user_id', 'name email role')
    .populate({
      path: 'request_id',
      select: 'uuid user_id collector_id status address created_at',
      populate: [
        { path: 'user_id', select: 'name email role' },
        { path: 'collector_id', select: 'name email role' },
      ],
    })
    .populate('decision.decided_by', 'name email role');
  if (!complaint || !canAccessComplaint(complaint, user)) return null;
  return complaint;
};

const serializeComplaint = (complaint) => {
  const data = complaint.toObject ? complaint.toObject() : complaint;
  const request = data.request_id;
  return {
    id: data._id?.toString(),
    uuid: data.uuid,
    type: data.type,
    description: data.description,
    status: data.status,
    admin_response: data.admin_response,
    created_at: data.created_at,
    updated_at: data.updated_at,
    last_message_at: data.last_message_at,
    resolved_at: data.resolved_at,
    closed_at: data.closed_at,
    complainant: data.user_id && typeof data.user_id === 'object'
      ? {
          id: data.user_id._id?.toString(),
          name: data.user_id.name,
          email: data.user_id.email,
          role: data.user_id.role,
        }
      : undefined,
    request: request && typeof request === 'object'
      ? {
          id: request._id?.toString(),
          uuid: request.uuid,
          status: request.status,
          address: request.address,
          created_at: request.created_at,
          user: request.user_id && typeof request.user_id === 'object'
            ? {
                id: request.user_id._id?.toString(),
                name: request.user_id.name,
                role: request.user_id.role,
              }
            : undefined,
          collector: request.collector_id && typeof request.collector_id === 'object'
            ? {
                id: request.collector_id._id?.toString(),
                name: request.collector_id.name,
                role: request.collector_id.role,
              }
            : undefined,
        }
      : undefined,
    evidence: (data.evidence || []).map((item) => ({
      id: item._id?.toString(),
      original_name: item.original_name,
      mime_type: item.mime_type,
      size: item.size,
      uploaded_at: item.uploaded_at,
      uploaded_by: item.uploaded_by?.toString(),
    })),
    decision: data.decision?.outcome
      ? {
          outcome: data.decision.outcome,
          summary: data.decision.summary,
          compensation_amount: data.decision.compensation_amount || 0,
          decided_at: data.decision.decided_at,
          decided_by: data.decision.decided_by && typeof data.decision.decided_by === 'object'
            ? {
                id: data.decision.decided_by._id?.toString(),
                name: data.decision.decided_by.name,
              }
            : undefined,
        }
      : undefined,
  };
};

const notifyParticipants = async (complaint, actorId, title, message) => {
  const ids = new Set([
    String(complaint.user_id?._id || complaint.user_id),
    ...getRequestParticipants(complaint.request_id),
  ]);
  ids.delete(String(actorId));
  const results = await Promise.allSettled([...ids].map((userId) => notifyUser({
    userId,
    title,
    message,
    type: 'complaint',
    data: {
      complaint_uuid: complaint.uuid,
      target_path: userId === String(complaint.request_id?.collector_id?._id
        || complaint.request_id?.collector_id)
        ? '/collector/complaints'
        : '/dashboard/complaints',
    },
  })));
  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.warn('notifyParticipants failed', result.reason);
    }
  });
};

const notifyAdministrators = async (actorId, title, message, complaintUuid) => {
  const admins = await User.find({
    role: 'admin',
    is_active: true,
    _id: { $ne: actorId },
  }).select('_id').lean();
  const results = await Promise.allSettled(admins.map((admin) => notifyUser({
    userId: admin._id,
    title,
    message,
    type: 'complaint',
    data: { complaint_uuid: complaintUuid, target_path: '/admin/complaints' },
  })));
  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.warn('notifyAdministrators failed', result.reason);
    }
  });
};

const getEligibleRequests = async (req, res) => {
  try {
    const collectorPerspective = req.user.role === 'collector'
      && req.query.perspective !== 'user';
    const filter = collectorPerspective
      ? { collector_id: req.user.id }
      : { user_id: req.user.id };
    const requests = await PickupRequest.find(filter)
      .select('uuid status address created_at user_id collector_id')
      .populate('user_id', 'name')
      .populate('collector_id', 'name')
      .sort({ created_at: -1 })
      .limit(50)
      .lean();
    res.json({
      success: true,
      data: requests.map((request) => ({
        uuid: request.uuid,
        status: request.status,
        address: request.address,
        created_at: request.created_at,
        user_name: request.user_id?.name,
        collector_name: request.collector_id?.name,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const createComplaint = async (req, res) => {
  const savedEvidence = [];
  try {
    const requestUuid = String(req.body.request_uuid || '').trim();
    const type = String(req.body.type || 'other').trim();
    const description = String(req.body.description || '').trim();
    if (!requestUuid) {
      return res.status(400).json({ success: false, message: 'La collecte concernee est obligatoire' });
    }
    if (!TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: 'Type de litige invalide' });
    }
    if (description.length < 20 || description.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'La description doit contenir entre 20 et 2000 caracteres',
      });
    }
    const request = await PickupRequest.findOne({ uuid: requestUuid })
      .select('user_id collector_id status');
    if (!request || !getRequestParticipants(request).includes(req.user.id)) {
      return res.status(404).json({ success: false, message: 'Collecte associee introuvable' });
    }
    if ((req.files || []).some((file) => !isSupportedImage(file))) {
      return res.status(400).json({
        success: false,
        message: 'Les preuves doivent etre des images JPEG ou PNG valides',
      });
    }
    const duplicate = await Complaint.findOne({
      user_id: req.user.id,
      request_id: request._id,
      status: { $nin: ['resolved', 'closed'] },
    }).select('uuid');
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: 'Un litige actif existe deja pour cette collecte',
        data: { uuid: duplicate.uuid },
      });
    }

    for (const file of req.files || []) {
      savedEvidence.push(await saveEvidence(file, req.user.id));
    }
    const complaint = await Complaint.create({
      uuid: crypto.randomUUID(),
      user_id: req.user.id,
      request_id: request._id,
      type,
      description,
      evidence: savedEvidence,
      last_message_at: new Date(),
    });
    await ComplaintMessage.create({
      uuid: crypto.randomUUID(),
      complaint_id: complaint._id,
      sender_id: req.user.id,
      body: description,
    });
    await notifyAdministrators(
      req.user.id,
      'Nouveau litige',
      `${req.user.name} a ouvert un litige lie a une collecte.`,
      complaint.uuid
    );
    res.status(201).json({
      success: true,
      message: 'Litige enregistre',
      data: { uuid: complaint.uuid },
    });
  } catch (error) {
    await deleteEvidenceFiles(savedEvidence).catch(() => {});
    console.error('createComplaint error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getMyComplaints = async (req, res) => {
  try {
    const collectorPerspective = req.user.role === 'collector'
      && req.query.perspective !== 'user';
    const requestFilter = collectorPerspective
      ? { collector_id: req.user.id }
      : { user_id: req.user.id };
    const requestIds = await PickupRequest.find(requestFilter).distinct('_id');
    const complaintFilter = collectorPerspective
      ? { request_id: { $in: requestIds } }
      : { user_id: req.user.id };
    const complaints = await Complaint.find(complaintFilter)
      .populate('user_id', 'name email role')
      .populate({
        path: 'request_id',
        select: 'uuid user_id collector_id status address created_at',
        populate: [
          { path: 'user_id', select: 'name role' },
          { path: 'collector_id', select: 'name role' },
        ],
      })
      .populate('decision.decided_by', 'name')
      .sort({ last_message_at: -1, created_at: -1 });
    res.json({ success: true, data: complaints.map(serializeComplaint) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getComplaint = async (req, res) => {
  try {
    const complaint = await getComplaintForAccess(req.params.uuid, req.user);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Litige introuvable' });
    }
    res.json({ success: true, data: serializeComplaint(complaint) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getMessages = async (req, res) => {
  try {
    const complaint = await getComplaintForAccess(req.params.uuid, req.user);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Litige introuvable' });
    }
    const messages = await ComplaintMessage.find({ complaint_id: complaint._id })
      .populate('sender_id', 'name role')
      .sort({ created_at: 1 })
      .limit(200)
      .lean();
    res.json({
      success: true,
      data: messages.map((message) => ({
        id: message._id.toString(),
        uuid: message.uuid,
        body: message.body,
        message_type: message.message_type,
        created_at: message.created_at,
        sender: {
          id: message.sender_id?._id?.toString(),
          name: message.sender_id?.name,
          role: message.sender_id?.role,
        },
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const sendMessage = async (req, res) => {
  try {
    const complaint = await getComplaintForAccess(req.params.uuid, req.user);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Litige introuvable' });
    }
    if (complaint.status === 'closed') {
      return res.status(409).json({ success: false, message: 'Ce litige est ferme' });
    }
    const body = String(req.body.body || '').trim();
    if (!body || body.length > 1500) {
      return res.status(400).json({
        success: false,
        message: 'Le message doit contenir entre 1 et 1500 caracteres',
      });
    }
    const message = await ComplaintMessage.create({
      uuid: crypto.randomUUID(),
      complaint_id: complaint._id,
      sender_id: req.user.id,
      body,
    });
    complaint.last_message_at = message.created_at;
    await complaint.save();
    if (req.user.role === 'admin') {
      await notifyParticipants(
        complaint,
        req.user.id,
        'Nouveau message sur votre litige',
        body.length > 120 ? `${body.slice(0, 117)}...` : body
      );
    } else {
      await Promise.all([
        notifyAdministrators(
          req.user.id,
          'Nouveau message sur un litige',
          body.length > 120 ? `${body.slice(0, 117)}...` : body,
          complaint.uuid
        ),
        notifyParticipants(
          complaint,
          req.user.id,
          'Nouveau message sur un litige',
          body.length > 120 ? `${body.slice(0, 117)}...` : body
        ),
      ]);
    }
    res.status(201).json({ success: true, data: { uuid: message.uuid } });
  } catch (error) {
    console.error('sendComplaintMessage error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const addEvidence = async (req, res) => {
  const savedEvidence = [];
  try {
    const complaint = await getComplaintForAccess(req.params.uuid, req.user);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Litige introuvable' });
    }
    if (complaint.status === 'closed') {
      return res.status(409).json({ success: false, message: 'Ce litige est ferme' });
    }
    if (!req.files?.length) {
      return res.status(400).json({ success: false, message: 'Ajoutez au moins une photo' });
    }
    if (complaint.evidence.length + req.files.length > 8) {
      return res.status(400).json({ success: false, message: 'Maximum 8 photos par litige' });
    }
    if (req.files.some((file) => !isSupportedImage(file))) {
      return res.status(400).json({
        success: false,
        message: 'Les preuves doivent etre des images JPEG ou PNG valides',
      });
    }
    for (const file of req.files) {
      savedEvidence.push(await saveEvidence(file, req.user.id));
    }
    complaint.evidence.push(...savedEvidence);
    complaint.last_message_at = new Date();
    await complaint.save();
    res.status(201).json({
      success: true,
      message: 'Preuves ajoutees',
      data: serializeComplaint(complaint),
    });
  } catch (error) {
    await deleteEvidenceFiles(savedEvidence).catch(() => {});
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getEvidence = async (req, res) => {
  try {
    const complaint = await getComplaintForAccess(req.params.uuid, req.user);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Litige introuvable' });
    }
    const evidence = complaint.evidence.id(req.params.evidenceId);
    if (!evidence) {
      return res.status(404).json({ success: false, message: 'Preuve introuvable' });
    }
    const { buffer } = await readEncryptedFile({
      directory: complaintEvidenceDir,
      storedName: evidence.stored_name,
      context: 'complaint-evidence',
    });
    await AuditLog.create({
      actor_id: req.user.id,
      action: 'complaint.evidence_viewed',
      target_type: 'Complaint',
      target_id: complaint._id,
      metadata: {
        complaint_uuid: complaint.uuid,
        evidence_id: evidence._id.toString(),
      },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    res.type(evidence.mime_type);
    res.set('Cache-Control', 'private, no-store');
    res.send(buffer);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return res.status(404).json({ success: false, message: 'Preuve indisponible' });
    }
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getAdminComplaints = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const filter = {};
    const status = String(req.query.status || '').trim();
    if (status) {
      const statuses = ['open', ...REVIEW_STATUSES, ...DECISION_STATUSES];
      if (!statuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Statut invalide' });
      }
      filter.status = status;
    }
    const [complaints, total] = await Promise.all([
      Complaint.find(filter)
        .populate('user_id', 'name email role')
        .populate({
          path: 'request_id',
          select: 'uuid user_id collector_id status address created_at',
          populate: [
            { path: 'user_id', select: 'name role' },
            { path: 'collector_id', select: 'name role' },
          ],
        })
        .populate('decision.decided_by', 'name')
        .sort({ last_message_at: -1, created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Complaint.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: complaints.map(serializeComplaint),
      pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const updateReviewStatus = async (req, res) => {
  try {
    const status = String(req.body.status || '').trim();
    if (!REVIEW_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Statut de suivi invalide' });
    }
    const complaint = await getComplaintForAccess(req.params.uuid, req.user);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Litige introuvable' });
    }
    complaint.status = status;
    complaint.last_message_at = new Date();
    await complaint.save();
    const labels = {
      in_review: 'Le dossier est en cours d analyse.',
      awaiting_user: 'Des informations sont attendues de la part du client.',
      awaiting_collector: 'Des informations sont attendues de la part du collecteur.',
    };
    await ComplaintMessage.create({
      uuid: crypto.randomUUID(),
      complaint_id: complaint._id,
      sender_id: req.user.id,
      body: labels[status],
      message_type: 'status',
    });
    await notifyParticipants(complaint, req.user.id, 'Mise a jour du litige', labels[status]);
    res.json({ success: true, message: 'Statut mis a jour', data: serializeComplaint(complaint) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const decideComplaint = async (req, res) => {
  try {
    const status = String(req.body.status || 'resolved').trim();
    const outcome = String(req.body.outcome || '').trim();
    const summary = String(req.body.summary || req.body.admin_response || '').trim();
    const compensationAmount = Number(req.body.compensation_amount || 0);
    if (!DECISION_STATUSES.includes(status) || !OUTCOMES.includes(outcome)) {
      return res.status(400).json({ success: false, message: 'Decision invalide' });
    }
    if (summary.length < 10 || summary.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'La justification doit contenir entre 10 et 2000 caracteres',
      });
    }
    if (!Number.isFinite(compensationAmount) || compensationAmount < 0 || compensationAmount > 10000000) {
      return res.status(400).json({ success: false, message: 'Montant de compensation invalide' });
    }
    const complaint = await getComplaintForAccess(req.params.uuid, req.user);
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Litige introuvable' });
    }
    const now = new Date();
    complaint.status = status;
    complaint.admin_response = summary;
    complaint.decision = {
      outcome,
      summary,
      compensation_amount: compensationAmount,
      decided_by: req.user.id,
      decided_at: now,
    };
    complaint.resolved_at = now;
    complaint.closed_at = status === 'closed' ? now : undefined;
    if (complaint.evidence.length && !complaint.evidence_delete_at) {
      complaint.evidence_delete_at = getComplaintEvidenceDeleteAt(now);
    }
    complaint.last_message_at = now;
    await complaint.save();
    await Promise.all([
      ComplaintMessage.create({
        uuid: crypto.randomUUID(),
        complaint_id: complaint._id,
        sender_id: req.user.id,
        body: summary,
        message_type: 'decision',
      }),
      AuditLog.create({
        actor_id: req.user.id,
        action: 'complaint.decision_recorded',
        target_type: 'Complaint',
        target_id: complaint._id,
        metadata: {
          complaint_uuid: complaint.uuid,
          outcome,
          status,
          compensation_amount: compensationAmount,
        },
        ip: req.ip,
        user_agent: req.get('user-agent'),
      }),
    ]);
    await notifyParticipants(
      complaint,
      req.user.id,
      'Decision sur votre litige',
      summary.length > 140 ? `${summary.slice(0, 137)}...` : summary
    );
    res.json({
      success: true,
      message: 'Decision enregistree',
      data: serializeComplaint(complaint),
    });
  } catch (error) {
    console.error('decideComplaint error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = {
  addEvidence,
  createComplaint,
  decideComplaint,
  getAdminComplaints,
  getComplaint,
  getEligibleRequests,
  getEvidence,
  getMessages,
  getMyComplaints,
  sendMessage,
  updateReviewStatus,
};
