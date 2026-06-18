const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Payment = require('../models/Payment');
const PaymentWebhookEvent = require('../models/PaymentWebhookEvent');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { notifyUser } = require('../services/notificationService');
const { releaseEarning, reverseReleasedEarning } = require('../services/walletService');
const {
  normalizePhone,
  recordFraudAlert,
} = require('../services/fraudDetectionService');

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const PAYMENT_PROVIDERS = ['mtn_momo', 'orange_money', 'card_gateway', 'cash', 'sandbox'];
const PAYMENT_METHODS = ['mobile_money', 'card', 'bank_transfer', 'cash'];
const CM_PHONE_REGEX = /^(\+?237)?[62]\d{8}$/;

const secureEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const createWebhookSignature = ({ secret, timestamp, rawBody }) => crypto
  .createHmac('sha256', secret)
  .update(`${timestamp}.${rawBody}`)
  .digest('hex');

const verifyWebhookSignature = ({ secret, timestamp, signature, rawBody, now = Date.now() }) => {
  if (!secret || !timestamp || !signature || !rawBody) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)
    || Math.abs(now - timestampMs) > WEBHOOK_TOLERANCE_SECONDS * 1000) {
    return false;
  }
  return secureEqual(
    signature,
    createWebhookSignature({ secret, timestamp, rawBody })
  );
};

const buildReceiptNumber = (payment) => (
  payment.receipt_number
  || `ECO-${new Date().getUTCFullYear()}-${payment.uuid.replace(/-/g, '').slice(0, 12).toUpperCase()}`
);

const buildInvoiceNumber = (payment) => (
  payment.invoice_number
  || `FAC-${new Date().getUTCFullYear()}-${payment.uuid.replace(/-/g, '').slice(0, 12).toUpperCase()}`
);

const getPayments = async (req, res) => {
  try {
    const raw = await Payment.find({ user_id: req.user.id })
      .populate({
        path: 'request_id',
        select: 'uuid category_id service_type business_details',
        populate: { path: 'category_id', select: 'name' },
      })
      .sort({ created_at: -1 })
      .lean();
    const rows = raw.map((payment) => ({
      ...payment,
      id: payment._id.toString(),
      request_uuid: payment.request_id?.uuid,
      category_name: payment.request_id?.category_id?.name,
      service_type: payment.request_id?.service_type,
      business_details: payment.request_id?.business_details,
      request_id: payment.request_id?._id?.toString(),
    }));
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('getPayments error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const initiatePayment = async (req, res) => {
  try {
    const { payment_uuid, method, provider = 'sandbox', payer_phone } = req.body;
    const idempotencyKey = String(
      req.get('Idempotency-Key') || req.body.idempotency_key || ''
    ).trim();
    if (!payment_uuid || !method || !idempotencyKey) {
      return res.status(400).json({
        success: false,
        message: 'Paiement, methode et cle idempotente requis',
      });
    }
    if (!PAYMENT_METHODS.includes(method) || !PAYMENT_PROVIDERS.includes(provider)) {
      return res.status(400).json({ success: false, message: 'Methode ou fournisseur invalide' });
    }
    let normalizedPhone = normalizePhone(payer_phone);
    let accountPhone = '';
    if (method === 'mobile_money' && !normalizedPhone) {
      const user = await User.findById(req.user.id).select('phone').lean();
      accountPhone = normalizePhone(user?.phone);
      normalizedPhone = accountPhone;
    } else if (method === 'mobile_money') {
      const user = await User.findById(req.user.id).select('phone').lean();
      accountPhone = normalizePhone(user?.phone);
    }
    if (method === 'mobile_money' && !CM_PHONE_REGEX.test(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Numero Mobile Money camerounais valide requis',
      });
    }

    const existingByKey = await Payment.findOne({
      user_id: req.user.id,
      idempotency_key: idempotencyKey,
    }).lean();
    if (existingByKey) {
      if (existingByKey.uuid !== payment_uuid) {
        return res.status(409).json({
          success: false,
          message: 'Cette cle idempotente appartient a un autre paiement',
        });
      }
      return res.json({
        success: true,
        message: 'Tentative de paiement deja creee',
        data: {
          payment_uuid: existingByKey.uuid,
          status: existingByKey.status,
          transaction_ref: existingByKey.transaction_ref,
        },
      });
    }

    const payment = await Payment.findOne({
      uuid: payment_uuid,
      user_id: req.user.id,
    });
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Paiement introuvable' });
    }
    if (['completed', 'refund_pending', 'refunded'].includes(payment.status)) {
      return res.json({
        success: true,
        message: 'Paiement deja traite',
        data: {
          payment_uuid: payment.uuid,
          status: payment.status,
          receipt_number: payment.receipt_number,
        },
      });
    }
    if (payment.status === 'processing') {
      return res.json({
        success: true,
        message: 'Paiement deja en cours de confirmation',
        data: {
          payment_uuid: payment.uuid,
          status: payment.status,
          transaction_ref: payment.transaction_ref,
        },
      });
    }

    payment.method = method;
    payment.provider = provider;
    payment.payer_phone = normalizedPhone || undefined;
    payment.idempotency_key = idempotencyKey;
    payment.transaction_ref = `PAY-${uuidv4()}`;
    payment.status = 'processing';
    payment.initiated_at = new Date();
    await payment.save();

    if (method === 'mobile_money') {
      const sharedUsers = await Payment.distinct('user_id', {
        payer_phone: normalizedPhone,
        user_id: { $ne: req.user.id },
        status: { $in: ['processing', 'completed', 'refund_pending', 'refunded'] },
        created_at: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });
      const signals = [];
      if (accountPhone && accountPhone !== normalizedPhone) {
        signals.push({
          code: 'payer_phone_differs_from_account',
          weight: 25,
          details: {},
        });
      }
      if (sharedUsers.length >= 2) {
        signals.push({
          code: 'payer_phone_shared_by_accounts',
          weight: 70,
          details: { other_accounts: sharedUsers.length },
        });
      }
      if (signals.length) {
        await recordFraudAlert({
          category: 'suspicious_payment',
          dedupeKey: `payment-phone:${payment._id}`,
          score: Math.min(100, signals.reduce((sum, signal) => sum + signal.weight, 0)),
          title: 'Telephone de paiement inhabituel',
          description: 'Le numero Mobile Money differe du compte ou est partage par plusieurs comptes.',
          signals,
          subjectUserId: req.user.id,
          relatedUserIds: sharedUsers,
          paymentId: payment._id,
          pickupRequestId: payment.request_id,
        });
      }
    }

    res.status(202).json({
      success: true,
      message: 'Paiement initie. Confirmation en attente du fournisseur.',
      data: {
        payment_uuid: payment.uuid,
        status: payment.status,
        transaction_ref: payment.transaction_ref,
        amount: payment.amount,
        currency: 'XAF',
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await Payment.findOne({
        user_id: req.user.id,
        idempotency_key: req.get('Idempotency-Key') || req.body.idempotency_key,
      }).lean();
      if (existing) {
        return res.json({
          success: true,
          message: 'Tentative de paiement deja creee',
          data: {
            payment_uuid: existing.uuid,
            status: existing.status,
            transaction_ref: existing.transaction_ref,
          },
        });
      }
    }
    console.error('initiatePayment error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const processPaymentSuccess = async (payment, payload) => {
  if (payment.status === 'completed') return 'ignored';
  if (!['pending', 'processing', 'failed'].includes(payment.status)) {
    throw new Error(`Statut ${payment.status} incompatible avec une confirmation`);
  }
  if (Number(payload.amount) !== Number(payment.amount)) {
    throw new Error('Montant du webhook different du montant attendu');
  }
  if (!String(payload.provider_transaction_id || '').trim()) {
    throw new Error('Reference fournisseur manquante');
  }
  if (payment.provider !== 'sandbox' && payload.provider !== payment.provider) {
    throw new Error('Fournisseur du webhook incompatible');
  }

  const requestSnapshot = await require('../models/PickupRequest')
    .findById(payment.request_id)
    .select('service_type')
    .lean();
  const updated = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      status: { $in: ['pending', 'processing', 'failed'] },
    },
    {
      $set: {
        status: 'completed',
        provider: payload.provider || payment.provider,
        provider_transaction_id: String(payload.provider_transaction_id),
        transaction_ref: payment.transaction_ref || `PAY-${uuidv4()}`,
        receipt_number: buildReceiptNumber(payment),
        ...(requestSnapshot?.service_type === 'business'
          ? { invoice_number: buildInvoiceNumber(payment) }
          : {}),
        paid_at: payload.paid_at ? new Date(payload.paid_at) : new Date(),
      },
    },
    { new: true, runValidators: true }
  ).populate('request_id', 'collector_id');
  if (!updated) return 'ignored';

  if (updated.request_id?.collector_id) {
    await releaseEarning({
      collectorId: updated.request_id.collector_id,
      requestId: updated.request_id._id,
    });
  }
  await notifyUser({
    userId: updated.user_id,
    title: 'Paiement confirme',
    message: `Votre paiement de ${updated.amount.toLocaleString()} FCFA est confirme.`,
    type: 'payment',
    data: { payment_uuid: updated.uuid, target_path: '/dashboard/payments' },
  });
  return 'processed';
};

const processPaymentFailure = async (payment) => {
  if (['completed', 'refund_pending', 'refunded'].includes(payment.status)) return 'ignored';
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['pending', 'processing', 'failed'] } },
    { $set: { status: 'failed' } },
    { new: true }
  );
  if (updated) {
    const failedEvents = await PaymentWebhookEvent.countDocuments({
      payment_uuid: payment.uuid,
      type: 'payment.failed',
    });
    if (failedEvents >= 3) {
      await recordFraudAlert({
        category: 'suspicious_payment',
        dedupeKey: `repeated-failures:${payment._id}`,
        score: 65,
        title: 'Echecs de paiement repetes',
        description: 'Plusieurs echecs fournisseur ont ete recus pour le meme paiement.',
        signals: [{
          code: 'repeated_payment_failures',
          weight: 65,
          details: { failed_events: failedEvents },
        }],
        subjectUserId: payment.user_id,
        paymentId: payment._id,
        pickupRequestId: payment.request_id,
      });
    }
  }
  return updated ? 'processed' : 'ignored';
};

const processRefundSuccess = async (payment, payload) => {
  const refund = payment.refunds.find((item) => item.uuid === payload.refund_uuid);
  if (!refund) throw new Error('Remboursement introuvable');
  if (refund.status === 'completed' || payment.status === 'refunded') return 'ignored';
  if (payment.status !== 'refund_pending') {
    throw new Error(`Statut ${payment.status} incompatible avec un remboursement`);
  }
  if (Number(payload.amount) !== Number(refund.amount)
    || Number(refund.amount) !== Number(payment.amount)) {
    throw new Error('Montant de remboursement invalide');
  }
  if (payment.provider !== 'sandbox' && payload.provider !== payment.provider) {
    throw new Error('Fournisseur du remboursement incompatible');
  }

  const completedAt = new Date();
  const updated = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      status: 'refund_pending',
      refunds: { $elemMatch: { uuid: refund.uuid, status: 'pending' } },
    },
    {
      $set: {
        status: 'refunded',
        refunded_amount: refund.amount,
        refunded_at: completedAt,
        'refunds.$.status': 'completed',
        'refunds.$.provider_ref': String(payload.provider_ref || ''),
        'refunds.$.completed_at': completedAt,
      },
    },
    { new: true, runValidators: true }
  ).populate('request_id', 'collector_id');
  if (!updated) return 'ignored';

  if (updated.request_id?.collector_id) {
    await reverseReleasedEarning({
      collectorId: updated.request_id.collector_id,
      requestId: updated.request_id._id,
      paymentUuid: updated.uuid,
    });
  }
  await notifyUser({
    userId: updated.user_id,
    title: 'Remboursement confirme',
    message: `${refund.amount.toLocaleString()} FCFA ont ete rembourses.`,
    type: 'payment',
    data: { payment_uuid: updated.uuid, target_path: '/dashboard/payments' },
  });
  return 'processed';
};

const paymentWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    const timestamp = req.get('X-Eco-Timestamp');
    const signature = req.get('X-Eco-Signature');
    const rawBody = req.rawBody?.toString('utf8') || '';
    if (!verifyWebhookSignature({ secret, timestamp, signature, rawBody })) {
      const paymentUuid = req.body?.payment_uuid;
      const payment = paymentUuid
        ? await Payment.findOne({ uuid: paymentUuid }).select('_id user_id request_id').lean()
        : null;
      await recordFraudAlert({
        category: 'suspicious_payment',
        dedupeKey: `invalid-webhook:${paymentUuid || req.ip}`,
        score: 90,
        title: 'Webhook de paiement non authentifie',
        description: 'Une tentative de confirmation avec une signature invalide a ete rejetee.',
        signals: [{ code: 'invalid_webhook_signature', weight: 90, details: {} }],
        subjectUserId: payment?.user_id,
        paymentId: payment?._id,
        pickupRequestId: payment?.request_id,
      });
      return res.status(401).json({ success: false, message: 'Signature webhook invalide' });
    }

    const payload = req.body;
    if (!payload?.event_id || !payload?.type || !payload?.payment_uuid || !payload?.provider) {
      return res.status(400).json({ success: false, message: 'Evenement webhook incomplet' });
    }

    let webhookEvent;
    try {
      webhookEvent = await PaymentWebhookEvent.create({
        event_id: String(payload.event_id),
        type: String(payload.type),
        payment_uuid: String(payload.payment_uuid),
        provider: String(payload.provider),
        payload_hash: crypto.createHash('sha256').update(rawBody).digest('hex'),
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.json({ success: true, message: 'Evenement deja traite' });
      }
      throw error;
    }

    try {
      const payment = await Payment.findOne({ uuid: payload.payment_uuid });
      if (!payment) throw new Error('Paiement introuvable');

      let result;
      if (payload.type === 'payment.succeeded') {
        result = await processPaymentSuccess(payment, payload);
      } else if (payload.type === 'payment.failed') {
        result = await processPaymentFailure(payment);
      } else if (payload.type === 'refund.succeeded') {
        result = await processRefundSuccess(payment, payload);
      } else {
        result = 'ignored';
      }
      webhookEvent.status = result;
      webhookEvent.processed_at = new Date();
      await webhookEvent.save();
      return res.json({ success: true, message: `Evenement ${result}` });
    } catch (error) {
      webhookEvent.status = 'failed';
      webhookEvent.error = String(error.message || error).slice(0, 500);
      webhookEvent.processed_at = new Date();
      await webhookEvent.save();
      console.error('paymentWebhook event error:', error);
      return res.status(422).json({ success: false, message: 'Evenement refuse' });
    }
  } catch (error) {
    console.error('paymentWebhook error:', error);
    return res.status(500).json({ success: false, message: 'Erreur webhook' });
  }
};

const requestRefund = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    const idempotencyKey = String(
      req.get('Idempotency-Key') || req.body.idempotency_key || ''
    ).trim();
    if (reason.length < 5 || !idempotencyKey) {
      return res.status(400).json({
        success: false,
        message: 'Motif et cle idempotente requis',
      });
    }
    const payment = await Payment.findOne({ uuid: req.params.uuid });
    if (!payment) return res.status(404).json({ success: false, message: 'Paiement introuvable' });

    const existing = payment.refunds.find((refund) => refund.idempotency_key === idempotencyKey);
    if (existing) {
      return res.json({ success: true, message: 'Remboursement deja initie', data: existing });
    }
    if (payment.status !== 'completed' || payment.refunded_amount > 0) {
      return res.status(409).json({ success: false, message: 'Paiement non remboursable' });
    }

    const refund = {
      uuid: uuidv4(),
      idempotency_key: idempotencyKey,
      amount: payment.amount,
      reason: reason.slice(0, 500),
      status: 'pending',
      requested_by: req.user.id,
      requested_at: new Date(),
    };
    payment.refunds.push(refund);
    payment.status = 'refund_pending';
    await payment.save();
    const recentRefunds = await Payment.countDocuments({
      user_id: payment.user_id,
      status: { $in: ['refund_pending', 'refunded'] },
      updated_at: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });
    if (recentRefunds >= 3) {
      await recordFraudAlert({
        category: 'suspicious_refund',
        dedupeKey: `refund-pattern:${payment.user_id}`,
        score: recentRefunds >= 5 ? 90 : 70,
        title: 'Remboursements frequents',
        description: 'Ce compte cumule plusieurs remboursements sur une courte periode.',
        signals: [{
          code: 'high_refund_frequency',
          weight: recentRefunds >= 5 ? 90 : 70,
          details: { refunds_in_30_days: recentRefunds },
        }],
        subjectUserId: payment.user_id,
        paymentId: payment._id,
        pickupRequestId: payment.request_id,
      });
    }
    await AuditLog.create({
      actor_id: req.user.id,
      action: 'payment.refund_requested',
      target_type: 'Payment',
      target_id: payment._id,
      metadata: { payment_uuid: payment.uuid, refund_uuid: refund.uuid, amount: refund.amount },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    return res.status(202).json({
      success: true,
      message: 'Remboursement initie. Confirmation fournisseur en attente.',
      data: refund,
    });
  } catch (error) {
    console.error('requestRefund error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const getReceipt = async (req, res) => {
  try {
    const filter = { uuid: req.params.uuid };
    if (req.user.role !== 'admin') filter.user_id = req.user.id;
    const payment = await Payment.findOne(filter)
      .populate('user_id', 'name email phone')
      .populate({
        path: 'request_id',
        select: 'uuid address category_id service_type business_details pricing',
        populate: { path: 'category_id', select: 'name' },
      })
      .lean();
    if (!payment || !['completed', 'refund_pending', 'refunded'].includes(payment.status)) {
      return res.status(404).json({ success: false, message: 'Recu indisponible' });
    }
    const isBusiness = payment.request_id?.service_type === 'business';
    const documentNumber = isBusiness
      ? buildInvoiceNumber(payment)
      : buildReceiptNumber(payment);

    res.set('Cache-Control', 'private, no-store');
    res.type('html');
    res.set(
      'Content-Disposition',
      `attachment; filename="${isBusiness ? 'facture' : 'recu'}-${payment.uuid}.html"`
    );
    res.send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${isBusiness ? 'Facture' : 'Reçu'} EcoGarbage</title>
<style>body{font-family:Arial,sans-serif;color:#17351f;max-width:720px;margin:40px auto;padding:24px}
.head{display:flex;justify-content:space-between;border-bottom:3px solid #1A8A3C;padding-bottom:18px}
.brand{font-size:26px;font-weight:700}.brand span{color:#1A8A3C}.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e5e7eb}
.total{font-size:22px;font-weight:700;color:#1A8A3C}.muted{color:#6b7280;font-size:13px}</style></head>
<body><div class="head"><div class="brand">Eco<span>Garbage</span></div><div><strong>${isBusiness ? 'FACTURE' : 'RECU'}</strong><br>${escapeHtml(documentNumber)}</div></div>
<p class="muted">Document généré le ${new Date().toLocaleString('fr-FR')}</p>
<div class="row"><span>Client</span><strong>${escapeHtml(payment.user_id?.name)}</strong></div>
<div class="row"><span>Email</span><span>${escapeHtml(payment.user_id?.email)}</span></div>
${isBusiness ? `
<div class="row"><span>Entreprise</span><strong>${escapeHtml(payment.request_id?.business_details?.company_name)}</strong></div>
<div class="row"><span>RCCM / immatriculation</span><span>${escapeHtml(payment.request_id?.business_details?.registration_number)}</span></div>
<div class="row"><span>NIU</span><span>${escapeHtml(payment.request_id?.business_details?.tax_id || '-')}</span></div>
<div class="row"><span>Email de facturation</span><span>${escapeHtml(payment.request_id?.business_details?.billing_email)}</span></div>
<div class="row"><span>Adresse de facturation</span><span>${escapeHtml(payment.request_id?.business_details?.billing_address)}</span></div>` : ''}
<div class="row"><span>Collecte</span><span>${escapeHtml(payment.request_id?.uuid)}</span></div>
<div class="row"><span>Service</span><span>${escapeHtml(payment.request_id?.category_id?.name)}</span></div>
<div class="row"><span>Sous-total collecte</span><span>${Number(payment.request_id?.pricing?.base_subtotal || payment.amount).toLocaleString('fr-FR')} FCFA</span></div>
<div class="row"><span>Transport</span><span>${Number(payment.request_id?.pricing?.distance_fee || 0).toLocaleString('fr-FR')} FCFA</span></div>
<div class="row"><span>Frais de service</span><span>${Number(payment.request_id?.pricing?.service_fee || 0).toLocaleString('fr-FR')} FCFA</span></div>
<div class="row"><span>Zone tarifaire</span><span>${escapeHtml(payment.request_id?.pricing?.zone_label || 'Tarif standard')}</span></div>
<div class="row"><span>Frais de zone</span><span>${Number(payment.request_id?.pricing?.zone_fee || 0).toLocaleString('fr-FR')} FCFA</span></div>
<div class="row"><span>Transaction</span><span>${escapeHtml(payment.provider_transaction_id || payment.transaction_ref)}</span></div>
<div class="row"><span>Méthode</span><span>${escapeHtml(payment.provider)} / ${escapeHtml(payment.method)}</span></div>
<div class="row"><span>Date de paiement</span><span>${escapeHtml(payment.paid_at ? new Date(payment.paid_at).toLocaleString('fr-FR') : '')}</span></div>
<div class="row total"><span>Total</span><span>${Number(payment.amount).toLocaleString('fr-FR')} FCFA</span></div>
${payment.status === 'refunded' ? `<p><strong>Remboursé le ${escapeHtml(new Date(payment.refunded_at).toLocaleString('fr-FR'))}</strong></p>` : ''}
<p class="muted">EcoGarbage, plateforme de collecte responsable des déchets au Cameroun.</p></body></html>`);
  } catch (error) {
    console.error('getReceipt error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = {
  getPayments,
  initiatePayment,
  paymentWebhook,
  requestRefund,
  getReceipt,
  _internals: {
    createWebhookSignature,
    verifyWebhookSignature,
    buildReceiptNumber,
    buildInvoiceNumber,
  },
};
