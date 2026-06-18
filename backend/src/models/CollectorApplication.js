const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  stored_name: { type: String, required: true },
  original_name: { type: String, required: true },
  mime_type: { type: String, required: true },
  size: { type: Number, required: true },
  sha256: String,
  encryption_version: { type: Number, default: 1 },
  encrypted_at: Date,
}, { _id: false });

const collectorApplicationSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  full_name: { type: String, required: true, trim: true },
  birth_date: { type: Date, required: true },
  gender: {
    type: String,
    enum: ['male', 'female', 'other', 'prefer_not_to_say'],
    required: true,
  },
  phone: { type: String, required: true },
  city: { type: String, required: true, trim: true },
  neighborhood: { type: String, required: true, trim: true },
  residence_address: { type: String, required: true, trim: true },
  service_area: { type: String, required: true },
  vehicle_type: {
    type: String,
    enum: ['foot', 'motorcycle', 'tricycle', 'car', 'van'],
    required: true,
  },
  emergency_contact: {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
  },
  consent: {
    accepted: { type: Boolean, required: true },
    terms_version: { type: String, required: true },
    accepted_at: { type: Date, required: true },
  },
  // Legacy fields kept optional so existing applications remain readable.
  address: String,
  vehicle_plate: String,
  vehicle_details: String,
  national_id_number: { type: String, select: false },
  national_id_fingerprint: { type: String, select: false },
  national_id_expiry_date: Date,
  application_type: {
    type: String,
    enum: ['initial', 'renewal'],
    default: 'initial',
  },
  renewal_of: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CollectorApplication',
  },
  identity_verification: {
    profile_matches_selfie: Boolean,
    selfie_matches_id: Boolean,
    id_readable: Boolean,
    id_not_expired: Boolean,
    method: {
      type: String,
      enum: ['manual'],
      default: 'manual',
    },
    checked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    checked_at: Date,
  },
  verification_valid_until: Date,
  documents: {
    profile_photo: documentSchema,
    id_front: documentSchema,
    id_back: documentSchema,
    selfie_with_id: documentSchema,
    vehicle_photo: documentSchema,
  },
  documents_delete_at: Date,
  documents_deleted_at: Date,
  document_replacement: {
    requested_types: [{
      type: String,
      enum: [
        'profile_photo',
        'id_front',
        'id_back',
        'selfie_with_id',
        'vehicle_photo',
      ],
    }],
    reason: String,
    requested_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requested_at: Date,
    completed_at: Date,
  },
  status: {
    type: String,
    enum: [
      'submitted',
      'under_review',
      'changes_requested',
      'approved',
      'rejected',
    ],
    default: 'submitted',
  },
  review_notes: String,
  reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submitted_at: { type: Date, default: Date.now },
  reviewed_at: Date,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

collectorApplicationSchema.index({ user_id: 1, created_at: -1 });
collectorApplicationSchema.index({ status: 1, submitted_at: -1 });
collectorApplicationSchema.index({ verification_valid_until: 1, status: 1 });
collectorApplicationSchema.index({ national_id_fingerprint: 1 });
collectorApplicationSchema.index({
  documents_delete_at: 1,
  documents_deleted_at: 1,
});
collectorApplicationSchema.index(
  { user_id: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'submitted' },
  }
);

module.exports = mongoose.model('CollectorApplication', collectorApplicationSchema);
