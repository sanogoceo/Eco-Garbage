require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');

if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET is not set in environment variables. Exiting.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  for (const name of ['JWT_SECRET', 'DATA_ENCRYPTION_KEY', 'PAYMENT_WEBHOOK_SECRET']) {
    const value = process.env[name] || '';
    if (value.length < 32 || /replace_me/i.test(value)) {
      console.error(`FATAL: ${name} must be a random secret of at least 32 characters. Exiting.`);
      process.exit(1);
    }
  }
}

const connectDB = require('./config/db');
const routes = require('./routes');
const { startRecurringScheduler } = require('./services/recurringService');
const { initializeRealtime } = require('./services/realtimeService');
const {
  startSensitiveDataScheduler,
} = require('./services/sensitiveDataLifecycle');
const {
  startCollectorVerificationScheduler,
} = require('./services/collectorVerificationService');
const {
  startNotificationDeliveryScheduler,
} = require('./services/notificationService');
const { startBackupScheduler } = require('./services/backupService');
const { monitoringMiddleware } = require('./middleware/monitoring');
const { globalApiLimiter } = require('./middleware/rateLimits');
const { rejectMongoOperators } = require('./middleware/rejectMongoOperators');
const {
  startHealthMonitoringScheduler,
} = require('./services/monitoringService');

const app = express();
const PORT = process.env.PORT || 5000;
let serverStarted = false;

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173'
  );
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    const corsError = new Error(`CORS: origin ${origin} not allowed`);
    corsError.status = 403;
    return callback(corsError);
  },
  credentials: true,
}));
app.use(express.json({
  limit: '256kb',
  verify: (req, res, buffer) => {
    if (req.originalUrl === '/api/payments/webhook') {
      req.rawBody = Buffer.from(buffer);
    }
  },
}));
app.use(express.urlencoded({ extended: true }));
morgan.token('safe-url', (req) => (req.originalUrl || req.url).replace(/([?&]token=)[^&]*/gi, '$1[REDACTED]'));
app.use(morgan(process.env.NODE_ENV === 'production'
  ? ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
  : 'dev'));
app.use(monitoringMiddleware);

app.use('/api', globalApiLimiter, rejectMongoOperators, routes);

app.get('/health', (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? 'ok' : 'degraded',
    database: databaseConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});
app.get('/', (req, res) => {
  res.json({ name: 'EcoGarbage API', status: 'ok', docs: '/health' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.path} non trouvée` });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err?.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: err.code === 'LIMIT_FILE_SIZE'
        ? 'Chaque image doit faire moins de 5 Mo.'
        : 'Fichiers invalides ou trop nombreux.',
    });
  }
  if (err?.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ success: false, message: 'Requete invalide ou trop volumineuse' });
  }
  res.status(500).json({ success: false, message: 'Erreur interne du serveur' });
});

const httpServer = http.createServer(app);
initializeRealtime(httpServer, allowedOrigins);

const startServer = async (port = PORT) => {
  if (serverStarted) return httpServer;
  await connectDB();
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  serverStarted = true;
  const address = httpServer.address();
  console.log(`Serveur EcoGarbage demarre sur http://localhost:${address.port}`);
  console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
  startRecurringScheduler();
  startSensitiveDataScheduler();
  startCollectorVerificationScheduler();
  startNotificationDeliveryScheduler();
  startBackupScheduler();
  startHealthMonitoringScheduler();
  return httpServer;
};

const stopServer = async () => {
  if (!serverStarted) return;
  await new Promise((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve()));
  });
  serverStarted = false;
};

if (require.main === module) {
  startServer().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = app;
module.exports.httpServer = httpServer;
module.exports.startServer = startServer;
module.exports.stopServer = stopServer;
