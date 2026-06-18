const crypto = require('crypto');
const DeviceToken = require('../models/DeviceToken');

let cachedAccessToken = null;
let accessTokenExpiresAt = 0;

const getServiceAccount = () => {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!encoded && !raw) return null;
  return JSON.parse(encoded ? Buffer.from(encoded, 'base64').toString('utf8') : raw);
};

const base64url = (value) => Buffer.from(value).toString('base64url');

const getAccessToken = async (serviceAccount) => {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsignedToken = `${header}.${claims}`;
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(unsignedToken),
    serviceAccount.private_key
  ).toString('base64url');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedToken}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error(`Firebase OAuth error ${response.status}`);
  const payload = await response.json();
  cachedAccessToken = payload.access_token;
  accessTokenExpiresAt = Date.now() + (Number(payload.expires_in) || 3600) * 1000;
  return cachedAccessToken;
};

const sendToToken = async ({ accessToken, projectId, token, payload }) => {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: String(payload.title || 'EcoGarbage'),
            body: String(payload.message || ''),
          },
          data: Object.fromEntries(
            Object.entries(payload.data || {}).map(([key, value]) => [key, String(value)])
          ),
          android: {
            priority: 'HIGH',
            notification: { channel_id: 'eco_garbage_updates' },
          },
        },
      }),
    }
  );
  if (response.ok) return { success: true, retryable: false };
  const error = await response.text();
  const invalid = response.status === 404
    || response.status === 400
    || error.includes('UNREGISTERED')
    || error.includes('INVALID_ARGUMENT');
  return {
    success: false,
    invalid,
    retryable: !invalid && (response.status === 429 || response.status >= 500),
    error: `FCM ${response.status}: ${error.slice(0, 300)}`,
  };
};

const sendPushToUser = async (userId, payload) => {
  const serviceAccount = getServiceAccount();
  if (!serviceAccount?.client_email || !serviceAccount?.private_key || !serviceAccount?.project_id) {
    return {
      sent: 0,
      failed: 0,
      unavailable: true,
      retryable: false,
      reason: 'Firebase Cloud Messaging non configure',
    };
  }
  const devices = await DeviceToken.find({
    user_id: userId,
    is_active: true,
  }).select('token').lean();
  if (!devices.length) {
    return {
      sent: 0,
      failed: 0,
      unavailable: true,
      retryable: false,
      reason: 'Aucun appareil actif',
    };
  }

  const accessToken = await getAccessToken(serviceAccount);
  const results = await Promise.all(devices.map((device) => sendToToken({
    accessToken,
    projectId: serviceAccount.project_id,
    token: device.token,
    payload,
  })));
  const invalidTokens = devices
    .filter((device, index) => results[index].invalid)
    .map((device) => device.token);
  if (invalidTokens.length) {
    await DeviceToken.updateMany(
      { token: { $in: invalidTokens } },
      { $set: { is_active: false } }
    );
  }
  const successfulTokens = devices
    .filter((device, index) => results[index].success)
    .map((device) => device.token);
  const failedTokens = devices
    .filter((device, index) => !results[index].success && !results[index].invalid)
    .map((device) => device.token);
  await Promise.all([
    successfulTokens.length
      ? DeviceToken.updateMany(
          { token: { $in: successfulTokens } },
          {
            $set: {
              last_delivery_at: new Date(),
              failure_count: 0,
              last_error: null,
            },
          }
        )
      : null,
    failedTokens.length
      ? DeviceToken.updateMany(
          { token: { $in: failedTokens } },
          {
            $inc: { failure_count: 1 },
            $set: {
              last_failure_at: new Date(),
              last_error: results.find((result) => result.error)?.error,
            },
          }
        )
      : null,
  ]);
  return {
    sent: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    invalid: invalidTokens.length,
    retryable: results.some((result) => result.retryable),
    reason: results.find((result) => result.error)?.error,
  };
};

module.exports = { sendPushToUser };
