const express = require('express');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  const userId = req.user.id;
  const convs = await Conversation.find({ participants: userId })
    .populate('participants')
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
    $expr: { $eq: [ { $size: '$participants' }, 2 ] }
  }).populate('participants').populate('lastMessage');

  if(!conv){
    conv = await Conversation.create({ participants: [userId, otherId] });
    conv = await Conversation.findById(conv._id).populate('participants').populate('lastMessage');
  }

  res.json({ conversation: conv.toObject() });
});

module.exports = router;
