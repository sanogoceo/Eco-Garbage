const path = require('path');

const privateUploadRoot = process.env.UPLOAD_DIR
  ? path.resolve(__dirname, '..', '..', process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', 'private_uploads');

const collectorApplicationDir = path.join(
  privateUploadRoot,
  'collector-applications'
);

const collectorProfilePhotoDir = path.join(
  privateUploadRoot,
  'collector-profile-photos'
);

const pickupProofDir = process.env.PICKUP_PROOF_DIR
  ? path.resolve(__dirname, '..', '..', process.env.PICKUP_PROOF_DIR)
  : path.join(privateUploadRoot, 'pickup-proofs');

const complaintEvidenceDir = path.join(
  privateUploadRoot,
  'complaint-evidence'
);

module.exports = {
  privateUploadRoot,
  collectorApplicationDir,
  collectorProfilePhotoDir,
  pickupProofDir,
  complaintEvidenceDir,
};
