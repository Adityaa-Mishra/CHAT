const express = require('express');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { auth } = require('../middleware/auth');

const router = express.Router();

async function ensureParticipant(conversationId, userId){
  const conv = await Conversation.findById(conversationId);
  if(!conv) return null;
  const ok = conv.participants.some(p => p.toString() === userId);
  return ok ? conv : null;
}

router.get('/:conversationId', auth, async (req, res) => {
  const { conversationId } = req.params;
  const conv = await ensureParticipant(conversationId, req.user.id);
  if(!conv) return res.status(403).json({ message: 'Forbidden' });

  const messages = await Message.find({ conversationId })
    .sort({ createdAt: 1 })
    .limit(200);

  res.json({ messages });
});

router.post('/', auth, async (req, res) => {
  const { conversationId, text, type, file } = req.body;
  if(!conversationId) return res.status(400).json({ message: 'Missing conversationId' });
  const msgType = type || 'text';
  if(msgType === 'text' && !text) return res.status(400).json({ message: 'Missing text' });
  if(msgType === 'file' && !file?.url) return res.status(400).json({ message: 'Missing file' });

  const conv = await ensureParticipant(conversationId, req.user.id);
  if(!conv) return res.status(403).json({ message: 'Forbidden' });

  const message = await Message.create({
    conversationId,
    sender: req.user.id,
    text: text || '',
    type: msgType,
    file: file || null,
    status: 'sent'
  });

  conv.lastMessage = message._id;
  await conv.save();

  res.json({ message });
});

router.patch('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  if(!text) return res.status(400).json({ message: 'Missing text' });

  const msg = await Message.findById(id);
  if(!msg) return res.status(404).json({ message: 'Message not found' });
  if(msg.sender.toString() !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
  if(msg.deleted) return res.status(400).json({ message: 'Message deleted' });
  if(msg.type !== 'text') return res.status(400).json({ message: 'Only text messages can be edited' });

  msg.text = text;
  msg.editedAt = new Date();
  await msg.save();

  res.json({ message: msg });
});

router.delete('/:id', auth, async (req, res) => {
  const { id } = req.params;
  const msg = await Message.findById(id);
  if(!msg) return res.status(404).json({ message: 'Message not found' });
  if(msg.sender.toString() !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  msg.deleted = true;
  msg.text = '';
  msg.file = null;
  msg.type = 'text';
  await msg.save();

  res.json({ ok: true });
});

module.exports = router;
