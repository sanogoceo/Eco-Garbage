const mongoose = require('mongoose');

const collectorProfilePhotoSchema = new mongoose.Schema({
  stored_name: { type: String, required: true },
  mime_type: { type: String, required: true },
  size: { type: Number, required: true },
  sha256: { type: String, required: true },
  encryption_version: { type: Number, default: 1 },
  encrypted_at: Date,
  verified_at: Date,
}, { _id: false });

const collectorProfileSchema = new mongoose.Schema({
  vehicle_type: String,
  vehicle_plate: String,
  service_area: String,
  service_zones: { type: [String], default: [] },
  is_available: { type: Boolean, default: false },
  rating_avg: { type: Number, default: 0 },
  total_collections: { type: Number, default: 0 },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
  },
  last_location_update: Date,
  profile_photo: collectorProfilePhotoSchema,
  national_id_number: String,
  id_front_url: String,
  id_back_url: String,
  selfie_url: String,
  selfie_video_url: String,
  verification_status: { type: String, enum: ['pending', 'submitted', 'verified', 'rejected'], default: 'pending' },
  verification_notes: String,
  verification_expires_at: Date,
  renewal_status: {
    type: String,
    enum: ['current', 'due', 'expired'],
    default: 'current',
  },
  renewal_notified_at: Date,
  hazardous_certification: {
    status: {
      type: String,
      enum: ['none', 'pending', 'verified', 'rejected'],
      default: 'none',
    },
    certificate_number: String,
    issued_at: Date,
    expires_at: Date,
    verified_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verified_at: Date,
    notes: String,
  },
}, { _id: false });

const userSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: String,
  phone_fingerprint: { type: String, select: false },
  registration_ip_fingerprint: { type: String, select: false },
  registration_device_fingerprint: { type: String, select: false },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['user', 'collector', 'admin'], default: 'user' },
  is_verified: { type: Boolean, default: false },
  email_verification_token: { type: String, default: null },
  email_verification_expires: { type: Date, default: null },
  password_reset_token: { type: String, default: null },
  password_reset_expires: { type: Date, default: null },
  is_active: { type: Boolean, default: true },
  avatar_url: String,
  address: String,
  collector_profile: collectorProfileSchema,
  admin_security: {
    two_factor_enabled: { type: Boolean, default: false },
    totp_secret: { type: String, select: false },
    pending_totp_secret: { type: String, select: false },
    pending_totp_expires: Date,
    backup_code_hashes: { type: [String], default: [], select: false },
    enabled_at: Date,
  },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});


userSchema.index({ 'collector_profile.location': '2dsphere' });
userSchema.index({ role: 1, is_active: 1, created_at: -1 });
userSchema.index({ phone_fingerprint: 1 });
userSchema.index({ registration_device_fingerprint: 1 });
userSchema.index({ registration_ip_fingerprint: 1, created_at: -1 });

module.exports = mongoose.model('User', userSchema);
