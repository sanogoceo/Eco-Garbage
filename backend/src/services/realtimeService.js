const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const PickupRequest = require('../models/PickupRequest');
const User = require('../models/User');
const AuthSession = require('../models/AuthSession');

let io = null;
const connectionAttempts = new Map();

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const consumeFixedWindow = (
  store,
  key,
  { limit, windowMs },
  now = Date.now()
) => {
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  current.count += 1;
  return {
    allowed: true,
    remaining: limit - current.count,
    retryAfterSeconds: 0,
  };
};

const initializeRealtime = (httpServer, allowedOrigins) => {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)
          || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
          return callback(null, true);
        }
        callback(new Error('Origine Socket.IO interdite'));
      },
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const connectionLimit = consumeFixedWindow(
        connectionAttempts,
        socket.handshake.address || 'unknown',
        {
          limit: positiveInteger(process.env.SOCKET_CONNECTION_RATE_LIMIT_PER_MINUTE, 30),
          windowMs: 60_000,
        }
      );
      if (!connectionLimit.allowed) {
        const error = new Error('Trop de connexions temps reel');
        error.data = {
          code: 'RATE_LIMITED',
          retry_after_seconds: connectionLimit.retryAfterSeconds,
        };
        return next(error);
      }
      const token = socket.handshake.auth?.token;
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.type !== 'access' || !decoded.sid) {
        return next(new Error('Session invalide'));
      }
      const session = await AuthSession.exists({
        uuid: decoded.sid,
        user_id: decoded.id,
        revoked_at: null,
        expires_at: { $gt: new Date() },
      });
      if (!session) return next(new Error('Session revoquee'));
      const user = await User.findById(decoded.id).select('role is_active is_verified').lean();
      if (!user?.is_active || !user?.is_verified) return next(new Error('Non autorise'));
      socket.user = { id: user._id.toString(), role: user.role };
      next();
    } catch {
      next(new Error('Authentification Socket.IO invalide'));
    }
  });

  io.on('connection', (socket) => {
    const roomJoins = new Map();
    socket.on('join_request', async (requestUuid, acknowledge) => {
      try {
        const joinLimit = consumeFixedWindow(
          roomJoins,
          'join_request',
          {
            limit: positiveInteger(process.env.SOCKET_JOIN_RATE_LIMIT_PER_MINUTE, 20),
            windowMs: 60_000,
          }
        );
        if (!joinLimit.allowed) {
          return acknowledge?.({
            success: false,
            code: 'RATE_LIMITED',
            retry_after_seconds: joinLimit.retryAfterSeconds,
          });
        }
        const request = await PickupRequest.findOne({ uuid: requestUuid })
          .select('user_id collector_id').lean();
        const allowed = request && (
          socket.user.role === 'admin'
          || request.user_id.toString() === socket.user.id
          || request.collector_id?.toString() === socket.user.id
        );
        if (!allowed) return acknowledge?.({ success: false });
        socket.join(`request:${requestUuid}`);
        acknowledge?.({ success: true });
      } catch {
        acknowledge?.({ success: false });
      }
    });
  });

  return io;
};

const emitRequestEvent = (requestUuid, event, payload) => {
  io?.to(`request:${requestUuid}`).emit(event, payload);
};

module.exports = {
  emitRequestEvent,
  initializeRealtime,
  _internals: { consumeFixedWindow },
};
