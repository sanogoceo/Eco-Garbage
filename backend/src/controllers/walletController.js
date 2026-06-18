const { v4: uuidv4 } = require('uuid');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const { getOrCreateWallet } = require('../services/walletService');
const { notifyUser } = require('../services/notificationService');

const getWallet = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const wallet = await getOrCreateWallet(req.user.id);
    const [transactions, withdrawals] = await Promise.all([
      WalletTransaction.find({ collector_id: req.user.id })
        .sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      WithdrawalRequest.find({ collector_id: req.user.id })
        .sort({ created_at: -1 }).limit(20).lean(),
    ]);
    res.json({ success: true, data: { wallet, transactions, withdrawals } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const requestWithdrawal = async (req, res) => {
  try {
    const amount = Math.round(Number(req.body.amount));
    const { method, phone } = req.body;
    if (!Number.isFinite(amount) || amount < 500) {
      return res.status(400).json({ success: false, message: 'Le retrait minimum est de 500 FCFA' });
    }
    if (!['mtn_momo', 'orange_money'].includes(method) || !/^\+?[0-9]{9,15}$/.test(phone || '')) {
      return res.status(400).json({ success: false, message: 'Methode ou numero de paiement invalide' });
    }
    if (await WithdrawalRequest.exists({
      collector_id: req.user.id,
      status: { $in: ['pending', 'approved'] },
    })) {
      return res.status(409).json({
        success: false,
        message: 'Un retrait est deja en cours de traitement',
      });
    }

    const wallet = await getOrCreateWallet(req.user.id);
    const withdrawal = await WithdrawalRequest.create({
      uuid: uuidv4(),
      collector_id: req.user.id,
      wallet_id: wallet._id,
      amount,
      method,
      phone,
    });
    const reservedWallet = await Wallet.findOneAndUpdate(
      { collector_id: req.user.id, available_balance: { $gte: amount } },
      { $inc: { available_balance: -amount, reserved_balance: amount } },
      { new: true }
    );
    if (!reservedWallet) {
      await WithdrawalRequest.deleteOne({ _id: withdrawal._id });
      return res.status(400).json({ success: false, message: 'Solde disponible insuffisant' });
    }
    res.status(201).json({ success: true, message: 'Demande de retrait envoyee', data: withdrawal });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const getWithdrawals = async (req, res) => {
  try {
    const status = req.query.status;
    const filter = status ? { status } : {};
    const rows = await WithdrawalRequest.find(filter)
      .populate('collector_id', 'name email phone')
      .sort({ created_at: -1 }).lean();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const reviewWithdrawal = async (req, res) => {
  try {
    const { decision, notes } = req.body;
    if (!['approved', 'paid', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision invalide' });
    }
    const requiredStatus = decision === 'paid' ? 'approved' : 'pending';
    const withdrawal = await WithdrawalRequest.findOneAndUpdate(
      { uuid: req.params.uuid, status: requiredStatus },
      {
        $set: {
          status: decision,
          review_notes: String(notes || '').slice(0, 500),
          reviewed_by: req.user.id,
          reviewed_at: new Date(),
          ...(decision === 'paid' ? { paid_at: new Date() } : {}),
        },
      },
      { new: true }
    );
    if (!withdrawal) {
      return res.status(409).json({
        success: false,
        message: decision === 'paid'
          ? 'Le retrait doit etre approuve et non encore paye'
          : 'Cette demande a deja ete traitee',
      });
    }

    if (decision === 'rejected') {
      const wallet = await Wallet.findOneAndUpdate(
        { _id: withdrawal.wallet_id, reserved_balance: { $gte: withdrawal.amount } },
        {
          $inc: {
            reserved_balance: -withdrawal.amount,
            available_balance: withdrawal.amount,
          },
        },
        { new: true }
      );
      if (!wallet) {
        await WithdrawalRequest.updateOne(
          { _id: withdrawal._id, status: 'rejected' },
          { $set: { status: 'pending' } }
        );
        return res.status(409).json({ success: false, message: 'Solde reserve incoherent' });
      }
    } else if (decision === 'paid') {
      const wallet = await Wallet.findOneAndUpdate(
        { _id: withdrawal.wallet_id, reserved_balance: { $gte: withdrawal.amount } },
        {
          $inc: {
            reserved_balance: -withdrawal.amount,
            total_withdrawn: withdrawal.amount,
          },
        },
        { new: true }
      );
      if (!wallet) {
        await WithdrawalRequest.updateOne(
          { _id: withdrawal._id, status: 'paid' },
          { $set: { status: 'approved', paid_at: null } }
        );
        return res.status(409).json({ success: false, message: 'Solde reserve incoherent' });
      }
      await WalletTransaction.create({
        uuid: uuidv4(),
        wallet_id: wallet._id,
        collector_id: withdrawal.collector_id,
        withdrawal_id: withdrawal._id,
        type: 'withdrawal',
        amount: -withdrawal.amount,
        balance_after: wallet.available_balance,
        description: `Retrait ${withdrawal.method}`,
      });
    }

    await notifyUser({
      userId: withdrawal.collector_id,
      title: 'Mise a jour du retrait',
      message: decision === 'rejected'
        ? `Votre retrait de ${withdrawal.amount} FCFA a ete refuse.`
        : decision === 'paid'
          ? `Votre retrait de ${withdrawal.amount} FCFA a ete paye.`
          : `Votre retrait de ${withdrawal.amount} FCFA a ete approuve.`,
      type: 'wallet',
      data: { target_path: '/collector/wallet' },
    });
    res.json({ success: true, message: 'Retrait mis a jour', data: withdrawal });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = { getWallet, requestWithdrawal, getWithdrawals, reviewWithdrawal };
