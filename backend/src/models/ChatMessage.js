const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  request_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PickupRequest', required: true },
  sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, trim: true, maxlength: 1000 },
  is_read: { type: Boolean, default: false },
  read_at: Date,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

chatMessageSchema.index({ request_id: 1, created_at: 1 });
chatMessageSchema.index({ request_id: 1, recipient_id: 1, is_read: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
