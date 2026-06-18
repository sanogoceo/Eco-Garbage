const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const router = express.Router();
const {
  authMiddleware,
  requireAdminStepUp,
  requireRole,
} = require('../middleware/auth');
const {
  chatReadLimiter,
  chatWriteLimiter,
  expensiveOperationLimiter,
  gpsLimiter,
  notificationLimiter,
  requestReadLimiter,
  webhookLimiter,
} = require('../middleware/rateLimits');

const auth = require('../controllers/authController');
const req_ = require('../controllers/requestController');
const admin = require('../controllers/adminController');
const misc = require('../controllers/miscController');
const collectorApplications = require('../controllers/collectorApplicationController');
const chat = require('../controllers/chatController');
const devices = require('../controllers/deviceController');
const recurring = require('../controllers/recurringController');
const wallet = require('../controllers/walletController');
const payments = require('../controllers/paymentController');
const complaints = require('../controllers/complaintController');
const notificationDeliveries = require('../controllers/notificationDeliveryController');
const fraud = require('../controllers/fraudController');
const businessContracts = require('../controllers/businessContractController');

const collectorApplicationUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png'].includes(file.mimetype));
  },
    limits: { fileSize: 5 * 1024 * 1024, files: 5 },
});

const pickupProofUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png'].includes(file.mimetype)),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});


const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number.parseInt(process.env.AUTH_RATE_LIMIT_PER_15_MINUTES, 10) || 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

const complaintEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png'].includes(file.mimetype)),
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
});

const collectorApplicationLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: Number.parseInt(process.env.COLLECTOR_APPLICATION_RATE_LIMIT_PER_DAY, 10) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives de candidature. Reessayez plus tard.' },
});

const sensitiveActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number.parseInt(process.env.SENSITIVE_ACTION_RATE_LIMIT_PER_HOUR, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives. Reessayez plus tard.' },
});

const sensitiveReadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number.parseInt(process.env.SENSITIVE_READ_RATE_LIMIT_PER_HOUR, 10) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de consultations de documents sensibles.' },
});

const adminStepUpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.parseInt(process.env.ADMIN_STEP_UP_RATE_LIMIT_PER_15_MINUTES, 10) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Trop de confirmations administrateur. Reessayez dans 15 minutes.',
  },
});


router.post('/auth/register', authLimiter, auth.register);
router.post('/auth/login', authLimiter, auth.login);
router.post('/auth/admin/2fa/setup', authLimiter, auth.startTwoFactorSetup);
router.post('/auth/admin/2fa/confirm', authLimiter, auth.confirmTwoFactorSetup);
router.post('/auth/admin/2fa/verify', authLimiter, auth.verifyTwoFactorLogin);
router.get('/auth/verify-email', auth.verifyEmail);
router.post('/auth/resend-verification', authLimiter, auth.resendVerification);
router.post('/auth/forgot-password', authLimiter, auth.forgotPassword);
router.post('/auth/reset-password', authLimiter, auth.resetPassword);
router.get('/auth/me', authMiddleware, auth.getMe);
router.put('/auth/profile', authMiddleware, auth.updateProfile);
router.put('/auth/password', authMiddleware, auth.changePassword);
router.post('/auth/logout', authMiddleware, auth.logout);
router.get('/auth/sessions', authMiddleware, auth.listSessions);
router.delete('/auth/sessions/:uuid', authMiddleware, auth.revokeSession);
router.post('/auth/sessions/revoke-others', authMiddleware, auth.revokeOtherSessions);
router.post('/auth/admin/2fa/enroll', authMiddleware, requireRole('admin'), auth.enrollTwoFactor);
router.post('/auth/admin/2fa/enable', authMiddleware, requireRole('admin'), auth.enableTwoFactor);
router.delete('/auth/admin/2fa', authMiddleware, requireRole('admin'), auth.disableTwoFactor);
router.post('/auth/admin/step-up', authMiddleware, requireRole('admin'), adminStepUpLimiter, auth.createAdminStepUp);

router.post('/collector-applications', authMiddleware, requireRole('user', 'collector'), collectorApplicationLimiter, collectorApplicationUpload.fields([
  { name: 'profile_photo', maxCount: 1 },
  { name: 'id_front', maxCount: 1 },
  { name: 'id_back', maxCount: 1 },
  { name: 'selfie_with_id', maxCount: 1 },
  { name: 'vehicle_photo', maxCount: 1 },
]), collectorApplications.submitApplication);
router.get('/collector-applications/current', authMiddleware, collectorApplications.getCurrentApplication);
router.put('/collector-applications/:uuid/documents', authMiddleware, requireRole('user', 'collector'), collectorApplicationLimiter, collectorApplicationUpload.fields([
  { name: 'profile_photo', maxCount: 1 },
  { name: 'id_front', maxCount: 1 },
  { name: 'id_back', maxCount: 1 },
  { name: 'selfie_with_id', maxCount: 1 },
  { name: 'vehicle_photo', maxCount: 1 },
]), collectorApplications.replaceDocuments);

router.get('/categories', misc.getCategories);


router.get('/requests', authMiddleware, requestReadLimiter, req_.getRequests);
router.post('/requests', authMiddleware, requireRole('user', 'collector'), req_.createRequest);
router.post('/requests/estimate', authMiddleware, requireRole('user', 'collector'), expensiveOperationLimiter, req_.estimatePrice);
router.get('/requests/service-slots', authMiddleware, requireRole('user', 'collector'), req_.getServiceSlots);
router.get('/requests/:uuid', authMiddleware, requestReadLimiter, req_.getRequestById);
router.get('/requests/:uuid/collector-photo', authMiddleware, requestReadLimiter, req_.getCollectorPhoto);
router.put('/requests/:uuid/status', authMiddleware, requireRole('collector', 'admin'), req_.updateStatus);
router.put('/requests/:uuid/location', authMiddleware, requireRole('collector'), gpsLimiter, req_.updateLocation);
router.post('/requests/:uuid/proofs', authMiddleware, requireRole('collector'), sensitiveActionLimiter, pickupProofUpload.single('photo'), req_.uploadProof);
router.get('/requests/:uuid/proofs/:proofId', authMiddleware, sensitiveReadLimiter, req_.getProof);
router.get('/requests/:uuid/completion-code', authMiddleware, requireRole('user', 'collector'), req_.getCompletionCode);
router.put('/requests/:uuid/assign', authMiddleware, requireRole('admin'), req_.assignCollector);
router.put('/requests/:uuid/archive', authMiddleware, requireRole('user', 'collector'), req_.archiveRequest);
router.put('/requests/:uuid/restore', authMiddleware, requireRole('user', 'collector'), req_.restoreRequest);
router.delete('/requests/:uuid', authMiddleware, requireRole('user', 'collector'), req_.cancelRequest);

router.get('/requests/:uuid/messages', authMiddleware, chatReadLimiter, chat.getMessages);
router.post('/requests/:uuid/messages', authMiddleware, chatWriteLimiter, chat.sendMessage);

router.get('/recurring-schedules', authMiddleware, requireRole('user', 'collector'), recurring.listSchedules);
router.post('/recurring-schedules', authMiddleware, requireRole('user', 'collector'), recurring.createSchedule);
router.put('/recurring-schedules/:uuid', authMiddleware, requireRole('user', 'collector'), recurring.updateSchedule);

router.get('/business-contracts', authMiddleware, requireRole('user', 'collector'), businessContracts.listContracts);
router.post('/business-contracts', authMiddleware, requireRole('user', 'collector'), businessContracts.createContract);
router.put('/business-contracts/:uuid', authMiddleware, requireRole('user', 'collector'), businessContracts.updateContract);
router.get('/business-contracts/:uuid/dashboard', authMiddleware, requireRole('user', 'collector'), businessContracts.getBusinessDashboard);
router.get('/business-contracts/:uuid/invoices', authMiddleware, requireRole('user', 'collector'), businessContracts.listInvoices);
router.get('/business-contracts/:uuid/invoices/:invoiceUuid/download', authMiddleware, requireRole('user', 'collector'), businessContracts.downloadInvoice);
router.get('/business-contracts/:uuid/monthly-statement', authMiddleware, requireRole('user', 'collector'), businessContracts.getMonthlyStatement);

router.get('/notifications', authMiddleware, notificationLimiter, misc.getNotifications);
router.put('/notifications/read-all', authMiddleware, notificationLimiter, misc.markAllRead);
router.post('/devices', authMiddleware, sensitiveActionLimiter, devices.registerDevice);
router.delete('/devices', authMiddleware, devices.unregisterDevice);


router.post('/ratings', authMiddleware, requireRole('user', 'collector'), misc.createRating);


router.get('/complaints/eligible-requests', authMiddleware, requireRole('user', 'collector'), complaints.getEligibleRequests);
router.get('/complaints/mine', authMiddleware, requireRole('user', 'collector'), complaints.getMyComplaints);
router.post('/complaints', authMiddleware, requireRole('user', 'collector'), sensitiveActionLimiter, complaintEvidenceUpload.array('photos', 4), complaints.createComplaint);
router.get('/complaints/:uuid', authMiddleware, complaints.getComplaint);
router.get('/complaints/:uuid/messages', authMiddleware, complaints.getMessages);
router.post('/complaints/:uuid/messages', authMiddleware, chatWriteLimiter, complaints.sendMessage);
router.post('/complaints/:uuid/evidence', authMiddleware, sensitiveActionLimiter, complaintEvidenceUpload.array('photos', 4), complaints.addEvidence);
router.get('/complaints/:uuid/evidence/:evidenceId', authMiddleware, sensitiveReadLimiter, complaints.getEvidence);


router.post('/payments/webhook', webhookLimiter, payments.paymentWebhook);
router.get('/payments', authMiddleware, payments.getPayments);
router.post('/payments/initiate', authMiddleware, requireRole('user', 'collector'), sensitiveActionLimiter, payments.initiatePayment);
router.post('/payments/pay', authMiddleware, requireRole('user', 'collector'), sensitiveActionLimiter, payments.initiatePayment);
router.get('/payments/:uuid/receipt', authMiddleware, payments.getReceipt);


router.get('/collector/tasks', authMiddleware, requireRole('collector'), misc.getCollectorTasks);
router.get('/collector/available-requests', authMiddleware, requireRole('collector'), misc.getAvailableCollectorRequests);
router.put('/collector/availability', authMiddleware, requireRole('collector'), misc.updateCollectorAvailability);
router.put('/collector/location', authMiddleware, requireRole('collector'), gpsLimiter, misc.updateCollectorLocation);
router.get('/collector/stats', authMiddleware, requireRole('collector'), misc.getCollectorStats);
router.get('/collector/wallet', authMiddleware, requireRole('collector'), wallet.getWallet);
router.post('/collector/withdrawals', authMiddleware, requireRole('collector'), sensitiveActionLimiter, wallet.requestWithdrawal);


router.get('/admin/dashboard', authMiddleware, requireRole('admin'), admin.getDashboard);
router.get('/admin/audit-logs', authMiddleware, requireRole('admin'), sensitiveReadLimiter, admin.getAuditLogs);
router.get('/admin/fraud-alerts', authMiddleware, requireRole('admin'), sensitiveReadLimiter, fraud.listFraudAlerts);
router.put('/admin/fraud-alerts/:uuid', authMiddleware, requireRole('admin'), sensitiveActionLimiter, fraud.updateFraudAlert);
router.get('/admin/notification-deliveries', authMiddleware, requireRole('admin'), notificationDeliveries.listNotificationDeliveries);
router.post('/admin/notification-deliveries/:id/retry', authMiddleware, requireRole('admin'), sensitiveActionLimiter, notificationDeliveries.retryDelivery);
router.get('/admin/collector-applications', authMiddleware, requireRole('admin'), collectorApplications.getApplications);
router.get('/admin/collector-applications/:uuid', authMiddleware, requireRole('admin'), collectorApplications.getApplication);
router.put('/admin/collector-applications/:uuid/review', authMiddleware, requireRole('admin'), requireAdminStepUp('collector_review'), collectorApplications.reviewApplication);
router.put('/admin/collector-applications/:uuid/request-documents', authMiddleware, requireRole('admin'), requireAdminStepUp('collector_review'), collectorApplications.requestDocumentReplacement);
router.get('/admin/collector-applications/:uuid/documents/:type', authMiddleware, requireRole('admin'), sensitiveReadLimiter, collectorApplications.getDocument);
router.get('/admin/users', authMiddleware, requireRole('admin'), admin.getUsers);
router.get('/admin/collectors/:id', authMiddleware, requireRole('admin'), sensitiveReadLimiter, admin.getCollectorDetails);
router.put('/admin/collectors/:id/hazardous-certification', authMiddleware, requireRole('admin'), requireAdminStepUp('collector_review'), admin.updateHazardousCertification);
router.post('/admin/users', authMiddleware, requireRole('admin'), admin.createUser);
router.put('/admin/users/:id/status', authMiddleware, requireRole('admin'), requireAdminStepUp('user_status'), admin.toggleUserStatus);
router.delete('/admin/users/:id', authMiddleware, requireRole('admin'), admin.deleteUser);
router.get('/admin/complaints', authMiddleware, requireRole('admin'), complaints.getAdminComplaints);
router.put('/admin/complaints/:uuid/review', authMiddleware, requireRole('admin'), complaints.updateReviewStatus);
router.put('/admin/complaints/:uuid/decision', authMiddleware, requireRole('admin'), sensitiveActionLimiter, complaints.decideComplaint);
router.put('/admin/complaints/:uuid', authMiddleware, requireRole('admin'), complaints.decideComplaint);
router.get('/admin/reports', authMiddleware, requireRole('admin'), admin.getReports);
router.get('/admin/withdrawals', authMiddleware, requireRole('admin'), wallet.getWithdrawals);
router.put('/admin/withdrawals/:uuid', authMiddleware, requireRole('admin'), wallet.reviewWithdrawal);
router.post('/admin/payments/:uuid/refund', authMiddleware, requireRole('admin'), requireAdminStepUp('payment_refund'), sensitiveActionLimiter, payments.requestRefund);
router.get('/admin/categories', authMiddleware, requireRole('admin'), admin.getCategories);
router.post('/admin/categories', authMiddleware, requireRole('admin'), admin.createCategory);
router.put('/admin/categories/:id', authMiddleware, requireRole('admin'), admin.updateCategory);
router.get('/admin/service-configurations', authMiddleware, requireRole('admin'), admin.getServiceConfigurations);
router.put('/admin/service-configurations/:serviceType', authMiddleware, requireRole('admin'), requireAdminStepUp('service_configuration'), admin.updateServiceConfiguration);
router.get('/admin/business-contracts', authMiddleware, requireRole('admin'), businessContracts.listAdminContracts);
router.put('/admin/business-contracts/:uuid/review', authMiddleware, requireRole('admin'), requireAdminStepUp('business_contract_review'), businessContracts.reviewAdminContract);
router.put('/admin/business-contracts/:uuid/terms', authMiddleware, requireRole('admin'), requireAdminStepUp('business_contract_review'), businessContracts.updateAdminContractTerms);
router.put('/admin/business-contracts/:uuid/sites/:siteId/review', authMiddleware, requireRole('admin'), requireAdminStepUp('business_contract_review'), businessContracts.reviewAdminContractSite);
router.post('/admin/business-contracts/:uuid/invoices', authMiddleware, requireRole('admin'), requireAdminStepUp('business_contract_review'), businessContracts.generateAdminInvoice);
router.get('/admin/business-contracts/:uuid/invoices', authMiddleware, requireRole('admin'), businessContracts.listAdminInvoices);
router.get('/admin/business-contracts/:uuid/invoices/:invoiceUuid/download', authMiddleware, requireRole('admin'), businessContracts.downloadInvoice);
router.put('/admin/business-contracts/:uuid/invoices/:invoiceUuid/status', authMiddleware, requireRole('admin'), requireAdminStepUp('business_contract_review'), businessContracts.updateAdminInvoiceStatus);
router.get('/admin/requests', authMiddleware, requireRole('admin'), req_.getRequests);

module.exports = router;
