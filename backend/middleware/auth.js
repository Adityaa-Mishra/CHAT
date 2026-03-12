const jwt = require('jsonwebtoken');

function auth(req, res, next){
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if(!token) return res.status(401).json({ message: 'Unauthorized' });

  try{
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    req.user = payload;
    return next();
  }catch(_){
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function socketAuth(socket, next){
  try{
    const token = socket.handshake.auth?.token;
    if(!token) return next(new Error('Unauthorized'));
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    socket.user = payload;
    return next();
  }catch(err){
    return next(new Error('Unauthorized'));
  }
}

module.exports = { auth, socketAuth };
