const CollectorApplication = require('../models/CollectorApplication');
const PickupRequest = require('../models/PickupRequest');
const Complaint = require('../models/Complaint');
const AuditLog = require('../models/AuditLog');
const {
  collectorApplicationDir,
  complaintEvidenceDir,
  pickupProofDir,
} = require('../config/storage');
const {
  deleteStoredFile,
  encryptExistingFile,
  ENCRYPTION_VERSION,
} = require('../utils/secureFileStorage');

const COLLECTOR_DOCUMENT_TYPES = [
  'profile_photo',
  'id_front',
  'id_back',
  'selfie_with_id',
  'vehicle_photo',
];

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const addDays = (date, days) => new Date(
  new Date(date).getTime() + days * 24 * 60 * 60 * 1000
);

const getCollectorDocumentDeleteAt = (decision, reviewedAt = new Date()) => {
  const days = decision === 'approved'
    ? positiveInteger(process.env.APPROVED_COLLECTOR_DOCUMENT_RETENTION_DAYS, 730)
    : positiveInteger(process.env.REJECTED_COLLECTOR_DOCUMENT_RETENTION_DAYS, 90);
  return addDays(reviewedAt, days);
};

const getPickupProofDeleteAt = (terminalAt = new Date()) => addDays(
  terminalAt,
  positiveInteger(process.env.PICKUP_PROOF_RETENTION_DAYS, 365)
);

const getComplaintEvidenceDeleteAt = (resolvedAt = new Date()) => addDays(
  resolvedAt,
  positiveInteger(process.env.COMPLAINT_EVIDENCE_RETENTION_DAYS, 365)
);

const auditSystemDeletion = (targetType, targetId, metadata) => AuditLog.create({
  actor_type: 'system',
  action: 'sensitive_data.retention_deleted',
  target_type: targetType,
  target_id: targetId,
  metadata,
});

const backfillRetentionDeadlines = async (limit) => {
  const applications = await CollectorApplication.find({
    status: { $in: ['approved', 'rejected'] },
    reviewed_at: { $exists: true },
    documents_delete_at: null,
    documents_deleted_at: null,
  }).select('_id status reviewed_at').limit(limit).lean();
  const requests = await PickupRequest.find({
    status: { $in: ['completed', 'cancelled', 'failed'] },
    'proofs.0': { $exists: true },
    proofs_delete_at: null,
    proofs_deleted_at: null,
  }).select('_id collected_at updated_at').limit(limit).lean();
  const complaints = await Complaint.find({
    status: { $in: ['resolved', 'closed'] },
    'evidence.0': { $exists: true },
    evidence_delete_at: null,
    evidence_deleted_at: null,
  }).select('_id resolved_at closed_at updated_at').limit(limit).lean();

  await Promise.all([
    ...applications.map((application) => CollectorApplication.updateOne(
      { _id: application._id, documents_delete_at: null },
      {
        $set: {
          documents_delete_at: getCollectorDocumentDeleteAt(
            application.status,
            application.reviewed_at
          ),
        },
      }
    )),
    ...requests.map((request) => PickupRequest.updateOne(
      { _id: request._id, proofs_delete_at: null },
      {
        $set: {
          proofs_delete_at: getPickupProofDeleteAt(
            request.collected_at || request.updated_at
          ),
        },
      }
    )),
    ...complaints.map((complaint) => Complaint.updateOne(
      { _id: complaint._id, evidence_delete_at: null },
      {
        $set: {
          evidence_delete_at: getComplaintEvidenceDeleteAt(
            complaint.closed_at || complaint.resolved_at || complaint.updated_at
          ),
        },
      }
    )),
  ]);

  return {
    collectorApplicationsBackfilled: applications.length,
    pickupRequestsBackfilled: requests.length,
    complaintsBackfilled: complaints.length,
  };
};

const purgeExpiredComplaintEvidence = async (now = new Date()) => {
  const complaints = await Complaint.find({
    evidence_delete_at: { $lte: now },
    evidence_deleted_at: null,
    'evidence.0': { $exists: true },
  }).limit(100);
  let purged = 0;

  for (const complaint of complaints) {
    try {
      await Promise.all(complaint.evidence.map((evidence) => deleteStoredFile({
        directory: complaintEvidenceDir,
        storedName: evidence.stored_name,
      })));
      const updated = await Complaint.updateOne(
        { _id: complaint._id, evidence_deleted_at: null },
        {
          $set: {
            evidence: [],
            evidence_deleted_at: now,
          },
        }
      );
      if (updated.modifiedCount) {
        purged += 1;
        await auditSystemDeletion('Complaint', complaint._id, {
          reason: 'retention_expired',
          deleted_evidence_count: complaint.evidence.length,
        });
      }
    } catch (error) {
      console.error('Complaint evidence retention cleanup failed:', error);
    }
  }
  return purged;
};

const purgeExpiredCollectorDocuments = async (now = new Date()) => {
  const applications = await CollectorApplication.find({
    documents_delete_at: { $lte: now },
    documents_deleted_at: null,
  }).limit(100);
  let purged = 0;

  for (const application of applications) {
    const storedDocuments = COLLECTOR_DOCUMENT_TYPES
      .map((type) => ({ type, document: application.documents?.[type] }))
      .filter(({ document }) => document?.stored_name);
    try {
      await Promise.all(storedDocuments.map(({ document }) => deleteStoredFile({
        directory: collectorApplicationDir,
        storedName: document.stored_name,
      })));
      const updated = await CollectorApplication.updateOne(
        { _id: application._id, documents_deleted_at: null },
        {
          $unset: {
            'documents.profile_photo': 1,
            'documents.id_front': 1,
            'documents.id_back': 1,
            'documents.selfie_with_id': 1,
            'documents.vehicle_photo': 1,
            national_id_number: 1,
            national_id_fingerprint: 1,
          },
          $set: { documents_deleted_at: now },
        }
      );
      if (updated.modifiedCount) {
        purged += 1;
        await auditSystemDeletion('CollectorApplication', application._id, {
          reason: 'retention_expired',
          deleted_document_types: storedDocuments.map(({ type }) => type),
        });
      }
    } catch (error) {
      console.error('Collector document retention cleanup failed:', error);
    }
  }
  return purged;
};

const purgeExpiredPickupProofs = async (now = new Date()) => {
  const requests = await PickupRequest.find({
    proofs_delete_at: { $lte: now },
    proofs_deleted_at: null,
    'proofs.0': { $exists: true },
  }).limit(100);
  let purged = 0;

  for (const request of requests) {
    try {
      await Promise.all(request.proofs.map((proof) => deleteStoredFile({
        directory: pickupProofDir,
        storedName: proof.stored_name,
      })));
      const updated = await PickupRequest.updateOne(
        { _id: request._id, proofs_deleted_at: null },
        {
          $set: {
            proofs: [],
            proofs_deleted_at: now,
          },
        }
      );
      if (updated.modifiedCount) {
        purged += 1;
        await auditSystemDeletion('PickupRequest', request._id, {
          reason: 'retention_expired',
          deleted_proof_count: request.proofs.length,
        });
      }
    } catch (error) {
      console.error('Pickup proof retention cleanup failed:', error);
    }
  }
  return purged;
};

const migrateLegacyCollectorDocuments = async (limit) => {
  const applications = await CollectorApplication.find({
    documents_deleted_at: null,
    $or: COLLECTOR_DOCUMENT_TYPES.map((type) => ({
      [`documents.${type}.stored_name`]: { $exists: true },
      [`documents.${type}.encryption_version`]: { $ne: ENCRYPTION_VERSION },
    })),
  }).limit(limit);
  let migrated = 0;

  for (const application of applications) {
    let changed = false;
    for (const type of COLLECTOR_DOCUMENT_TYPES) {
      const document = application.documents?.[type];
      if (!document?.stored_name) continue;
      try {
        const encrypted = await encryptExistingFile({
          directory: collectorApplicationDir,
          storedName: document.stored_name,
          context: 'collector-document',
        });
        document.encryption_version = ENCRYPTION_VERSION;
        document.encrypted_at ||= new Date();
        if (encrypted) migrated += 1;
        changed = true;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Collector document migration failed:', error);
        }
      }
    }
    if (changed) await application.save();
  }
  return migrated;
};

const migrateLegacyPickupProofs = async (limit) => {
  const requests = await PickupRequest.find({
    proofs_deleted_at: null,
    proofs: {
      $elemMatch: {
        stored_name: { $exists: true },
        encryption_version: { $ne: ENCRYPTION_VERSION },
      },
    },
  }).limit(limit);
  let migrated = 0;

  for (const request of requests) {
    let changed = false;
    for (const proof of request.proofs) {
      if (!proof.stored_name) continue;
      try {
        const encrypted = await encryptExistingFile({
          directory: pickupProofDir,
          storedName: proof.stored_name,
          context: 'pickup-proof',
        });
        proof.encryption_version = ENCRYPTION_VERSION;
        proof.encrypted_at ||= new Date();
        if (encrypted) migrated += 1;
        changed = true;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Pickup proof migration failed:', error);
        }
      }
    }
    if (changed) await request.save();
  }
  return migrated;
};

const runSensitiveDataMaintenance = async ({ now = new Date() } = {}) => {
  const migrationLimit = positiveInteger(
    process.env.SENSITIVE_FILE_MIGRATION_BATCH_SIZE,
    100
  );
  const backfilled = await backfillRetentionDeadlines(migrationLimit);
  const collectorDocumentsMigrated = await migrateLegacyCollectorDocuments(
    migrationLimit
  );
  const pickupProofsMigrated = await migrateLegacyPickupProofs(migrationLimit);
  const collectorApplicationsPurged = await purgeExpiredCollectorDocuments(now);
  const pickupRequestsPurged = await purgeExpiredPickupProofs(now);
  const complaintsPurged = await purgeExpiredComplaintEvidence(now);
  return {
    ...backfilled,
    collectorDocumentsMigrated,
    pickupProofsMigrated,
    collectorApplicationsPurged,
    pickupRequestsPurged,
    complaintsPurged,
  };
};

let maintenanceTimer;

const startSensitiveDataScheduler = () => {
  if (process.env.NODE_ENV === 'test' || maintenanceTimer) return;
  const intervalHours = positiveInteger(
    process.env.SENSITIVE_DATA_CLEANUP_INTERVAL_HOURS,
    6
  );
  const run = () => runSensitiveDataMaintenance().catch((error) => {
    console.error('Sensitive data maintenance failed:', error);
  });
  const initialTimer = setTimeout(run, 30 * 1000);
  initialTimer.unref();
  maintenanceTimer = setInterval(run, intervalHours * 60 * 60 * 1000);
  maintenanceTimer.unref();
};

module.exports = {
  COLLECTOR_DOCUMENT_TYPES,
  getCollectorDocumentDeleteAt,
  getComplaintEvidenceDeleteAt,
  getPickupProofDeleteAt,
  purgeExpiredComplaintEvidence,
  purgeExpiredCollectorDocuments,
  purgeExpiredPickupProofs,
  runSensitiveDataMaintenance,
  startSensitiveDataScheduler,
};
