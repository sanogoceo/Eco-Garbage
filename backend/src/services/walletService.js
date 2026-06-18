const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');

const getCommissionRate = () => {
  const value = Number(process.env.PLATFORM_COMMISSION_RATE || 15);
  return Math.min(50, Math.max(0, value)) / 100;
};

const getOrCreateWallet = (collectorId, session = null) => Wallet.findOneAndUpdate(
  { collector_id: collectorId },
  { $setOnInsert: { collector_id: collectorId } },
  { upsert: true, new: true, setDefaultsOnInsert: true, session }
);

const createPendingEarning = async ({ collectorId, requestId, grossAmount }) => {
  if (!collectorId || !grossAmount) return null;
  const commissionRate = getCommissionRate();
  const commission = Math.round(grossAmount * commissionRate);
  const netAmount = Math.max(0, grossAmount - commission);
  const session = await mongoose.startSession();
  let transaction = null;

  try {
    await session.withTransaction(async () => {
      const wallet = await getOrCreateWallet(collectorId, session);
      const createdTransactions = await WalletTransaction.create([
        {
          uuid: uuidv4(),
          wallet_id: wallet._id,
          collector_id: collectorId,
          request_id: requestId,
          type: 'earning_pending',
          amount: netAmount,
          balance_after: wallet.available_balance,
          description: 'Gain en attente de paiement client',
          metadata: { gross_amount: grossAmount, commission, commission_rate: commissionRate },
        },
      ], { session });
      transaction = createdTransactions[0];

      const updatedWallet = await Wallet.findByIdAndUpdate(
        wallet._id,
        { $inc: { pending_balance: netAmount } },
        { new: true, session }
      );
      if (!updatedWallet) {
        throw new Error('Impossible de mettre a jour le portefeuille');
      }

      await WalletTransaction.updateOne(
        { _id: transaction._id },
        { $set: { balance_after: updatedWallet.available_balance } },
        { session }
      );
      transaction.balance_after = updatedWallet.available_balance;
    });
    return transaction;
  } catch (error) {
    if (error?.code === 11000) {
      transaction = await WalletTransaction.findOne({ request_id: requestId, type: 'earning_pending' });
      if (transaction) return transaction;
    }
    throw error;
  } finally {
    session.endSession();
  }
};

const releaseEarning = async ({ collectorId, requestId }) => {
  const session = await mongoose.startSession();
  let transaction = null;

  try {
    await session.withTransaction(async () => {
      const pending = await WalletTransaction.findOne({
        collector_id: collectorId,
        request_id: requestId,
        type: 'earning_pending',
      }).session(session);
      if (!pending) {
        return;
      }

      const wallet = await getOrCreateWallet(collectorId, session);
      const createdTransactions = await WalletTransaction.create([
        {
          uuid: uuidv4(),
          wallet_id: wallet._id,
          collector_id: collectorId,
          request_id: requestId,
          type: 'earning_released',
          amount: pending.amount,
          balance_after: wallet.available_balance,
          description: 'Gain disponible apres paiement client',
          metadata: pending.metadata,
        },
      ], { session });
      transaction = createdTransactions[0];

      const debtOffset = Math.min(wallet.debt_balance || 0, pending.amount);
      const releasedAmount = pending.amount - debtOffset;
      const updatedWallet = await Wallet.findOneAndUpdate(
        { _id: wallet._id, pending_balance: { $gte: pending.amount } },
        {
          $inc: {
            pending_balance: -pending.amount,
            available_balance: releasedAmount,
            total_earned: pending.amount,
            debt_balance: -debtOffset,
          },
        },
        { new: true, session }
      );
      if (!updatedWallet) {
        throw new Error('Impossible de mettre a jour le portefeuille');
      }

      await WalletTransaction.updateOne(
        { _id: transaction._id },
        { $set: { balance_after: updatedWallet.available_balance } },
        { session }
      );
      transaction.balance_after = updatedWallet.available_balance;
    });

    return transaction;
  } catch (error) {
    if (error?.code === 11000) {
      return WalletTransaction.findOne({ request_id: requestId, type: 'earning_released' });
    }
    throw error;
  } finally {
    session.endSession();
  }
};

const reverseReleasedEarning = async ({ collectorId, requestId, paymentUuid }) => {
  const released = await WalletTransaction.findOne({
    collector_id: collectorId,
    request_id: requestId,
    type: 'earning_released',
  });
  if (!released) return null;

  const existing = await WalletTransaction.findOne({
    collector_id: collectorId,
    request_id: requestId,
    type: 'refund',
  });
  if (existing) return existing;

  const wallet = await getOrCreateWallet(collectorId);
  const deducted = Math.min(wallet.available_balance, released.amount);
  const debt = released.amount - deducted;
  const updatedWallet = await Wallet.findByIdAndUpdate(
    wallet._id,
    {
      $inc: {
        available_balance: -deducted,
        total_earned: -released.amount,
        debt_balance: debt,
      },
    },
    { new: true }
  );
  return WalletTransaction.create({
    uuid: uuidv4(),
    wallet_id: wallet._id,
    collector_id: collectorId,
    request_id: requestId,
    type: 'refund',
    amount: -released.amount,
    balance_after: updatedWallet.available_balance,
    description: 'Annulation du gain apres remboursement client',
    metadata: { payment_uuid: paymentUuid, deducted, debt },
  });
};

module.exports = {
  createPendingEarning,
  getCommissionRate,
  getOrCreateWallet,
  releaseEarning,
  reverseReleasedEarning,
};
