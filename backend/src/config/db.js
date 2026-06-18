const mongoose = require('mongoose');
require('dotenv').config();

let connectionPromise = null;

const mongoUri = () => process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/eco_garbage_db';

const getMongoOptions = () => {
  const maxPoolSize = Math.max(
    5,
    Number.parseInt(process.env.MONGO_MAX_POOL_SIZE, 10) || 20
  );
  const minPoolSize = Math.min(
    maxPoolSize,
    Math.max(0, Number.parseInt(process.env.MONGO_MIN_POOL_SIZE, 10) || 2)
  );

  return {
    autoIndex: process.env.NODE_ENV !== 'production',
    maxPoolSize,
    minPoolSize,
    maxIdleTimeMS: 30_000,
    serverSelectionTimeoutMS: 5_000,
    socketTimeoutMS: 45_000,
  };
};

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  if (connectionPromise) {
    return connectionPromise;
  }

  try {
    connectionPromise = mongoose.connect(mongoUri(), getMongoOptions());
    await connectionPromise;
    console.log('MongoDB connectee');
    return mongoose.connection;
  } catch (err) {
    console.error('Erreur connexion MongoDB:', err.message);
    throw err;
  } finally {
    connectionPromise = null;
  }
};

connectDB.ensureConnected = async ({ timeoutMs = 6_000, intervalMs = 150 } = {}) => {
  if (mongoose.connection.readyState === 1) return true;

  if ([0, 3].includes(mongoose.connection.readyState)) {
    connectDB().catch(() => null);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (mongoose.connection.readyState === 1) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return mongoose.connection.readyState === 1;
};

module.exports = connectDB;
