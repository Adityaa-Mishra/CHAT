require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { Server } = require('socket.io');

const { connectDB } = require('./config/db');
const { socketAuth } = require('./middleware/auth');
const User = require('./models/User');
const Conversation = require('./models/Conversation');
const Message = require('./models/Message');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const uploadRoutes = require('./routes/upload');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/upload', uploadRoutes);

const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

const userSockets = new Map();
const socketToUser = new Map();

function addUserSocket(userId, socketId){
  if(!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socketId);
}

function removeUserSocket(userId, socketId){
  if(!userSockets.has(userId)) return;
  const set = userSockets.get(userId);
  set.delete(socketId);
  if(set.size === 0) userSockets.delete(userId);
}

function isUserOnline(userId){
  return userSockets.has(userId);
}

io.use(socketAuth);

io.on('connection', async (socket) => {
  const userId = socket.user.id;
  socketToUser.set(socket.id, userId);
  addUserSocket(userId, socket.id);
  socket.join('user:' + userId);

  await User.findByIdAndUpdate(userId, { online: true, lastSeen: null });
  io.emit('presence:update', { userId, online: true, lastSeen: null });

  // Mark pending messages as delivered when user connects
  const convs = await Conversation.find({ participants: userId }).select('_id');
  const convIds = convs.map(c => c._id);
  const pending = await Message.find({
    conversationId: { $in: convIds },
    sender: { $ne: userId },
    status: 'sent'
  });
  if(pending.length){
    await Message.updateMany(
      { _id: { $in: pending.map(m => m._id) } },
      { $set: { status: 'delivered' } }
    );
    pending.forEach(m => {
      io.to('user:' + m.sender.toString()).emit('message:status', {
        messageId: m._id,
        status: 'delivered',
        conversationId: m.conversationId.toString()
      });
    });
  }

  socket.on('conversation:join', async ({ conversationId }) => {
    const conv = await Conversation.findById(conversationId);
    if(!conv) return;
    const ok = conv.participants.some(p => p.toString() === userId);
    if(!ok) return;
    socket.join('conv:' + conversationId);
  });

  socket.on('message:typing', async ({ conversationId, isTyping }) => {
    const conv = await Conversation.findById(conversationId);
    if(!conv) return;
    const ok = conv.participants.some(p => p.toString() === userId);
    if(!ok) return;
    socket.to('conv:' + conversationId).emit('typing:update', { conversationId, userId, isTyping: !!isTyping });
  });

  socket.on('message:send', async ({ conversationId, text, type, file, clientId }) => {
    if(!conversationId) return;
    const msgType = type || 'text';
    if(msgType === 'text' && !text) return;
    if(msgType === 'file' && !file?.url) return;
    const conv = await Conversation.findById(conversationId);
    if(!conv) return;
    const ok = conv.participants.some(p => p.toString() === userId);
    if(!ok) return;

    let status = 'sent';
    const recipients = conv.participants.filter(p => p.toString() !== userId);
    const delivered = recipients.some(r => isUserOnline(r.toString()));
    if(delivered) status = 'delivered';

    const message = await Message.create({
      conversationId,
      sender: userId,
      text: text || '',
      type: msgType,
      file: file || null,
      status
    });

    conv.lastMessage = message._id;
    await conv.save();

    const payload = {
      _id: message._id,
      conversationId,
      sender: userId,
      text: text || '',
      type: msgType,
      file: file || null,
      status,
      createdAt: message.createdAt,
      clientId
    };

    const roomName = 'conv:' + conversationId;
    const room = io.sockets.adapter.rooms.get(roomName) || new Set();
    socket.to(roomName).emit('message:new', payload);
    socket.emit('message:new', payload);

    recipients.forEach(r => {
      const rid = r.toString();
      const inRoom = [...room].some(sid => socketToUser.get(sid) === rid);
      if(!inRoom){ io.to('user:' + rid).emit('message:new', payload); }
    });
  });

  socket.on('message:read', async ({ conversationId }) => {
    const conv = await Conversation.findById(conversationId);
    if(!conv) return;
    const ok = conv.participants.some(p => p.toString() === userId);
    if(!ok) return;

    const unread = await Message.find({
      conversationId,
      sender: { $ne: userId },
      status: { $ne: 'read' }
    });

    if(!unread.length) return;

    await Message.updateMany(
      { _id: { $in: unread.map(m => m._id) } },
      { $set: { status: 'read' } }
    );

    unread.forEach(m => {
      io.to('user:' + m.sender.toString()).emit('message:status', {
        messageId: m._id,
        status: 'read',
        conversationId
      });
    });
  });

  socket.on('message:edit', async ({ conversationId, messageId, text }) => {
    if(!conversationId || !messageId || !text) return;
    const conv = await Conversation.findById(conversationId);
    if(!conv) return;
    const msg = await Message.findById(messageId);
    if(!msg) return;
    if(msg.sender.toString() !== userId) return;
    if(msg.deleted || msg.type !== 'text') return;

    msg.text = text;
    msg.editedAt = new Date();
    await msg.save();

    const payload = { conversationId, messageId, text, editedAt: msg.editedAt };
    const roomName = 'conv:' + conversationId;
    io.to(roomName).emit('message:updated', payload);
    conv.participants.forEach(p => {
      const rid = p.toString();
      io.to('user:' + rid).emit('message:updated', payload);
    });
  });

  socket.on('message:delete', async ({ conversationId, messageId }) => {
    if(!conversationId || !messageId) return;
    const conv = await Conversation.findById(conversationId);
    if(!conv) return;
    const msg = await Message.findById(messageId);
    if(!msg) return;
    if(msg.sender.toString() !== userId) return;

    msg.deleted = true;
    msg.text = '';
    msg.file = null;
    msg.type = 'text';
    await msg.save();

    const payload = { conversationId, messageId };
    const roomName = 'conv:' + conversationId;
    io.to(roomName).emit('message:deleted', payload);
    conv.participants.forEach(p => {
      const rid = p.toString();
      io.to('user:' + rid).emit('message:deleted', payload);
    });
  });

  socket.on('disconnect', async () => {
    removeUserSocket(userId, socket.id);
    socketToUser.delete(socket.id);
    if(!isUserOnline(userId)){
      const lastSeen = new Date();
      await User.findByIdAndUpdate(userId, { online: false, lastSeen });
      io.emit('presence:update', { userId, online: false, lastSeen });
    }
  });
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    server.listen(PORT, () => console.log('Server listening on', PORT));
  })
  .catch(err => {
    console.error('DB connection failed', err);
    process.exit(1);
  });
