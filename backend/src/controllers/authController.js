const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const AuthSession = require('../models/AuthSession');
const AdminActionGrant = require('../models/AdminActionGrant');
const Notification = require('../models/Notification');
const { sendVerificationEmail, sendResetPasswordEmail } = require('../services/emailService');

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
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
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
      is_verified: !smtpConfigured, // auto-verify when SMTP not configured
      email_verification_token: smtpConfigured ? verificationToken : null,
      email_verification_expires: smtpConfigured ? verificationExpires : null,
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
      message: smtpConfigured
        ? `Bonjour ${name}, votre compte a ete cree avec succes. Verifiez votre email pour activer votre compte.`
        : `Bonjour ${name}, bienvenue sur EcoGarbage ! Votre compte est actif.`,
      type: 'welcome',
    });

    if (smtpConfigured) {
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
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });

    const userDoc = await User.findOne({ email: email.toLowerCase() });
    if (!userDoc)
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    if (!userDoc.is_active)
      return res.status(403).json({ success: false, message: 'Compte suspendu. Contactez le support.' });
    if (!userDoc.is_verified)
      return res.status(403).json({ success: false, message: 'Veuillez verifier votre email avant de vous connecter.', code: 'EMAIL_NOT_VERIFIED' });

    const valid = await bcrypt.compare(password, userDoc.password_hash);
    if (!valid)
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });

    const sessionId = await createSession(userDoc._id, req);
    const obj = userDoc.toObject({ virtuals: true });
    const { password_hash, ...safeUser } = obj;
    const token = generateToken(safeUser, sessionId);
    res.json({ success: true, message: 'Connexion reussie', data: { token, user: safeUser } });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const getMe = async (req, res) => {
  try {
    const userDoc = await User.findById(req.user.id).select('-password_hash').lean({ virtuals: true });
    if (!userDoc) return res.status(404).json({ success: false, message: 'Utilisateur non trouve' });
    res.json({ success: true, data: userDoc });
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
    res.json({ success: true, message: 'Mot de passe modifie' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};


const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: 'Token manquant' });

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
    if (!email) return res.status(400).json({ success: false, message: 'Email requis' });

    const userDoc = await User.findOne({ email: email.toLowerCase() });
    if (!userDoc)
      return res.status(404).json({ success: false, message: 'Aucun compte associe a cet email' });
    if (userDoc.is_verified)
      return res.status(400).json({ success: false, message: 'Cet email est deja verifie' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    userDoc.email_verification_token = verificationToken;
    userDoc.email_verification_expires = verificationExpires;
    await userDoc.save();

    try {
      await sendVerificationEmail(userDoc.email, userDoc.name, verificationToken);
    } catch (mailErr) {
      console.error('Resend verification email error:', mailErr);
      return res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi de l\'email' });
    }

    res.json({ success: true, message: 'Email de verification renvoye. Verifiez votre boite mail.' });
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

    userDoc.password_reset_token = resetToken;
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
    if (!token || !password) return res.status(400).json({ success: false, message: 'Token et mot de passe requis' });

    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ success: false, message: pwError });

    const userDoc = await User.findOne({
      password_reset_token: token,
      password_reset_expires: { $gt: new Date() },
    });

    if (!userDoc) return res.status(400).json({ success: false, message: 'Lien invalide ou expire.' });

    const hash = await bcrypt.hash(password, 10);
    userDoc.password_hash = hash;
    userDoc.password_reset_token = null;
    userDoc.password_reset_expires = null;
    await userDoc.save();

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
    const { scope, password } = req.body;
    const validScopes = ['collector_review', 'user_status', 'payment_refund', 'service_configuration', 'business_contract_review'];
    if (!scope || !validScopes.includes(scope))
      return res.status(400).json({ success: false, message: 'Scope invalide' });
    if (!password)
      return res.status(400).json({ success: false, message: 'Mot de passe requis' });
    const userDoc = await User.findById(req.user.id).select('+password_hash');
    if (!userDoc) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    const valid = await bcrypt.compare(password, userDoc.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Mot de passe incorrect' });
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
    res.json({ success: true, data: { token: stepUpToken } });
  } catch (err) {
    console.error('createAdminStepUp error:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const notImplemented = (_req, res) =>
  res.status(501).json({ success: false, message: 'Fonctionnalite non disponible' });

const startTwoFactorSetup = notImplemented;
const confirmTwoFactorSetup = notImplemented;
const verifyTwoFactorLogin = notImplemented;
const enrollTwoFactor = notImplemented;
const enableTwoFactor = notImplemented;
const disableTwoFactor = notImplemented;

module.exports = {
  register, login, getMe, updateProfile, changePassword,
  verifyEmail, resendVerification, forgotPassword, resetPassword,
  logout, listSessions, revokeSession, revokeOtherSessions,
  createAdminStepUp,
  startTwoFactorSetup, confirmTwoFactorSetup, verifyTwoFactorLogin,
  enrollTwoFactor, enableTwoFactor, disableTwoFactor,
};