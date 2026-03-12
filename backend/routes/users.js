const express = require('express');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if(!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user: user.toJSON() });
});

router.get('/search', auth, async (req, res) => {
  const q = (req.query.q || '').toString().toLowerCase();
  if(!q) return res.json({ users: [] });
  const users = await User.find({
    _id: { $ne: req.user.id },
    username: { $regex: q, $options: 'i' }
  }).limit(20);
  res.json({ users: users.map(u => u.toJSON()) });
});

module.exports = router;
