const mongoose = require('mongoose');

const complaintMessageSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  complaint_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Complaint',
    required: true,
  },
  sender_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  body: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1500,
  },
  message_type: {
    type: String,
    enum: ['message', 'status', 'decision'],
    default: 'message',
  },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

complaintMessageSchema.index({ complaint_id: 1, created_at: 1 });

module.exports = mongoose.model('ComplaintMessage', complaintMessageSchema);
