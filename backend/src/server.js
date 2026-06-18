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
if (process.env.NODE_ENV === 'production' && !process.env.DATA_ENCRYPTION_KEY) {
  console.error('FATAL: DATA_ENCRYPTION_KEY is required in production. Exiting.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !process.env.PAYMENT_WEBHOOK_SECRET) {
  console.error('FATAL: PAYMENT_WEBHOOK_SECRET is required in production. Exiting.');
  process.exit(1);
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
    if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buffer) => {
    if (req.originalUrl === '/api/payments/webhook') {
      req.rawBody = Buffer.from(buffer);
    }
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(monitoringMiddleware);

app.use('/api', globalApiLimiter, routes);

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
