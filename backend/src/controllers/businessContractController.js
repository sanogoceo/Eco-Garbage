const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const BusinessContract = require('../models/BusinessContract');
const BusinessInvoice = require('../models/BusinessInvoice');
const PickupRequest = require('../models/PickupRequest');
const Payment = require('../models/Payment');
const AuditLog = require('../models/AuditLog');
const { normalizeAddress, validateStructuredAddress } = require('../utils/address');
const { notifyUser } = require('../services/notificationService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeSite = (site = {}) => {
  const address = normalizeAddress(site);
  return {
    name: String(site.name || '').trim().slice(0, 120),
    city: address.city,
    district: address.district,
    address_line: address.address_line,
    landmark: address.landmark,
    latitude: Number(site.latitude),
    longitude: Number(site.longitude),
    contact_name: String(site.contact_name || '').trim().slice(0, 120),
    contact_phone: String(site.contact_phone || '').trim().slice(0, 30),
    is_active: site.is_active !== false,
    status: ['pending', 'active', 'suspended', 'rejected'].includes(site.status)
      ? site.status
      : 'pending',
  };
};

const normalizeTerms = (body = {}) => ({
  payment_terms_days: Math.min(90, Math.max(0, Number(body.payment_terms_days) || 30)),
  credit_limit: Math.min(100_000_000, Math.max(0, Number(body.credit_limit) || 0)),
  negotiated_pricing: {
    price_multiplier: Math.min(
      10,
      Math.max(0.1, Number(body.negotiated_pricing?.price_multiplier ?? body.price_multiplier) || 1)
    ),
    fixed_fee: Math.min(
      1_000_000,
      Math.max(0, Number(body.negotiated_pricing?.fixed_fee ?? body.fixed_fee) || 0)
    ),
  },
});

const validateContract = (body) => {
  const contract = {
    company_name: String(body.company_name || '').trim().slice(0, 160),
    registration_number: String(body.registration_number || '').trim().slice(0, 80),
    tax_id: String(body.tax_id || '').trim().slice(0, 80),
    billing_email: String(body.billing_email || '').trim().toLowerCase(),
    billing_address: String(body.billing_address || '').trim().slice(0, 300),
    contact_name: String(body.contact_name || '').trim().slice(0, 120),
    monthly_quota: Math.min(10_000, Math.max(1, Number(body.monthly_quota) || 20)),
    billing_cycle: body.billing_cycle === 'per_collection'
      ? 'per_collection'
      : 'monthly',
    ...normalizeTerms(body),
    sites: Array.isArray(body.sites) ? body.sites.slice(0, 50).map(normalizeSite) : [],
  };
  const errors = {};
  if (contract.company_name.length < 2) {
    errors.company_name = 'La raison sociale doit contenir au moins 2 caracteres';
  }
  if (contract.registration_number.length < 3) {
    errors.registration_number = 'Le numero RCCM ou d immatriculation est requis';
  }
  if (!EMAIL_REGEX.test(contract.billing_email)) {
    errors.billing_email = 'Saisissez un email de facturation valide';
  }
  if (contract.billing_address.length < 5) {
    errors.billing_address = 'L adresse de facturation doit contenir au moins 5 caracteres';
  }
  if (contract.contact_name.length < 2) {
    errors.contact_name = 'Le nom du responsable doit contenir au moins 2 caracteres';
  }
  if (Object.keys(errors).length) {
    return {
      message: Object.values(errors)[0],
      errors,
    };
  }
  if (!contract.sites.length) {
    return {
      message: 'Ajoutez au moins un site de collecte',
      errors: { sites: 'Ajoutez au moins un site de collecte' },
    };
  }
  for (let index = 0; index < contract.sites.length; index += 1) {
    const site = contract.sites[index];
    const prefix = `sites.${index}`;
    if (site.name.length < 2) {
      errors[`${prefix}.name`] = `Le nom du site ${index + 1} est requis`;
    }
    const addressError = validateStructuredAddress(site, { allowLegacy: false });
    if (addressError) {
      errors[`${prefix}.address`] = `Completez la ville, le quartier et l adresse du site ${index + 1}`;
    }
    if (
      !Number.isFinite(site.latitude)
      || !Number.isFinite(site.longitude)
      || (site.latitude === 0 && site.longitude === 0)
      || site.latitude < -90 || site.latitude > 90
      || site.longitude < -180 || site.longitude > 180
    ) {
      errors[`${prefix}.location`] = `Enregistrez la position GPS du site ${index + 1}`;
    }
  }
  if (Object.keys(errors).length) {
    return {
      message: Object.values(errors)[0],
      errors,
    };
  }
  return { contract };
};

const usageByContract = async (contracts) => {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await PickupRequest.aggregate([
    {
      $match: {
        business_contract_id: { $in: contracts.map((contract) => contract._id) },
        created_at: { $gte: start },
        status: { $ne: 'cancelled' },
      },
    },
    { $group: { _id: '$business_contract_id', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), row.count]));
};

const getMonthRange = (monthValue) => {
  const month = /^\d{4}-\d{2}$/.test(String(monthValue || ''))
    ? String(monthValue)
    : new Date().toISOString().slice(0, 7);
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { month, start, end };
};

const getDeferredExposure = async (contractId) => {
  const rows = await PickupRequest.aggregate([
    {
      $match: {
        business_contract_id: contractId,
        status: { $nin: ['cancelled', 'failed'] },
      },
    },
    {
      $lookup: {
        from: 'payments',
        localField: '_id',
        foreignField: 'request_id',
        as: 'payment',
      },
    },
    {
      $unwind: {
        path: '$payment',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { payment: null },
          { 'payment.status': { $nin: ['completed', 'refunded'] } },
        ],
      },
    },
    {
      $group: {
        _id: null,
        amount: { $sum: { $ifNull: ['$final_price', '$estimated_price'] } },
        count: { $sum: 1 },
      },
    },
  ]);
  return {
    amount: rows[0]?.amount || 0,
    count: rows[0]?.count || 0,
  };
};

const applyContractPricing = ({ pricing, contract }) => {
  const multiplier = Number(contract?.negotiated_pricing?.price_multiplier || 1);
  const fixedFee = Number(contract?.negotiated_pricing?.fixed_fee || 0);
  if (multiplier === 1 && fixedFee === 0) return pricing;
  const base = pricing.breakdown || {};
  const total = Math.max(0, Math.round(Number(pricing.total || 0) * multiplier + fixedFee));
  return {
    ...pricing,
    total,
    breakdown: {
      ...base,
      contract_multiplier: multiplier,
      contract_fee: fixedFee,
      total,
    },
  };
};

const listContracts = async (req, res) => {
  try {
    const contracts = await BusinessContract.find({ user_id: req.user.id })
      .sort({ created_at: -1 })
      .lean();
    const usage = await usageByContract(contracts);
    res.json({
      success: true,
      data: contracts.map((contract) => ({
        ...contract,
        id: contract._id.toString(),
        used_this_month: usage.get(contract._id.toString()) || 0,
        remaining_quota: Math.max(
          0,
          contract.monthly_quota - (usage.get(contract._id.toString()) || 0)
        ),
      })),
    });
  } catch (error) {
    console.error('listContracts error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const listAdminContracts = async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim().slice(0, 100);
    const filter = {};
    if (status) {
      if (!['pending', 'active', 'suspended', 'rejected', 'expired'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Statut de contrat invalide' });
      }
      filter.status = status;
    }
    if (search) {
      filter.$or = [
        { company_name: { $regex: search, $options: 'i' } },
        { registration_number: { $regex: search, $options: 'i' } },
        { billing_email: { $regex: search, $options: 'i' } },
      ];
    }
    const contracts = await BusinessContract.find(filter)
      .populate('user_id', 'name email phone')
      .populate('reviewed_by', 'name email')
      .sort({ created_at: -1 })
      .limit(200)
      .lean();
    const usage = await usageByContract(contracts);
    res.json({
      success: true,
      data: contracts.map((contract) => ({
        ...contract,
        id: contract._id.toString(),
        user: contract.user_id ? {
          id: contract.user_id._id?.toString(),
          name: contract.user_id.name,
          email: contract.user_id.email,
          phone: contract.user_id.phone,
        } : null,
        reviewer: contract.reviewed_by ? {
          id: contract.reviewed_by._id?.toString(),
          name: contract.reviewed_by.name,
          email: contract.reviewed_by.email,
        } : null,
        user_id: contract.user_id?._id?.toString(),
        used_this_month: usage.get(contract._id.toString()) || 0,
        remaining_quota: Math.max(
          0,
          contract.monthly_quota - (usage.get(contract._id.toString()) || 0)
        ),
      })),
    });
  } catch (error) {
    console.error('listAdminContracts error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const createContract = async (req, res) => {
  try {
    const validation = validateContract(req.body);
    if (validation.message) {
      return res.status(400).json({
        success: false,
        message: validation.message,
        errors: validation.errors,
      });
    }
    const contract = await BusinessContract.create({
      uuid: uuidv4(),
      user_id: req.user.id,
      ...validation.contract,
    });
    return res.status(201).json({
      success: true,
      message: 'Contrat entreprise cree',
      data: contract,
    });
  } catch (error) {
    console.error('createContract error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const updateContract = async (req, res) => {
  try {
    const contract = await BusinessContract.findOne({
      uuid: req.params.uuid,
      user_id: req.user.id,
    });
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contrat introuvable' });
    }
    if (req.body.status && ['active', 'suspended'].includes(req.body.status)) {
      if (!['active', 'suspended'].includes(contract.status)) {
        return res.status(403).json({
          success: false,
          message: 'Ce contrat doit d abord etre valide par l administration',
        });
      }
      contract.status = req.body.status;
    } else {
      const validation = validateContract(req.body);
      if (validation.message) {
        return res.status(400).json({
          success: false,
          message: validation.message,
          errors: validation.errors,
        });
      }
      Object.assign(contract, validation.contract);
    }
    await contract.save();
    res.json({ success: true, message: 'Contrat mis a jour', data: contract });
  } catch (error) {
    console.error('updateContract error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const reviewAdminContract = async (req, res) => {
  try {
    const decision = String(req.body.decision || '').trim();
    if (!['approved', 'rejected', 'suspended'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision de contrat invalide' });
    }
    const notes = String(req.body.notes || '').trim().slice(0, 500);
    if (decision === 'rejected' && notes.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Le motif du refus est obligatoire',
      });
    }
    const contract = await BusinessContract.findOne({ uuid: req.params.uuid });
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contrat introuvable' });
    }
    contract.status = decision === 'approved' ? 'active' : decision;
    contract.reviewed_by = req.user.id;
    contract.reviewed_at = new Date();
    contract.review_notes = notes;
    if (decision === 'approved' && !contract.starts_at) {
      contract.starts_at = new Date();
    }
    await contract.save();

    await Promise.allSettled([
      notifyUser({
        userId: contract.user_id,
        title: decision === 'approved'
          ? 'Contrat entreprise approuve'
          : decision === 'rejected'
            ? 'Contrat entreprise refuse'
            : 'Contrat entreprise suspendu',
        message: decision === 'approved'
          ? 'Votre contrat entreprise est actif. Vous pouvez maintenant l utiliser pour vos collectes.'
          : notes || 'Votre contrat entreprise a ete mis a jour par l administration.',
        type: 'business_contract',
        data: { target_path: '/dashboard/business-contracts', contract_uuid: contract.uuid },
      }),
      AuditLog.create({
        actor_id: req.user.id,
        action: `business_contract.${decision}`,
        target_type: 'BusinessContract',
        target_id: contract._id,
        metadata: {
          contract_uuid: contract.uuid,
          company_name: contract.company_name,
          decision,
          notes,
        },
        ip: req.ip,
        user_agent: req.get('user-agent'),
      }),
    ]);

    res.json({
      success: true,
      message: decision === 'approved'
        ? 'Contrat approuve'
        : decision === 'rejected'
          ? 'Contrat refuse'
          : 'Contrat suspendu',
      data: contract,
    });
  } catch (error) {
    console.error('reviewAdminContract error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const updateAdminContractTerms = async (req, res) => {
  try {
    const contract = await BusinessContract.findOne({ uuid: req.params.uuid });
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contrat introuvable' });
    }
    const terms = normalizeTerms(req.body);
    contract.payment_terms_days = terms.payment_terms_days;
    contract.credit_limit = terms.credit_limit;
    contract.negotiated_pricing = terms.negotiated_pricing;
    await contract.save();
    await AuditLog.create({
      actor_id: req.user.id,
      action: 'business_contract.terms_updated',
      target_type: 'BusinessContract',
      target_id: contract._id,
      metadata: {
        contract_uuid: contract.uuid,
        company_name: contract.company_name,
        payment_terms_days: contract.payment_terms_days,
        credit_limit: contract.credit_limit,
        negotiated_pricing: contract.negotiated_pricing,
      },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    res.json({ success: true, message: 'Conditions entreprise mises a jour', data: contract });
  } catch (error) {
    console.error('updateAdminContractTerms error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const reviewAdminContractSite = async (req, res) => {
  try {
    const decision = String(req.body.decision || '').trim();
    if (!['approved', 'rejected', 'suspended'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision de site invalide' });
    }
    const contract = await BusinessContract.findOne({ uuid: req.params.uuid });
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contrat introuvable' });
    }
    const site = contract.sites.id(req.params.siteId);
    if (!site) {
      return res.status(404).json({ success: false, message: 'Site introuvable' });
    }
    site.status = decision === 'approved' ? 'active' : decision;
    site.is_active = site.status === 'active';
    site.reviewed_by = req.user.id;
    site.reviewed_at = new Date();
    site.review_notes = String(req.body.notes || '').trim().slice(0, 500);
    await contract.save();
    await Promise.allSettled([
      notifyUser({
        userId: contract.user_id,
        title: site.status === 'active'
          ? 'Site entreprise approuve'
          : 'Site entreprise mis a jour',
        message: site.status === 'active'
          ? `Le site ${site.name} peut maintenant etre utilise pour vos collectes.`
          : site.review_notes || `Le site ${site.name} a ete mis a jour.`,
        type: 'business_contract',
        data: { target_path: '/dashboard/business-contracts', contract_uuid: contract.uuid },
      }),
      AuditLog.create({
        actor_id: req.user.id,
        action: `business_contract.site_${decision}`,
        target_type: 'BusinessContract',
        target_id: contract._id,
        metadata: {
          contract_uuid: contract.uuid,
          company_name: contract.company_name,
          site_id: site._id,
          site_name: site.name,
          decision,
        },
        ip: req.ip,
        user_agent: req.get('user-agent'),
      }),
    ]);
    res.json({ success: true, message: 'Site entreprise mis a jour', data: site });
  } catch (error) {
    console.error('reviewAdminContractSite error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const buildMonthlyInvoice = async ({ contract, month }) => {
  const range = getMonthRange(month);
  const requests = await PickupRequest.find({
    business_contract_id: contract._id,
    created_at: { $gte: range.start, $lt: range.end },
    status: { $ne: 'cancelled' },
  }).select('_id estimated_price final_price status').lean();
  const amount = requests.reduce(
    (sum, request) => sum + Number(request.final_price || request.estimated_price || 0),
    0
  );
  const dueAt = new Date(range.end);
  dueAt.setUTCDate(dueAt.getUTCDate() + Number(contract.payment_terms_days || 30));
  const existing = await BusinessInvoice.findOne({
    contract_id: contract._id,
    month: range.month,
  });
  const lockedStatus = ['paid', 'cancelled'].includes(existing?.status);
  const invoice = await BusinessInvoice.findOneAndUpdate(
    { contract_id: contract._id, month: range.month },
    {
      $set: {
        user_id: contract.user_id,
        amount,
        request_count: requests.length,
        request_ids: requests.map((request) => request._id),
        due_at: dueAt,
        ...(!lockedStatus ? { status: 'issued' } : {}),
      },
      $setOnInsert: {
        uuid: uuidv4(),
        invoice_number: `EG-${range.month.replace('-', '')}-${contract.uuid.slice(0, 8).toUpperCase()}`,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return invoice;
};

const generateAdminInvoice = async (req, res) => {
  try {
    const contract = await BusinessContract.findOne({ uuid: req.params.uuid });
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contrat introuvable' });
    }
    const invoice = await buildMonthlyInvoice({ contract, month: req.body.month || req.query.month });
    await AuditLog.create({
      actor_id: req.user.id,
      action: 'business_contract.invoice_generated',
      target_type: 'BusinessInvoice',
      target_id: invoice._id,
      metadata: {
        contract_uuid: contract.uuid,
        company_name: contract.company_name,
        invoice_number: invoice.invoice_number,
        month: invoice.month,
        amount: invoice.amount,
      },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    res.json({ success: true, message: 'Facture entreprise generee', data: invoice });
  } catch (error) {
    console.error('generateAdminInvoice error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getInvoiceWithContract = async ({ invoiceUuid, contractUuid, userId, admin = false }) => {
  const contractFilter = { uuid: contractUuid };
  if (!admin) contractFilter.user_id = userId;
  const contract = await BusinessContract.findOne(contractFilter).lean();
  if (!contract) return {};
  const invoice = await BusinessInvoice.findOne({
    uuid: invoiceUuid,
    contract_id: contract._id,
  })
    .populate({
      path: 'request_ids',
      select: 'uuid created_at status final_price estimated_price address address_details category_id',
      populate: { path: 'category_id', select: 'name' },
    })
    .lean();
  return { contract, invoice };
};

const renderInvoiceHtml = ({ contract, invoice }) => {
  const rows = (invoice.request_ids || []).map((request) => {
    const amount = Number(request.final_price || request.estimated_price || 0);
    return `<tr>
      <td>${escapeHtml(new Date(request.created_at).toLocaleDateString('fr-FR'))}</td>
      <td>${escapeHtml(request.uuid)}</td>
      <td>${escapeHtml(request.category_id?.name || '-')}</td>
      <td>${escapeHtml(request.address_details?.district || request.address || '-')}</td>
      <td>${escapeHtml(request.status)}</td>
      <td>${amount.toLocaleString('fr-FR')} FCFA</td>
    </tr>`;
  }).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Facture ${escapeHtml(invoice.invoice_number)}</title>
<style>
body{font-family:Arial,sans-serif;color:#17351f;max-width:980px;margin:30px auto;padding:24px}
.head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #1A8A3C;padding-bottom:18px}
.brand{font-size:28px;font-weight:800;color:#17351f}.brand span{color:#1A8A3C}
.box{background:#f0faf3;border:1px solid #c8edda;border-radius:14px;padding:16px;margin:18px 0}
table{width:100%;border-collapse:collapse;margin-top:20px}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}
.total{font-size:24px;font-weight:bold;color:#1A8A3C}.muted{color:#667}
</style></head><body>
<div class="head"><div><div class="brand">Eco<span>Garbage</span></div><p class="muted">Facturation entreprise</p></div>
<div><strong>FACTURE</strong><br>${escapeHtml(invoice.invoice_number)}<br>Statut: ${escapeHtml(invoice.status)}</div></div>
<div class="box"><strong>${escapeHtml(contract.company_name)}</strong><br>
RCCM: ${escapeHtml(contract.registration_number)}<br>
NIU: ${escapeHtml(contract.tax_id || '-')}<br>
Email: ${escapeHtml(contract.billing_email)}<br>
Adresse: ${escapeHtml(contract.billing_address)}</div>
<p>Periode: <strong>${escapeHtml(invoice.month)}</strong><br>
Echeance: <strong>${escapeHtml(new Date(invoice.due_at).toLocaleDateString('fr-FR'))}</strong></p>
<table><thead><tr><th>Date</th><th>Collecte</th><th>Service</th><th>Site</th><th>Statut</th><th>Montant</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">Aucune collecte facturee</td></tr>'}</tbody></table>
<p class="total">Total: ${Number(invoice.amount || 0).toLocaleString('fr-FR')} FCFA</p>
${invoice.status === 'paid' ? `<p>Paiement recu le ${escapeHtml(new Date(invoice.paid_at).toLocaleDateString('fr-FR'))}<br>Reference: ${escapeHtml(invoice.payment_reference || '-')}</p>` : ''}
</body></html>`;
};

const downloadInvoice = async (req, res) => {
  try {
    const { contract, invoice } = await getInvoiceWithContract({
      contractUuid: req.params.uuid,
      invoiceUuid: req.params.invoiceUuid,
      userId: req.user.id,
      admin: req.user.role === 'admin' && req.originalUrl.includes('/admin/'),
    });
    if (!contract || !invoice) {
      return res.status(404).json({ success: false, message: 'Facture introuvable' });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="facture-${invoice.invoice_number}.html"`
    );
    return res.send(renderInvoiceHtml({ contract, invoice }));
  } catch (error) {
    console.error('downloadInvoice error:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const listAdminInvoices = async (req, res) => {
  try {
    const contract = await BusinessContract.findOne({ uuid: req.params.uuid }).lean();
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contrat introuvable' });
    }
    const invoices = await BusinessInvoice.find({ contract_id: contract._id })
      .sort({ month: -1 })
      .limit(36)
      .lean();
    res.json({ success: true, data: invoices });
  } catch (error) {
    console.error('listAdminInvoices error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const updateAdminInvoiceStatus = async (req, res) => {
  try {
    const status = String(req.body.status || '').trim();
    if (!['issued', 'paid', 'overdue', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Statut de facture invalide' });
    }
    const contract = await BusinessContract.findOne({ uuid: req.params.uuid });
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contrat introuvable' });
    }
    const invoice = await BusinessInvoice.findOne({
      uuid: req.params.invoiceUuid,
      contract_id: contract._id,
    });
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Facture introuvable' });
    }
    invoice.status = status;
    if (status === 'paid') {
      invoice.paid_at = req.body.paid_at ? new Date(req.body.paid_at) : new Date();
      invoice.paid_by = req.user.id;
      invoice.payment_method = ['bank_transfer', 'mobile_money', 'cash', 'cheque', 'other']
        .includes(req.body.payment_method)
        ? req.body.payment_method
        : 'bank_transfer';
      invoice.payment_reference = String(req.body.payment_reference || '').trim().slice(0, 120);
      invoice.payment_notes = String(req.body.payment_notes || '').trim().slice(0, 500);
      await Payment.updateMany(
        {
          request_id: { $in: invoice.request_ids },
          status: { $in: ['pending', 'processing', 'failed'] },
        },
        {
          $set: {
            status: 'completed',
            method: invoice.payment_method === 'mobile_money' ? 'mobile_money' : 'bank_transfer',
            provider: 'sandbox',
            transaction_ref: invoice.payment_reference || invoice.invoice_number,
            paid_at: invoice.paid_at,
          },
        }
      );
    } else {
      invoice.paid_at = undefined;
      invoice.paid_by = undefined;
    }
    await invoice.save();
    await AuditLog.create({
      actor_id: req.user.id,
      action: `business_contract.invoice_${status}`,
      target_type: 'BusinessInvoice',
      target_id: invoice._id,
      metadata: {
        contract_uuid: contract.uuid,
        company_name: contract.company_name,
        invoice_number: invoice.invoice_number,
        month: invoice.month,
        amount: invoice.amount,
        status,
      },
      ip: req.ip,
      user_agent: req.get('user-agent'),
    });
    await notifyUser({
      userId: contract.user_id,
      title: status === 'paid' ? 'Facture entreprise payee' : 'Facture entreprise mise a jour',
      message: `Facture ${invoice.invoice_number}: ${status}.`,
      type: 'business_contract',
      data: { target_path: '/dashboard/business-contracts', invoice_uuid: invoice.uuid },
    }).catch(() => {});
    res.json({ success: true, message: 'Facture mise a jour', data: invoice });
  } catch (error) {
    console.error('updateAdminInvoiceStatus error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const listInvoices = async (req, res) => {
  try {
    const contract = await BusinessContract.findOne({
      uuid: req.params.uuid,
      user_id: req.user.id,
    }).lean();
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contrat introuvable' });
    }
    const invoices = await BusinessInvoice.find({ contract_id: contract._id })
      .sort({ month: -1 })
      .limit(36)
      .lean();
    res.json({ success: true, data: invoices });
  } catch (error) {
    console.error('listInvoices error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getBusinessDashboard = async (req, res) => {
  try {
    const contract = await BusinessContract.findOne({
      uuid: req.params.uuid,
      user_id: req.user.id,
    }).lean();
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contrat introuvable' });
    }
    const range = getMonthRange(req.query.month);
    const [requests, invoices, exposure] = await Promise.all([
      PickupRequest.find({
        business_contract_id: contract._id,
        created_at: { $gte: range.start, $lt: range.end },
      }).populate('category_id', 'name').lean(),
      BusinessInvoice.find({ contract_id: contract._id }).sort({ month: -1 }).limit(6).lean(),
      getDeferredExposure(contract._id),
    ]);
    const total = requests.reduce(
      (sum, request) => sum + Number(request.final_price || request.estimated_price || 0),
      0
    );
    const bySite = new Map();
    const byCategory = new Map();
    requests.forEach((request) => {
      const siteId = request.business_site_id?.toString() || 'manual';
      const site = contract.sites.find(item => item._id.toString() === siteId);
      const siteLabel = site?.name || 'Site manuel';
      bySite.set(siteLabel, (bySite.get(siteLabel) || 0) + 1);
      const categoryLabel = request.category_id?.name || 'Non classe';
      byCategory.set(categoryLabel, (byCategory.get(categoryLabel) || 0) + 1);
    });
    res.json({
      success: true,
      data: {
        contract,
        month: range.month,
        stats: {
          requests: requests.length,
          completed: requests.filter(request => request.status === 'completed').length,
          pending: requests.filter(request => !['completed', 'cancelled', 'failed'].includes(request.status)).length,
          total_amount: total,
          outstanding_amount: exposure.amount,
          credit_limit: contract.credit_limit || 0,
          credit_remaining: Math.max(0, Number(contract.credit_limit || 0) - exposure.amount),
        },
        sites: contract.sites,
        by_site: Array.from(bySite, ([label, count]) => ({ label, count })),
        by_category: Array.from(byCategory, ([label, count]) => ({ label, count })),
        invoices,
      },
    });
  } catch (error) {
    console.error('getBusinessDashboard error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const getMonthlyStatement = async (req, res) => {
  try {
    const contract = await BusinessContract.findOne({
      uuid: req.params.uuid,
      user_id: req.user.id,
    }).lean();
    if (!contract) {
      return res.status(404).json({ success: false, message: 'Contrat introuvable' });
    }
    const { month, start, end } = getMonthRange(req.query.month);
    const requests = await PickupRequest.find({
      business_contract_id: contract._id,
      created_at: { $gte: start, $lt: end },
      status: { $ne: 'cancelled' },
    }).populate('category_id', 'name').sort({ created_at: 1 }).lean();
    const payments = await Payment.find({
      request_id: { $in: requests.map((request) => request._id) },
      status: { $in: ['completed', 'refund_pending', 'refunded'] },
    }).lean();
    const paymentMap = new Map(
      payments.map((payment) => [payment.request_id.toString(), payment])
    );
    const total = requests.reduce((sum, request) => (
      sum + Number(paymentMap.get(request._id.toString())?.amount || request.final_price || 0)
    ), 0);
    const rows = requests.map((request) => {
      const payment = paymentMap.get(request._id.toString());
      return `<tr>
        <td>${escapeHtml(new Date(request.created_at).toLocaleDateString('fr-FR'))}</td>
        <td>${escapeHtml(request.category_id?.name || '-')}</td>
        <td>${escapeHtml(request.address_details?.district || request.address)}</td>
        <td>${escapeHtml(request.status)}</td>
        <td>${Number(payment?.amount || request.final_price || 0).toLocaleString('fr-FR')} FCFA</td>
      </tr>`;
    }).join('');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="releve-${contract.uuid}-${month}.html"`
    );
    return res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Releve mensuel EcoGarbage</title>
<style>body{font-family:Arial,sans-serif;color:#17351f;max-width:980px;margin:30px auto;padding:24px}
h1{color:#1A8A3C}table{width:100%;border-collapse:collapse;margin-top:24px}
th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}.total{font-size:22px;font-weight:bold}</style>
</head><body><h1>EcoGarbage - Releve mensuel</h1>
<p><strong>${escapeHtml(contract.company_name)}</strong><br>
RCCM: ${escapeHtml(contract.registration_number)}<br>
Periode: ${escapeHtml(month)}</p>
<table><thead><tr><th>Date</th><th>Service</th><th>Site</th><th>Statut</th><th>Montant</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">Aucune collecte</td></tr>'}</tbody></table>
<p class="total">Total: ${total.toLocaleString('fr-FR')} FCFA</p>
<p>${requests.length} collecte(s) sur un quota mensuel de ${contract.monthly_quota}.</p>
</body></html>`);
  } catch (error) {
    console.error('getMonthlyStatement error:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getOwnedContractSite = async ({ userId, contractId, siteId }) => {
  if (!mongoose.isValidObjectId(contractId) || !mongoose.isValidObjectId(siteId)) {
    return { message: 'Contrat ou site invalide' };
  }
  const contract = await BusinessContract.findOne({
    _id: contractId,
    user_id: userId,
    status: 'active',
    $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }],
  });
  if (!contract) return { message: 'Contrat entreprise inactif ou introuvable' };
  const site = contract.sites.id(siteId);
  if (!site || !site.is_active || site.status !== 'active') {
    return { message: 'Site entreprise non valide par l administration' };
  }

  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const used = await PickupRequest.countDocuments({
    business_contract_id: contract._id,
    created_at: { $gte: start },
    status: { $ne: 'cancelled' },
  });
  if (used >= contract.monthly_quota) {
    return { message: 'Quota mensuel du contrat atteint' };
  }
  return { contract, site, used };
};

module.exports = {
  createContract,
  applyContractPricing,
  downloadInvoice,
  generateAdminInvoice,
  getBusinessDashboard,
  getDeferredExposure,
  getMonthlyStatement,
  getOwnedContractSite,
  listAdminInvoices,
  listInvoices,
  listAdminContracts,
  listContracts,
  reviewAdminContractSite,
  reviewAdminContract,
  updateAdminContractTerms,
  updateAdminInvoiceStatus,
  updateContract,
  validateContract,
};
