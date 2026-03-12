const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

function signToken(user){
  return jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET || 'dev_secret', { expiresIn: '7d' });
}

router.post('/signup', async (req, res) => {
  try{
    const { username, email, password } = req.body;
    if(!username || !email || !password) return res.status(400).json({ message: 'Missing fields' });

    const exists = await User.findOne({ $or: [ { username: username.toLowerCase() }, { email: email.toLowerCase() } ] });
    if(exists) return res.status(409).json({ message: 'Username or email already in use' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, passwordHash });

    const token = signToken(user);
    res.json({ token, user: user.toJSON() });
  }catch(err){
    res.status(500).json({ message: 'Signup failed' });
  }
});

router.post('/login', async (req, res) => {
  try{
    const { email, password } = req.body;
    if(!email || !password) return res.status(400).json({ message: 'Missing fields' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if(!user) return res.status(401).json({ message: 'Invalid email or password' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if(!ok) return res.status(401).json({ message: 'Invalid email or password' });

    const token = signToken(user);
    res.json({ token, user: user.toJSON() });
  }catch(err){
    res.status(500).json({ message: 'Login failed' });
  }
});

module.exports = router;
