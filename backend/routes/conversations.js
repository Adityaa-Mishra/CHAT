const express = require('express');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  const userId = req.user.id;
  const convs = await Conversation.find({ participants: userId })
    .populate('participants')
    .populate('admins')
    .populate('createdBy')
    .populate('lastMessage')
    .sort({ updatedAt: -1 });

  const withUnread = await Promise.all(convs.map(async c => {
    const unreadCount = await Message.countDocuments({
      conversationId: c._id,
      sender: { $ne: userId },
      status: { $ne: 'read' }
    });
    const obj = c.toObject();
    obj.unreadCount = unreadCount;
    return obj;
  }));

  res.json({ conversations: withUnread });
});

router.post('/', auth, async (req, res) => {
  const userId = req.user.id;
  const { userId: otherId } = req.body;
  if(!otherId) return res.status(400).json({ message: 'Missing userId' });

  let conv = await Conversation.findOne({
    participants: { $all: [userId, otherId] },
    $expr: { $eq: [ { $size: '$participants' }, 2 ] },
    isGroup: { $ne: true }
  }).populate('participants').populate('lastMessage');

  if(!conv){
    conv = await Conversation.create({ participants: [userId, otherId], isGroup: false });
    conv = await Conversation.findById(conv._id).populate('participants').populate('lastMessage');
  }

  res.json({ conversation: conv.toObject() });
});

function uniqIds(list){
  const out = [];
  const seen = new Set();
  list.forEach(id => {
    if(!id) return;
    const key = id.toString();
    if(seen.has(key)) return;
    seen.add(key);
    out.push(id);
  });
  return out;
}

async function ensureGroupAdmin(conversationId, userId){
  const conv = await Conversation.findById(conversationId);
  if(!conv || !conv.isGroup) return null;
  const isParticipant = conv.participants.some(p => p.toString() === userId);
  if(!isParticipant) return null;
  const isAdmin = (conv.admins || []).some(a => a.toString() === userId);
  return isAdmin ? conv : null;
}

async function ensureGroupParticipant(conversationId, userId){
  const conv = await Conversation.findById(conversationId);
  if(!conv || !conv.isGroup) return null;
  const ok = conv.participants.some(p => p.toString() === userId);
  return ok ? conv : null;
}

router.post('/group', auth, async (req, res) => {
  const userId = req.user.id;
  const { name, userIds } = req.body;
  const cleanName = (name || '').toString().trim();
  if(!cleanName) return res.status(400).json({ message: 'Missing group name' });
  const members = Array.isArray(userIds) ? userIds : [];
  const participants = uniqIds([userId, ...members]);
  if(participants.length < 2) return res.status(400).json({ message: 'Add at least one member' });

  let conv = await Conversation.create({
    participants,
    isGroup: true,
    name: cleanName,
    admins: [userId],
    createdBy: userId
  });
  conv = await Conversation.findById(conv._id)
    .populate('participants')
    .populate('admins')
    .populate('createdBy')
    .populate('lastMessage');
  res.json({ conversation: conv.toObject() });
});

router.patch('/:id/name', auth, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const cleanName = (name || '').toString().trim();
  if(!cleanName) return res.status(400).json({ message: 'Missing group name' });
  const conv = await ensureGroupAdmin(id, req.user.id);
  if(!conv) return res.status(403).json({ message: 'Forbidden' });
  conv.name = cleanName;
  await conv.save();
  const populated = await Conversation.findById(conv._id)
    .populate('participants')
    .populate('admins')
    .populate('createdBy')
    .populate('lastMessage');
  res.json({ conversation: populated.toObject() });
});

router.post('/:id/participants', auth, async (req, res) => {
  const { id } = req.params;
  const { userIds } = req.body;
  const conv = await ensureGroupAdmin(id, req.user.id);
  if(!conv) return res.status(403).json({ message: 'Forbidden' });
  const incoming = Array.isArray(userIds) ? userIds : [];
  const next = uniqIds([...(conv.participants || []), ...incoming]);
  conv.participants = next;
  await conv.save();
  const populated = await Conversation.findById(conv._id)
    .populate('participants')
    .populate('admins')
    .populate('createdBy')
    .populate('lastMessage');
  res.json({ conversation: populated.toObject() });
});

router.delete('/:id/participants/:userId', auth, async (req, res) => {
  const { id, userId } = req.params;
  const conv = await ensureGroupAdmin(id, req.user.id);
  if(!conv) return res.status(403).json({ message: 'Forbidden' });
  const isMember = conv.participants.some(p => p.toString() === userId);
  if(!isMember) return res.status(404).json({ message: 'User not in group' });

  const remaining = conv.participants.filter(p => p.toString() !== userId);
  conv.participants = remaining;
  conv.admins = (conv.admins || []).filter(a => a.toString() !== userId);
  if((conv.admins || []).length === 0 && remaining.length){
    conv.admins = [remaining[0]];
  }
  await conv.save();
  const populated = await Conversation.findById(conv._id)
    .populate('participants')
    .populate('admins')
    .populate('createdBy')
    .populate('lastMessage');
  res.json({ conversation: populated.toObject() });
});

router.post('/:id/admins', auth, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;
  if(!userId) return res.status(400).json({ message: 'Missing userId' });
  const conv = await ensureGroupAdmin(id, req.user.id);
  if(!conv) return res.status(403).json({ message: 'Forbidden' });
  const isMember = conv.participants.some(p => p.toString() === userId);
  if(!isMember) return res.status(400).json({ message: 'User not in group' });
  conv.admins = uniqIds([...(conv.admins || []), userId]);
  await conv.save();
  const populated = await Conversation.findById(conv._id)
    .populate('participants')
    .populate('admins')
    .populate('createdBy')
    .populate('lastMessage');
  res.json({ conversation: populated.toObject() });
});

router.delete('/:id/admins/:userId', auth, async (req, res) => {
  const { id, userId } = req.params;
  const conv = await ensureGroupAdmin(id, req.user.id);
  if(!conv) return res.status(403).json({ message: 'Forbidden' });
  const nextAdmins = (conv.admins || []).filter(a => a.toString() !== userId);
  if(nextAdmins.length === 0) return res.status(400).json({ message: 'At least one admin required' });
  conv.admins = nextAdmins;
  await conv.save();
  const populated = await Conversation.findById(conv._id)
    .populate('participants')
    .populate('admins')
    .populate('createdBy')
    .populate('lastMessage');
  res.json({ conversation: populated.toObject() });
});

router.post('/:id/leave', auth, async (req, res) => {
  const { id } = req.params;
  const conv = await ensureGroupParticipant(id, req.user.id);
  if(!conv) return res.status(403).json({ message: 'Forbidden' });
  conv.participants = conv.participants.filter(p => p.toString() !== req.user.id);
  conv.admins = (conv.admins || []).filter(a => a.toString() !== req.user.id);
  if((conv.admins || []).length === 0 && conv.participants.length){
    conv.admins = [conv.participants[0]];
  }
  await conv.save();
  const populated = await Conversation.findById(conv._id)
    .populate('participants')
    .populate('admins')
    .populate('createdBy')
    .populate('lastMessage');
  res.json({ conversation: populated.toObject() });
});

module.exports = router;
