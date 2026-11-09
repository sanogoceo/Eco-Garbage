const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const AuthSession = require('../models/AuthSession');
const AdminActionGrant = require('../models/AdminActionGrant');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const { isEmailConfigured, sendVerificationEmail, sendResetPasswordEmail } = require('../services/emailService');
const {
  activateTwoFactor,
  beginTwoFactorEnrollment,
  checkAdminCode,
  createSession: createAdminSession,
  generateChallengeToken,
  isAdminTwoFactorRequired,
  verifyChallengeToken,
} = require('../services/adminSecurityService');

const ADMIN_SECRET_FIELDS = '+admin_security.totp_secret +admin_security.pending_totp_secret +admin_security.backup_code_hashes';
const SAFE_USER_EXCLUSIONS = '-password_hash -email_verification_token -email_verification_expires -password_reset_token -password_reset_expires -admin_security';

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const CM_PHONE_REGEX = /^(\+?237)?[62]\d{8}$/;
const validatePassword = (password) => {
  if (!password || password.length < 8) return 'Le mot de passe doit contenir au moins 8 caracteres';
  if (!PASSWORD_REGEX.test(password)) return 'Le mot de passe doit contenir une majuscule, une minuscule et un chiffre';
  return null;
};
const validatePhone = (phone) => {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s\-().]/g, '');
  if (!CM_PHONE_REGEX.test(cleaned)) return 'Numero de telephone camerounais invalide (ex: +237 6XXXXXXXX)';
  return null;
};

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UNKNOWN_ACCOUNT_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
const RESEND_VERIFICATION_RESPONSE = {
  success: true,
  message: 'Si ce compte attend une verification, un email vient d etre envoye.',
};

const generateToken = (user, sessionId) =>
  jwt.sign(
    {
      id: user.id || user._id.toString(),
      uuid: user.uuid,
      email: user.email,
      role: user.role,
      name: user.name,
      type: 'access',
      sid: sessionId,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

const createSession = async (userId, req) => {
  const deviceId = req.get('X-Eco-Device-ID') || req.ip || 'unknown';
  const fingerprint = crypto.createHash('sha256').update(`${deviceId}:${req.ip || ''}`).digest('hex');
  const platform = req.get('X-Eco-Platform') || 'web';
  const deviceName = (req.get('X-Eco-Device-Name') || req.get('user-agent') || '').slice(0, 200);
  const sessionId = uuidv4();
  await AuthSession.create({
    uuid: sessionId,
    user_id: userId,
    device_fingerprint: fingerprint,
    ip_fingerprint: req.ip ? crypto.createHash('sha256').update(req.ip).digest('hex') : undefined,
    device_name: deviceName,
    platform: ['android', 'ios', 'web'].includes(platform) ? platform : 'web',
    user_agent: (req.get('user-agent') || '').slice(0, 500),
    expires_at: new Date(Date.now() + SESSION_TTL_MS),
  });
  return sessionId;
};

const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const revokeUserSessions = (userId, reason, exceptSessionUuid) => AuthSession.updateMany(
  {
    user_id: userId,
    revoked_at: null,
    ...(exceptSessionUuid ? { uuid: { $ne: exceptSessionUuid } } : {}),
  },
  { $set: { revoked_at: new Date(), revocation_reason: reason } }
);

const toSafeUser = (userDoc) => {
  const {
    password_hash,
    email_verification_token,
    email_verification_expires,
    password_reset_token,
    password_reset_expires,
    admin_security,
    ...safeUser
  } = userDoc.toObject({ virtuals: true });
  return { ...safeUser, two_factor_enabled: Boolean(admin_security?.two_factor_enabled) };
};

const recordAdminSecurityEvent = (req, userDoc, action, metadata = {}) => AuditLog.create({
  actor_id: userDoc._id,
  action,
  target_type: 'User',
  target_id: userDoc._id,
  metadata,
  ip: req.ip,
  user_agent: req.get('user-agent'),
});

const sendCodeFailure = (res, result) => res.status(result.locked ? 429 : 401).json({
  success: false,
  message: result.locked
    ? 'Trop de codes incorrects. Reessayez dans 15 minutes.'
    : 'Code d authentification invalide',
});

const loadChallengeUser = async (req, res, purpose) => {
  try {
    const decoded = verifyChallengeToken(req.body.challenge_token, purpose);
    const userDoc = await User.findById(decoded.id).select(ADMIN_SECRET_FIELDS);
    if (userDoc?.role === 'admin' && userDoc.is_active) return userDoc;
  } catch {
    // An invalid or expired challenge gets the same response as an unknown account.
  }
  res.status(401).json({ success: false, message: 'Defi de securite invalide ou expire' });
  return null;
};


const register = async (req, res) => {
  try {
    const { name, email, phone, password, role = 'user', national_id_number } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'Champs requis manquants' });
    const pwError = validatePassword(password);
    if (pwError)
      return res.status(400).json({ success: false, message: pwError });
    const phoneError = validatePhone(phone);
    if (phoneError)
      return res.status(400).json({ success: false, message: phoneError });
    if (!['user', 'collector'].includes(role))
      return res.status(400).json({ success: false, message: 'Role invalide' });


    if (role === 'collector') {
      if (!national_id_number || national_id_number.length < 8 || national_id_number.length > 20) {
        return res.status(400).json({ success: false, message: 'Numéro de carte d\'identité national requis (8-20 caractères)' });
      }

      const idRegex = /^[A-Z0-9]+$/;
      if (!idRegex.test(national_id_number.toUpperCase())) {
        return res.status(400).json({ success: false, message: 'Format de numéro de carte d\'identité invalide' });
      }
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing)
      return res.status(409).json({ success: false, message: 'Email deja utilise' });

    const hash = await bcrypt.hash(password, 10);
    const uuid = uuidv4();
    const requireVerification = isEmailConfigured() || process.env.NODE_ENV === 'production';
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const fileUrl = (fileArray) => fileArray && fileArray[0] ? `/uploads/collectors/${fileArray[0].filename}` : undefined;
    const idFrontUrl = fileUrl(req.files?.id_front);
    const idBackUrl = fileUrl(req.files?.id_back);
    const selfieUrl = fileUrl(req.files?.selfie_photo);
    const selfieVideoUrl = fileUrl(req.files?.selfie_video);

    if (role === 'collector' && (!idFrontUrl || !idBackUrl || !selfieUrl)) {
      return res.status(400).json({ success: false, message: 'Les collecteurs doivent fournir une photo de la carte d identité (recto/verso) et un selfie.' });
    }

    const userData = {
      uuid, name, email, phone: phone || undefined, password_hash: hash, role,
      is_verified: !requireVerification,
      email_verification_token: requireVerification ? verificationToken : null,
      email_verification_expires: requireVerification ? verificationExpires : null,
    };
    if (role === 'collector') {
      userData.collector_profile = {
        is_available: false,
        rating_avg: 0,
        total_collections: 0,
        national_id_number: national_id_number.toUpperCase(),
        id_front_url: idFrontUrl,
        id_back_url: idBackUrl,
        selfie_url: selfieUrl,
        selfie_video_url: selfieVideoUrl,
        verification_status: 'submitted',
      };
    }

    const userDoc = await User.create(userData);

    await Notification.create({
      user_id: userDoc._id,
      title: 'Bienvenue sur EcoGarbage !',
      message: requireVerification
        ? `Bonjour ${name}, votre compte a ete cree avec succes. Verifiez votre email pour activer votre compte.`
        : `Bonjour ${name}, bienvenue sur EcoGarbage ! Votre compte est actif.`,
      type: 'welcome',
    });

    if (requireVerification) {
      try {
        await sendVerificationEmail(email, name, verificationToken);
      } catch (mailErr) {
        console.error('Email verification send error:', mailErr);
      }
      res.status(201).json({ success: true, message: 'Compte cree. Verifiez votre email pour activer votre compte.' });
    } else {
      res.status(201).json({ success: true, message: 'Compte cree avec succes ! Vous pouvez vous connecter.', autoVerified: true });
    }
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password)
      return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });

    const userDoc = await User.findOne({ email: email.toLowerCase() });
    const valid = await bcrypt.compare(password, userDoc?.password_hash || UNKNOWN_ACCOUNT_HASH);
    if (!userDoc || !valid)
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    if (!userDoc.is_active)
      return res.status(403).json({ success: false, message: 'Compte suspendu. Contactez le support.' });
    if (!userDoc.is_verified)
      return res.status(403).json({ success: false, message: 'Veuillez verifier votre email avant de vous connecter.', code: 'EMAIL_NOT_VERIFIED' });

    const twoFactorEnabled = Boolean(userDoc.admin_security?.two_factor_enabled);
    if (userDoc.role === 'admin' && (twoFactorEnabled || isAdminTwoFactorRequired())) {
      return res.json({
        success: true,
        code: twoFactorEnabled ? 'ADMIN_2FA_REQUIRED' : 'ADMIN_2FA_SETUP_REQUIRED',
        message: 'Double authentification requise',
        data: {
          challenge_token: generateChallengeToken(userDoc, twoFactorEnabled ? 'verify' : 'setup'),
        },
      });
    }

    const sessionId = await createSession(userDoc._id, req);
    const safeUser = toSafeUser(userDoc);
    const token = generateToken(safeUser, sessionId);
    res.json({ success: true, message: 'Connexion reussie', data: { token, user: safeUser } });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const getMe = async (req, res) => {
  try {
    const [userDoc, securityState] = await Promise.all([
      User.findById(req.user.id).select(SAFE_USER_EXCLUSIONS).lean({ virtuals: true }),
      User.findById(req.user.id).select('admin_security.two_factor_enabled').lean(),
    ]);
    if (!userDoc) return res.status(404).json({ success: false, message: 'Utilisateur non trouve' });
    res.json({
      success: true,
      data: {
        ...userDoc,
        two_factor_enabled: Boolean(securityState?.admin_security?.two_factor_enabled),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const updateProfile = async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    if (phone) {
      const cleaned = phone.replace(/[\s\-().]/g, '');
      if (!/^(\+?237)?[62]\d{8}$/.test(cleaned))
        return res.status(400).json({ success: false, message: 'Numero de telephone camerounais invalide' });
    }
    await User.findByIdAndUpdate(req.user.id, { $set: { name, phone, address } });
    res.json({ success: true, message: 'Profil mis a jour' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userDoc = await User.findById(req.user.id);
    const valid = await bcrypt.compare(currentPassword, userDoc.password_hash);
    if (!valid) return res.status(400).json({ success: false, message: 'Mot de passe actuel incorrect' });
    const pwError = validatePassword(newPassword);
    if (pwError) return res.status(400).json({ success: false, message: pwError });
    const hash = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(req.user.id, { $set: { password_hash: hash } });
    await revokeUserSessions(req.user.id, 'password_changed', req.session.uuid);
    res.json({ success: true, message: 'Mot de passe modifie' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') return res.status(400).json({ success: false, message: 'Token manquant' });

    const userDoc = await User.findOne({
      email_verification_token: token,
      email_verification_expires: { $gt: new Date() },
    });

    if (!userDoc)
      return res.status(400).json({ success: false, message: 'Lien invalide ou expire.' });

    userDoc.is_verified = true;
    userDoc.email_verification_token = null;
    userDoc.email_verification_expires = null;
    await userDoc.save();

    res.json({ success: true, message: 'Email verifie avec succes. Vous pouvez maintenant vous connecter.' });
  } catch (err) {
    console.error('verifyEmail error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    if (typeof email !== 'string' || !email) return res.status(400).json({ success: false, message: 'Email requis' });

    const userDoc = await User.findOne({ email: email.toLowerCase() });
    if (!userDoc || userDoc.is_verified) return res.json(RESEND_VERIFICATION_RESPONSE);

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    userDoc.email_verification_token = verificationToken;
    userDoc.email_verification_expires = verificationExpires;
    await userDoc.save();

    try {
      await sendVerificationEmail(userDoc.email, userDoc.name, verificationToken);
    } catch (mailErr) {
      console.error('Resend verification email error:', mailErr);
    }

    res.json(RESEND_VERIFICATION_RESPONSE);
  } catch (err) {
    console.error('resendVerification error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email requis' });

    const userDoc = await User.findOne({ email: email.toLowerCase() });

    if (!userDoc) return res.json({ success: true, message: 'Si un compte existe avec cet email, un lien de reinitialisation a ete envoye.' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    userDoc.password_reset_token = hashResetToken(resetToken);
    userDoc.password_reset_expires = resetExpires;
    await userDoc.save();

    try {
      await sendResetPasswordEmail(userDoc.email, userDoc.name, resetToken);
    } catch (mailErr) {
      console.error('Reset password email error:', mailErr);
    }

    res.json({ success: true, message: 'Si un compte existe avec cet email, un lien de reinitialisation a ete envoye.' });
  } catch (err) {
    console.error('forgotPassword error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (typeof token !== 'string' || !token || typeof password !== 'string' || !password) {
      return res.status(400).json({ success: false, message: 'Token et mot de passe requis' });
    }

    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ success: false, message: pwError });

    const userDoc = await User.findOne({
      password_reset_token: hashResetToken(token),
      password_reset_expires: { $gt: new Date() },
    });

    if (!userDoc) return res.status(400).json({ success: false, message: 'Lien invalide ou expire.' });

    const hash = await bcrypt.hash(password, 10);
    userDoc.password_hash = hash;
    userDoc.password_reset_token = null;
    userDoc.password_reset_expires = null;
    await userDoc.save();
    await revokeUserSessions(userDoc._id, 'password_reset');

    res.json({ success: true, message: 'Mot de passe reinitialise avec succes. Vous pouvez maintenant vous connecter.' });
  } catch (err) {
    console.error('resetPassword error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const logout = async (req, res) => {
  try {
    await AuthSession.updateOne(
      { uuid: req.session.uuid, user_id: req.user.id, revoked_at: null },
      { $set: { revoked_at: new Date(), revocation_reason: 'user_logout' } }
    );
    res.json({ success: true, message: 'Deconnecte avec succes' });
  } catch (err) {
    console.error('logout error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const listSessions = async (req, res) => {
  try {
    const sessions = await AuthSession.find({
      user_id: req.user.id,
      revoked_at: null,
      expires_at: { $gt: new Date() },
    }).select('uuid device_name platform last_seen_at created_at').lean();
    res.json({ success: true, data: sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const revokeSession = async (req, res) => {
  try {
    const { uuid } = req.params;
    if (uuid === req.session.uuid)
      return res.status(400).json({ success: false, message: 'Utilisez /logout pour terminer la session actuelle' });
    const result = await AuthSession.updateOne(
      { uuid, user_id: req.user.id, revoked_at: null },
      { $set: { revoked_at: new Date(), revoked_by: req.user.id, revocation_reason: 'user_revoked' } }
    );
    if (result.matchedCount === 0)
      return res.status(404).json({ success: false, message: 'Session introuvable' });
    res.json({ success: true, message: 'Session revoquee' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const revokeOtherSessions = async (req, res) => {
  try {
    await AuthSession.updateMany(
      { user_id: req.user.id, uuid: { $ne: req.session.uuid }, revoked_at: null },
      { $set: { revoked_at: new Date(), revoked_by: req.user.id, revocation_reason: 'user_revoked_others' } }
    );
    res.json({ success: true, message: 'Autres sessions revoquees' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const createAdminStepUp = async (req, res) => {
  try {
    const { scope, password, code } = req.body;
    const validScopes = [
      'collector_review', 'user_status', 'payment_refund', 'service_configuration', 'business_contract_review',
      'user_management', 'complaint_decision', 'withdrawal_review',
    ];
    if (!scope || !validScopes.includes(scope))
      return res.status(400).json({ success: false, message: 'Scope invalide' });
    if (!password)
      return res.status(400).json({ success: false, message: 'Mot de passe requis' });
    const userDoc = await User.findById(req.user.id).select(ADMIN_SECRET_FIELDS);
    if (!userDoc) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    const valid = await bcrypt.compare(password, userDoc.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Mot de passe incorrect' });
    if (userDoc.admin_security?.two_factor_enabled) {
      const result = await checkAdminCode(userDoc, code, { allowReuse: true });
      if (!result.valid) return sendCodeFailure(res, result);
    } else if (isAdminTwoFactorRequired()) {
      return res.status(403).json({ success: false, message: 'Activez la double authentification pour continuer' });
    }
    const grantUuid = uuidv4();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await AdminActionGrant.create({
      uuid: grantUuid,
      user_id: req.user.id,
      session_uuid: req.session.uuid,
      scope,
      expires_at: expiresAt,
    });
    const stepUpToken = jwt.sign(
      { type: 'admin_step_up', id: req.user.id, sid: req.session.uuid, scope, grant: grantUuid },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );
    await recordAdminSecurityEvent(req, userDoc, 'admin_security.step_up_granted', {
      scope,
      session_uuid: req.session.uuid,
    });
    res.json({ success: true, data: { token: stepUpToken } });
  } catch (err) {
    console.error('createAdminStepUp error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const issueAdminSession = async (req, userDoc) => {
  const { token } = await createAdminSession({ user: userDoc, req, mfaVerified: true });
  return { token, user: toSafeUser(userDoc) };
};

const startTwoFactorSetup = async (req, res) => {
  try {
    const userDoc = await loadChallengeUser(req, res, 'setup');
    if (!userDoc) return undefined;
    if (userDoc.admin_security?.two_factor_enabled) {
      return res.status(409).json({ success: false, message: 'Double authentification deja activee' });
    }
    return res.json({ success: true, data: await beginTwoFactorEnrollment(userDoc) });
  } catch (err) {
    console.error('startTwoFactorSetup error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const confirmTwoFactorSetup = async (req, res) => {
  try {
    const userDoc = await loadChallengeUser(req, res, 'setup');
    if (!userDoc) return undefined;
    const activation = await activateTwoFactor(userDoc, req.body.code);
    if (!activation) {
      return res.status(401).json({ success: false, message: 'Code invalide ou configuration expiree' });
    }
    await revokeUserSessions(userDoc._id, 'two_factor_enabled');
    const sessionData = await issueAdminSession(req, activation.user);
    await recordAdminSecurityEvent(req, userDoc, 'admin_security.two_factor_enabled', { method: 'login_setup' });
    return res.json({
      success: true,
      data: { ...sessionData, backup_codes: activation.backupCodes },
    });
  } catch (err) {
    console.error('confirmTwoFactorSetup error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const verifyTwoFactorLogin = async (req, res) => {
  try {
    const userDoc = await loadChallengeUser(req, res, 'verify');
    if (!userDoc) return undefined;
    if (!userDoc.admin_security?.two_factor_enabled) {
      return res.status(409).json({ success: false, message: 'Double authentification non configuree' });
    }
    const result = await checkAdminCode(userDoc, req.body.code);
    if (!result.valid) return sendCodeFailure(res, result);
    return res.json({ success: true, data: await issueAdminSession(req, userDoc) });
  } catch (err) {
    console.error('verifyTwoFactorLogin error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const enrollTwoFactor = async (req, res) => {
  try {
    const userDoc = await User.findById(req.user.id);
    if (userDoc.admin_security?.two_factor_enabled) {
      return res.status(409).json({ success: false, message: 'Double authentification deja activee' });
    }
    return res.json({ success: true, data: await beginTwoFactorEnrollment(userDoc) });
  } catch (err) {
    console.error('enrollTwoFactor error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const enableTwoFactor = async (req, res) => {
  try {
    const userDoc = await User.findById(req.user.id).select(ADMIN_SECRET_FIELDS);
    const activation = await activateTwoFactor(userDoc, req.body.code);
    if (!activation) {
      return res.status(401).json({ success: false, message: 'Code invalide ou configuration expiree' });
    }
    await Promise.all([
      revokeUserSessions(userDoc._id, 'two_factor_enabled', req.session.uuid),
      AuthSession.updateOne({ uuid: req.session.uuid }, { $set: { mfa_verified: true } }),
    ]);
    await recordAdminSecurityEvent(req, userDoc, 'admin_security.two_factor_enabled', { method: 'profile' });
    return res.json({ success: true, data: { backup_codes: activation.backupCodes } });
  } catch (err) {
    console.error('enableTwoFactor error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const disableTwoFactor = async (req, res) => {
  try {
    const { password, code } = req.body;
    if (typeof password !== 'string' || !password || !code) {
      return res.status(400).json({ success: false, message: 'Mot de passe et code requis' });
    }
    const userDoc = await User.findById(req.user.id).select(ADMIN_SECRET_FIELDS);
    if (!userDoc.admin_security?.two_factor_enabled) {
      return res.status(409).json({ success: false, message: 'Double authentification non activee' });
    }
    if (!await bcrypt.compare(password, userDoc.password_hash)) {
      return res.status(401).json({ success: false, message: 'Mot de passe incorrect' });
    }
    const result = await checkAdminCode(userDoc, code);
    if (!result.valid) return sendCodeFailure(res, result);
    await User.updateOne(
      { _id: userDoc._id },
      {
        $set: { 'admin_security.two_factor_enabled': false, 'admin_security.backup_code_hashes': [] },
        $unset: { 'admin_security.totp_secret': 1, 'admin_security.enabled_at': 1, 'admin_security.last_totp_step': 1 },
      }
    );
    await revokeUserSessions(userDoc._id, 'two_factor_disabled', req.session.uuid);
    await recordAdminSecurityEvent(req, userDoc, 'admin_security.two_factor_disabled', { method: result.backup ? 'backup_code' : 'totp' });
    return res.json({ success: true, message: 'Double authentification desactivee' });
  } catch (err) {
    console.error('disableTwoFactor error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = {
  register, login, getMe, updateProfile, changePassword,
  verifyEmail, resendVerification, forgotPassword, resetPassword,
  logout, listSessions, revokeSession, revokeOtherSessions,
  createAdminStepUp,
  startTwoFactorSetup, confirmTwoFactorSetup, verifyTwoFactorLogin,
  enrollTwoFactor, enableTwoFactor, disableTwoFactor,
  validatePassword,
};