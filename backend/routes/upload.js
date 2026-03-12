const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { auth } = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const name = Date.now() + '-' + safe;
    cb(null, name);
  }
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/', auth, upload.single('file'), (req, res) => {
  if(!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const file = {
    name: req.file.originalname,
    url: '/uploads/' + req.file.filename,
    size: req.file.size,
    mime: req.file.mimetype
  };
  res.json({ file });
});

module.exports = router;
