const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuthSession = require('../models/AuthSession');
const AdminActionGrant = require('../models/AdminActionGrant');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token manquant ou invalide' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'access' || !decoded.sid) {
      return res.status(401).json({ success: false, message: 'Session invalide' });
    }
    const session = await AuthSession.findOne({
      uuid: decoded.sid,
      user_id: decoded.id,
      revoked_at: null,
      expires_at: { $gt: new Date() },
    }).lean();
    if (!session) {
      return res.status(401).json({ success: false, message: 'Session revoquee ou expiree' });
    }
    const user = await User.findById(decoded.id)
      .select('uuid email name role is_active is_verified')
      .lean();

    if (!user) {
      return res.status(401).json({ success: false, message: 'Compte introuvable' });
    }
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Compte suspendu' });
    }
    if (!user.is_verified) {
      return res.status(403).json({ success: false, message: 'Email non verifie' });
    }

    req.user = {
      id: user._id.toString(),
      uuid: user.uuid,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    req.session = {
      id: session._id.toString(),
      uuid: session.uuid,
    };
    if (!session.last_seen_at || Date.now() - new Date(session.last_seen_at).getTime() > 5 * 60_000) {
      AuthSession.updateOne(
        { _id: session._id, revoked_at: null },
        { $set: { last_seen_at: new Date() } }
      ).catch((updateError) => {
        console.error('AuthSession last_seen update failed', updateError);
      });
    }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token expire ou invalide' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Non authentifie' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Acces interdit : role insuffisant' });
  }
  next();
};

const requireAdminStepUp = (scope) => async (req, res, next) => {
  const token = req.get('X-Eco-Step-Up');
  if (!token) {
    return res.status(428).json({
      success: false,
      code: 'ADMIN_STEP_UP_REQUIRED',
      message: 'Confirmation administrateur renforcee requise',
    });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (
      decoded.type !== 'admin_step_up'
      || decoded.id !== req.user.id
      || decoded.sid !== req.session.uuid
      || decoded.scope !== scope
      || !decoded.grant
    ) {
      throw new Error('Invalid step-up token');
    }
    const grant = await AdminActionGrant.findOneAndUpdate(
      {
        uuid: decoded.grant,
        user_id: req.user.id,
        session_uuid: req.session.uuid,
        scope,
        consumed_at: null,
        expires_at: { $gt: new Date() },
      },
      { $set: { consumed_at: new Date() } },
      { new: true }
    );
    if (!grant) throw new Error('Step-up grant already consumed');
    req.adminStepUp = decoded;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      code: 'ADMIN_STEP_UP_INVALID',
      message: 'Confirmation renforcee invalide ou expiree',
    });
  }
};

module.exports = { authMiddleware, requireAdminStepUp, requireRole };
