const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const AuthSession = require('../models/AuthSession');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { notifyUser } = require('./notificationService');
const { decrypt, encrypt, fingerprint } = require('../utils/sensitiveData');

const ACCESS_TOKEN_DAYS = 7;
const CHALLENGE_MINUTES = 10;
const STEP_UP_MINUTES = 5;
const MAX_CODE_ATTEMPTS = 5;
const CODE_LOCK_MINUTES = 15;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Encode = (buffer) => {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, '0');
    result += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return result;
};

const base32Decode = (value) => {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Secret TOTP invalide');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
};

const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

const generateTotp = (secret, now = Date.now(), period = 30) => {
  const counter = Math.floor(now / 1000 / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto
    .createHmac('sha1', base32Decode(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  );
  return String(binary % 1_000_000).padStart(6, '0');
};

const findTotpStep = (secret, code, { now = Date.now(), window = 1 } = {}) => {
  const normalized = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const currentStep = Math.floor(now / 30_000);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = generateTotp(secret, now + offset * 30_000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) {
      return currentStep + offset;
    }
  }
  return null;
};

const verifyTotp = (secret, code, options) => findTotpStep(secret, code, options) !== null;

const sessionContext = (req) => {
  const installationId = String(req.get('X-Eco-Device-ID') || '').trim();
  const userAgent = String(req.get('user-agent') || 'unknown').slice(0, 500);
  const deviceSource = installationId || `agent:${userAgent}`;
  const platformHeader = String(req.get('X-Eco-Platform') || '').toLowerCase();
  const platform = ['android', 'ios', 'web'].includes(platformHeader)
    ? platformHeader
    : /android/i.test(userAgent)
      ? 'android'
      : /iphone|ipad/i.test(userAgent)
        ? 'ios'
        : /mozilla|chrome|safari|firefox/i.test(userAgent)
          ? 'web'
          : 'unknown';
  return {
    deviceFingerprint: fingerprint(`session-device:${deviceSource}`),
    ipFingerprint: fingerprint(`session-ip:${String(req.ip || '')}`),
    deviceName: String(req.get('X-Eco-Device-Name') || platform).slice(0, 100),
    platform,
    userAgent,
  };
};

const generateAccessToken = (user, session) => jwt.sign(
  {
    id: user._id.toString(),
    uuid: user.uuid,
    email: user.email,
    role: user.role,
    name: user.name,
    sid: session.uuid,
    type: 'access',
  },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

const createSession = async ({ user, req, mfaVerified = false }) => {
  const context = sessionContext(req);
  const now = new Date();
  const previousSessions = await AuthSession.countDocuments({ user_id: user._id });
  const knownDevice = previousSessions > 0
    ? await AuthSession.exists({
        user_id: user._id,
        device_fingerprint: context.deviceFingerprint,
      })
    : true;
  const session = await AuthSession.create({
    uuid: crypto.randomUUID(),
    user_id: user._id,
    device_fingerprint: context.deviceFingerprint,
    ip_fingerprint: context.ipFingerprint,
    device_name: context.deviceName,
    platform: context.platform,
    user_agent: context.userAgent,
    is_unusual: user.role === 'admin' && !knownDevice,
    mfa_verified: mfaVerified,
    last_seen_at: now,
    expires_at: new Date(now.getTime() + ACCESS_TOKEN_DAYS * 24 * 60 * 60 * 1000),
  });

  if (session.is_unusual) {
    await Promise.allSettled([
      notifyUser({
        userId: user._id,
        title: 'Connexion administrateur inhabituelle',
        message: `Une connexion depuis un nouvel appareil (${context.deviceName}) a ete detectee.`,
        type: 'security',
        priority: 'critical',
        data: { target_path: '/admin/profile' },
      }),
      AuditLog.create({
        actor_id: user._id,
        action: 'admin_security.unusual_login',
        target_type: 'AuthSession',
        target_id: session._id,
        metadata: {
          session_uuid: session.uuid,
          device_name: context.deviceName,
          platform: context.platform,
        },
        ip: req.ip,
        user_agent: context.userAgent,
      }),
    ]);
  }
  return { session, token: generateAccessToken(user, session) };
};

const generateChallengeToken = (user, purpose) => jwt.sign(
  {
    id: user._id.toString(),
    role: user.role,
    purpose,
    type: 'admin_2fa_challenge',
  },
  process.env.JWT_SECRET,
  { expiresIn: `${CHALLENGE_MINUTES}m` }
);

const verifyChallengeToken = (token, purpose) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  if (
    decoded.type !== 'admin_2fa_challenge'
    || decoded.role !== 'admin'
    || decoded.purpose !== purpose
  ) {
    throw new Error('Defi de securite invalide');
  }
  return decoded;
};

const buildTotpUri = ({ email, secret }) => (
  `otpauth://totp/${encodeURIComponent(`EcoGarbage:${email}`)}`
  + `?secret=${secret}&issuer=${encodeURIComponent('EcoGarbage')}&algorithm=SHA1&digits=6&period=30`
);

const generateBackupCodes = () => Array.from(
  { length: 8 },
  () => crypto.randomBytes(5).toString('hex').toUpperCase()
);

const hashBackupCodes = (codes) => Promise.all(
  codes.map((code) => bcrypt.hash(code, 10))
);

const verifyAdminCode = async (user, code, { allowReuse = false } = {}) => {
  const normalized = String(code || '').replace(/[\s-]/g, '').toUpperCase();
  const secret = decrypt(user.admin_security?.totp_secret);
  const step = secret ? findTotpStep(secret, normalized) : null;
  if (step !== null) {
    if (allowReuse) return { valid: true, backup: false };
    const claimed = await User.updateOne(
      { _id: user._id, 'admin_security.last_totp_step': { $not: { $gte: step } } },
      { $set: { 'admin_security.last_totp_step': step } }
    );
    return { valid: claimed.modifiedCount === 1, backup: false };
  }

  for (const hash of user.admin_security?.backup_code_hashes || []) {
    if (await bcrypt.compare(normalized, hash)) {
      const consumed = await User.updateOne(
        { _id: user._id, 'admin_security.backup_code_hashes': hash },
        { $pull: { 'admin_security.backup_code_hashes': hash } }
      );
      return { valid: consumed.modifiedCount === 1, backup: true };
    }
  }
  return { valid: false, backup: false };
};

const checkAdminCode = async (user, code, options) => {
  const lockedUntil = user.admin_security?.code_locked_until;
  if (lockedUntil && lockedUntil > new Date()) {
    return { valid: false, backup: false, locked: true };
  }
  const result = await verifyAdminCode(user, code, options);
  if (result.valid) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: { 'admin_security.failed_code_attempts': 0 },
        $unset: { 'admin_security.code_locked_until': 1 },
      }
    );
    return { ...result, locked: false };
  }
  const updated = await User.findByIdAndUpdate(
    user._id,
    { $inc: { 'admin_security.failed_code_attempts': 1 } },
    { new: true }
  ).select('admin_security.failed_code_attempts');
  if (updated.admin_security.failed_code_attempts < MAX_CODE_ATTEMPTS) {
    return { ...result, locked: false };
  }
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        'admin_security.failed_code_attempts': 0,
        'admin_security.code_locked_until': new Date(Date.now() + CODE_LOCK_MINUTES * 60_000),
      },
    }
  );
  return { ...result, locked: true };
};

const beginTwoFactorEnrollment = async (user) => {
  const secret = generateTotpSecret();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        'admin_security.pending_totp_secret': encrypt(secret),
        'admin_security.pending_totp_expires': new Date(Date.now() + CHALLENGE_MINUTES * 60_000),
      },
    }
  );
  return { secret, provisioning_uri: buildTotpUri({ email: user.email, secret }) };
};

const activateTwoFactor = async (user, code) => {
  const encryptedSecret = user.admin_security?.pending_totp_secret;
  const expiresAt = user.admin_security?.pending_totp_expires;
  if (!encryptedSecret || !expiresAt || expiresAt <= new Date()) return null;
  const step = findTotpStep(decrypt(encryptedSecret), code);
  if (step === null) return null;

  const backupCodes = generateBackupCodes();
  const activated = await User.findOneAndUpdate(
    { _id: user._id, 'admin_security.two_factor_enabled': { $ne: true } },
    {
      $set: {
        'admin_security.two_factor_enabled': true,
        'admin_security.totp_secret': encryptedSecret,
        'admin_security.backup_code_hashes': await hashBackupCodes(backupCodes),
        'admin_security.enabled_at': new Date(),
        'admin_security.last_totp_step': step,
        'admin_security.failed_code_attempts': 0,
      },
      $unset: {
        'admin_security.pending_totp_secret': 1,
        'admin_security.pending_totp_expires': 1,
        'admin_security.code_locked_until': 1,
      },
    },
    { new: true }
  );
  return activated ? { user: activated, backupCodes } : null;
};

const createStepUpToken = ({ user, sessionUuid, scope, grantUuid }) => jwt.sign(
  {
    id: user._id.toString(),
    sid: sessionUuid,
    scope,
    grant: grantUuid,
    type: 'admin_step_up',
  },
  process.env.JWT_SECRET,
  { expiresIn: `${STEP_UP_MINUTES}m` }
);

const isAdminTwoFactorRequired = () => (
  process.env.ADMIN_2FA_REQUIRED === 'true'
  || process.env.NODE_ENV === 'production'
);

module.exports = {
  activateTwoFactor,
  beginTwoFactorEnrollment,
  buildTotpUri,
  checkAdminCode,
  createSession,
  createStepUpToken,
  generateBackupCodes,
  generateChallengeToken,
  generateTotp,
  generateTotpSecret,
  hashBackupCodes,
  isAdminTwoFactorRequired,
  sessionContext,
  verifyAdminCode,
  verifyChallengeToken,
  verifyTotp,
  encryptTotpSecret: encrypt,
};
