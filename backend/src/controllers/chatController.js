const { randomUUID: uuidv4 } = require('crypto');
const ChatMessage = require('../models/ChatMessage');
const PickupRequest = require('../models/PickupRequest');
const { notifyUser } = require('../services/notificationService');
const { emitRequestEvent } = require('../services/realtimeService');

const getConversationContext = async (requestUuid, userId) => {
  const request = await PickupRequest.findOne({ uuid: requestUuid })
    .select('user_id collector_id status').lean();
  if (!request || !request.collector_id) return null;

  const ownerId = request.user_id.toString();
  const collectorId = request.collector_id.toString();
  if (![ownerId, collectorId].includes(userId)) return null;
  if (['cancelled', 'failed'].includes(request.status)) return null;

  return {
    request,
    recipientId: userId === ownerId ? collectorId : ownerId,
    ownerId,
    collectorId,
  };
};

const getMessages = async (req, res) => {
  try {
    const context = await getConversationContext(req.params.uuid, req.user.id);
    if (!context) {
      return res.status(403).json({ success: false, message: 'Conversation indisponible' });
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const messages = await ChatMessage.find({ request_id: context.request._id })
      .populate('sender_id', 'name role')
      .sort({ created_at: -1 }).limit(limit).lean();

    await ChatMessage.updateMany(
      {
        request_id: context.request._id,
        recipient_id: req.user.id,
        is_read: false,
      },
      { $set: { is_read: true, read_at: new Date() } }
    );

    res.json({
      success: true,
      data: messages.reverse().map((message) => ({
        ...message,
        sender_name: message.sender_id?.name,
        sender_role: message.sender_id?.role,
        sender_id: message.sender_id?._id?.toString(),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const sendMessage = async (req, res) => {
  try {
    const context = await getConversationContext(req.params.uuid, req.user.id);
    if (!context) {
      return res.status(403).json({ success: false, message: 'Conversation indisponible' });
    }
    const body = String(req.body.body || '').trim();
    if (!body || body.length > 1000) {
      return res.status(400).json({ success: false, message: 'Le message doit contenir entre 1 et 1000 caracteres' });
    }

    const message = await ChatMessage.create({
      uuid: uuidv4(),
      request_id: context.request._id,
      sender_id: req.user.id,
      recipient_id: context.recipientId,
      body,
    });
    emitRequestEvent(req.params.uuid, 'message_created', {
      uuid: message.uuid,
      sender_id: req.user.id,
      body: message.body,
      created_at: message.created_at,
    });

    await notifyUser({
      userId: context.recipientId,
      title: `Nouveau message de ${req.user.name}`,
      message: body.length > 100 ? `${body.slice(0, 97)}...` : body,
      type: 'chat',
      data: {
        request_uuid: req.params.uuid,
        target_path: context.recipientId === context.collectorId
          ? `/collector/tasks/${req.params.uuid}`
          : `/dashboard/requests/${req.params.uuid}`,
      },
    });
    res.status(201).json({ success: true, data: message });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = { getMessages, sendMessage };
