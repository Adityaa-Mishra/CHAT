const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, default: '' },
  type: { type: String, enum: ['text','file'], default: 'text' },
  file: {
    name: String,
    url: String,
    size: Number,
    mime: String
  },
  editedAt: { type: Date, default: null },
  deleted: { type: Boolean, default: false },
  status: { type: String, enum: ['sent','delivered','read'], default: 'sent' }
}, { timestamps: true });

module.exports = mongoose.model('Message', MessageSchema);
