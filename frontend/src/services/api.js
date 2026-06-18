import axios from 'axios';






const rawBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');
const API_BASE = rawBase.endsWith('/api') ? rawBase : `${rawBase}/api`;

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

const safeLocalStorageGet = (key, fallback = null) => {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn('localStorage get failed', key, error);
    return fallback;
  }
};

const safeLocalStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('localStorage set failed', key, error);
  }
};

const safeLocalStorageRemove = (key) => {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn('localStorage remove failed', key, error);
  }
};

const getInstallationId = () => {
  const storageKey = 'eco_installation_id';
  let installationId = safeLocalStorageGet(storageKey);
  if (!installationId) {
    installationId = globalThis.crypto?.randomUUID?.()
      || `eco-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    safeLocalStorageSet(storageKey, installationId);
  }
  return installationId;
};

const OFFLINE_CACHE_PREFIX = 'eco_api_cache:';
const CACHEABLE_GET_PATHS = [
  '/categories',
  '/requests',
  '/collector/tasks',
  '/collector/available-requests',
  '/collector/stats',
  '/admin/dashboard',
];

const getCacheKey = (config) => {
  const userId = (() => {
    try { return JSON.parse(safeLocalStorageGet('eco_user'))?.uuid || 'anonymous'; }
    catch { return 'anonymous'; }
  })();
  const params = new URLSearchParams(config.params || {}).toString();
  return `${OFFLINE_CACHE_PREFIX}${userId}:${config.url}${params ? `?${params}` : ''}`;
};

const isCacheableGet = (config) => (
  config?.method?.toLowerCase() === 'get'
  && CACHEABLE_GET_PATHS.some((path) => (
    config.url === path || config.url?.startsWith(`${path}/`)
  ))
);


api.interceptors.request.use((config) => {
  const token = safeLocalStorageGet('eco_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers['X-Eco-Device-ID'] = getInstallationId();
  config.headers['X-Eco-Platform'] = /Android/i.test(navigator.userAgent)
    ? 'android'
    : /iPhone|iPad/i.test(navigator.userAgent)
      ? 'ios'
      : 'web';
  config.headers['X-Eco-Device-Name'] = navigator.userAgent.slice(0, 100);
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
    delete config.headers['content-type'];
  }
  return config;
});



api.interceptors.response.use(
  (res) => {
    if (isCacheableGet(res.config)) {
      try {
        safeLocalStorageSet(getCacheKey(res.config), JSON.stringify({
          data: res.data,
          cached_at: new Date().toISOString(),
        }));
      } catch {
        // A failed cache write must never block the live API response.
      }
    }
    return res;
  },
  (err) => {
    const isAuthEndpoint = err.config?.url?.startsWith('/auth/');
    if (err.response?.status === 401 && !isAuthEndpoint) {
      const authorization = err.config?.headers?.get?.('Authorization')
        || err.config?.headers?.Authorization
        || err.config?.headers?.authorization;
      const requestToken = authorization?.replace(/^Bearer\s+/i, '');
      const currentToken = safeLocalStorageGet('eco_token');
      if (!requestToken || requestToken === currentToken) {
        safeLocalStorageRemove('eco_token');
        safeLocalStorageRemove('eco_user');
        window.location.href = '/login';
      }
    }
    if (!err.response && isCacheableGet(err.config)) {
      try {
        const cached = JSON.parse(safeLocalStorageGet(getCacheKey(err.config)));
        if (cached?.data) {
          return Promise.resolve({
            data: cached.data,
            status: 200,
            statusText: 'Offline cache',
            headers: { 'x-eco-offline-cache': 'true' },
            config: err.config,
            request: err.request,
          });
        }
      } catch {
        // Fall through to the original network error.
      }
    }
    return Promise.reject(err);
  }
);

export default api;


export const authApi = {
  register: (data) => api.post('/auth/register', data, {
    timeout: data instanceof FormData ? 120000 : 15000,
  }),
  login: (data) => api.post('/auth/login', data),
  startAdminTwoFactorSetup: (challengeToken) => api.post('/auth/admin/2fa/setup', {
    challenge_token: challengeToken,
  }),
  confirmAdminTwoFactorSetup: (data) => api.post('/auth/admin/2fa/confirm', data),
  verifyAdminTwoFactor: (data) => api.post('/auth/admin/2fa/verify', data),
  verifyEmail: (token) => api.get('/auth/verify-email', { params: { token } }),
  resendVerification: (email) => api.post('/auth/resend-verification', { email }),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (data) => api.post('/auth/reset-password', data),
  me: () => api.get('/auth/me'),
  updateProfile: (data) => api.put('/auth/profile', data),
  changePassword: (data) => api.put('/auth/password', data),
  logout: (authToken) => api.post('/auth/logout', null, authToken
    ? { headers: { Authorization: `Bearer ${authToken}` } }
    : {}),
  sessions: () => api.get('/auth/sessions'),
  revokeSession: (uuid) => api.delete(`/auth/sessions/${uuid}`),
  revokeOtherSessions: () => api.post('/auth/sessions/revoke-others'),
  enrollAdminTwoFactor: () => api.post('/auth/admin/2fa/enroll'),
  enableAdminTwoFactor: (code) => api.post('/auth/admin/2fa/enable', { code }),
  disableAdminTwoFactor: (data) => api.delete('/auth/admin/2fa', { data }),
  adminStepUp: (data) => api.post('/auth/admin/step-up', data),
};

export const collectorApplicationApi = {
  current: () => api.get('/collector-applications/current'),
  submit: (data) => api.post('/collector-applications', data, { timeout: 60000 }),
  replaceDocuments: (uuid, data) => api.put(
    `/collector-applications/${uuid}/documents`,
    data,
    { timeout: 60000 }
  ),
};


export const requestApi = {
  list: (params) => api.get('/requests', {
    params: {
      ...params,
      ...(window.location.pathname.startsWith('/dashboard') ? { perspective: 'user' } : {}),
    },
  }),
  get: (uuid) => api.get(`/requests/${uuid}`),
  collectorPhoto: (uuid) => api.get(
    `/requests/${uuid}/collector-photo`,
    { responseType: 'blob' }
  ),
  create: (data) => api.post('/requests', data),
  estimate: (data) => api.post('/requests/estimate', data),
  serviceSlots: (params) => api.get('/requests/service-slots', { params }),
  updateStatus: (uuid, data) => api.put(`/requests/${uuid}/status`, data),
  updateLocation: (uuid, data) => api.put(`/requests/${uuid}/location`, data),
  uploadProof: (uuid, data) => api.post(`/requests/${uuid}/proofs`, data, { timeout: 60000 }),
  proof: (uuid, proofId) => api.get(`/requests/${uuid}/proofs/${proofId}`, { responseType: 'blob' }),
  completionCode: (uuid) => api.get(`/requests/${uuid}/completion-code`),
  assign: (uuid, data) => api.put(`/requests/${uuid}/assign`, data),
  archive: (uuid) => api.put(`/requests/${uuid}/archive`),
  restore: (uuid) => api.put(`/requests/${uuid}/restore`),
  cancel: (uuid, data) => api.delete(`/requests/${uuid}`, { data }),
};

export const chatApi = {
  list: (uuid) => api.get(`/requests/${uuid}/messages`),
  send: (uuid, body) => api.post(`/requests/${uuid}/messages`, { body }),
};

export const recurringApi = {
  list: () => api.get('/recurring-schedules'),
  create: (data) => api.post('/recurring-schedules', data),
  update: (uuid, data) => api.put(`/recurring-schedules/${uuid}`, data),
};

export const businessContractApi = {
  list: () => api.get('/business-contracts'),
  create: (data) => api.post('/business-contracts', data),
  update: (uuid, data) => api.put(`/business-contracts/${uuid}`, data),
  dashboard: (uuid, params) => api.get(`/business-contracts/${uuid}/dashboard`, { params }),
  invoices: (uuid) => api.get(`/business-contracts/${uuid}/invoices`),
  invoiceDownload: (uuid, invoiceUuid) => api.get(
    `/business-contracts/${uuid}/invoices/${invoiceUuid}/download`,
    { responseType: 'blob' }
  ),
  monthlyStatement: (uuid, month) => api.get(
    `/business-contracts/${uuid}/monthly-statement`,
    { params: { month }, responseType: 'blob' }
  ),
};

export const deviceApi = {
  register: (data) => api.post('/devices', data),
  unregister: (token, authToken) => api.delete('/devices', {
    data: { token },
    ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}),
  }),
};


export const categoryApi = {
  list: () => api.get('/categories'),
};


export const notifApi = {
  list: () => api.get('/notifications'),
  readAll: () => api.put('/notifications/read-all'),
};


export const paymentApi = {
  list: () => api.get('/payments'),
  initiate: (data, idempotencyKey) => api.post('/payments/initiate', data, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }),
  pay: (data, idempotencyKey) => api.post('/payments/pay', data, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }),
  receipt: (uuid) => api.get(`/payments/${uuid}/receipt`, { responseType: 'blob' }),
};


export const complaintApi = {
  mine: (params) => api.get('/complaints/mine', { params }),
  eligibleRequests: (params) => api.get('/complaints/eligible-requests', { params }),
  get: (uuid) => api.get(`/complaints/${uuid}`),
  create: (data) => api.post('/complaints', data, { timeout: 60000 }),
  messages: (uuid) => api.get(`/complaints/${uuid}/messages`),
  sendMessage: (uuid, body) => api.post(`/complaints/${uuid}/messages`, { body }),
  addEvidence: (uuid, data) => api.post(`/complaints/${uuid}/evidence`, data, { timeout: 60000 }),
  evidence: (uuid, evidenceId) => api.get(
    `/complaints/${uuid}/evidence/${evidenceId}`,
    { responseType: 'blob' }
  ),
};


export const ratingApi = {
  create: (data) => api.post('/ratings', data),
};


export const collectorApi = {
  tasks: (params) => api.get('/collector/tasks', { params }),
  availableRequests: (params) => api.get('/collector/available-requests', { params }),
  stats: () => api.get('/collector/stats'),
  setAvailability: (data) => api.put('/collector/availability', data),
  updateLocation: (data) => api.put('/collector/location', data),
  wallet: (params) => api.get('/collector/wallet', { params }),
  requestWithdrawal: (data) => api.post('/collector/withdrawals', data),
};


export const adminApi = {
  dashboard: () => api.get('/admin/dashboard'),
  notificationDeliveries: (params) => api.get('/admin/notification-deliveries', { params }),
  retryNotificationDelivery: (id) => api.post(`/admin/notification-deliveries/${id}/retry`),
  auditLogs: (params) => api.get('/admin/audit-logs', { params }),
  fraudAlerts: (params) => api.get('/admin/fraud-alerts', { params }),
  reviewFraudAlert: (uuid, data) => api.put(`/admin/fraud-alerts/${uuid}`, data),
  collectorApplications: (params) => api.get('/admin/collector-applications', { params }),
  collectorApplication: (uuid) => api.get(`/admin/collector-applications/${uuid}`),
  collectorApplicationDocument: (uuid, type) => api.get(
    `/admin/collector-applications/${uuid}/documents/${type}`,
    { responseType: 'blob' }
  ),
  reviewCollectorApplication: (uuid, data, stepUpToken) => api.put(
    `/admin/collector-applications/${uuid}/review`,
    data,
    { headers: { 'X-Eco-Step-Up': stepUpToken } }
  ),
  requestCollectorDocuments: (uuid, data, stepUpToken) => api.put(
    `/admin/collector-applications/${uuid}/request-documents`,
    data,
    { headers: { 'X-Eco-Step-Up': stepUpToken } }
  ),
  users: (params) => api.get('/admin/users', { params }),
  createUser: (data) => api.post('/admin/users', data),
  toggleUser: (id, data, stepUpToken) => api.put(
    `/admin/users/${id}/status`,
    data,
    { headers: { 'X-Eco-Step-Up': stepUpToken } }
  ),
  deleteUser: (id) => api.delete(`/admin/users/${id}`),
  getCollectorDetails: (id) => api.get(`/admin/collectors/${id}`),
  updateHazardousCertification: (id, data, stepUpToken) => api.put(
    `/admin/collectors/${id}/hazardous-certification`,
    data,
    { headers: { 'X-Eco-Step-Up': stepUpToken } }
  ),
  complaints: (params) => api.get('/admin/complaints', { params }),
  reviewComplaint: (uuid, data) => api.put(`/admin/complaints/${uuid}/review`, data),
  decideComplaint: (uuid, data) => api.put(`/admin/complaints/${uuid}/decision`, data),
  respondComplaint: (uuid, data) => api.put(`/admin/complaints/${uuid}`, data),
  reports: (params) => api.get('/admin/reports', { params }),
  categories: () => api.get('/admin/categories'),
  createCategory: (data) => api.post('/admin/categories', data),
  updateCategory: (id, data) => api.put(`/admin/categories/${id}`, data),
  serviceConfigurations: () => api.get('/admin/service-configurations'),
  updateServiceConfiguration: (serviceType, data, stepUpToken) => api.put(
    `/admin/service-configurations/${serviceType}`,
    data,
    { headers: { 'X-Eco-Step-Up': stepUpToken } }
  ),
  businessContracts: (params) => api.get('/admin/business-contracts', { params }),
  reviewBusinessContract: (uuid, data, stepUpToken) => api.put(
    `/admin/business-contracts/${uuid}/review`,
    data,
    { headers: { 'X-Eco-Step-Up': stepUpToken } }
  ),
  updateBusinessContractTerms: (uuid, data, stepUpToken) => api.put(
    `/admin/business-contracts/${uuid}/terms`,
    data,
    { headers: { 'X-Eco-Step-Up': stepUpToken } }
  ),
  reviewBusinessContractSite: (uuid, siteId, data, stepUpToken) => api.put(
    `/admin/business-contracts/${uuid}/sites/${siteId}/review`,
    data,
    { headers: { 'X-Eco-Step-Up': stepUpToken } }
  ),
  generateBusinessInvoice: (uuid, data, stepUpToken) => api.post(
    `/admin/business-contracts/${uuid}/invoices`,
    data,
    { headers: { 'X-Eco-Step-Up': stepUpToken } }
  ),
  businessInvoices: (uuid) => api.get(`/admin/business-contracts/${uuid}/invoices`),
  businessInvoiceDownload: (uuid, invoiceUuid) => api.get(
    `/admin/business-contracts/${uuid}/invoices/${invoiceUuid}/download`,
    { responseType: 'blob' }
  ),
  updateBusinessInvoiceStatus: (uuid, invoiceUuid, data, stepUpToken) => api.put(
    `/admin/business-contracts/${uuid}/invoices/${invoiceUuid}/status`,
    data,
    { headers: { 'X-Eco-Step-Up': stepUpToken } }
  ),
  requests: (params) => api.get('/admin/requests', { params }),
  withdrawals: (params) => api.get('/admin/withdrawals', { params }),
  reviewWithdrawal: (uuid, data) => api.put(`/admin/withdrawals/${uuid}`, data),
  refundPayment: (uuid, data, idempotencyKey, stepUpToken) => api.post(
    `/admin/payments/${uuid}/refund`,
    data,
    {
      headers: {
        'Idempotency-Key': idempotencyKey,
        'X-Eco-Step-Up': stepUpToken,
      },
    }
  ),
};
