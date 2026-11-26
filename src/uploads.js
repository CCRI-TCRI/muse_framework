const multer = require('multer');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');

fs.mkdirSync(config.uploadDir, { recursive: true });

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
const VIDEO_TYPES = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-m4v': '.m4v' };

// Recorded clips from the browser come in as e.g. "video/webm;codecs=vp8,opus".
const baseType = (file) => String(file.mimetype).split(';')[0].trim().toLowerCase();

function maker(types, maxBytes) {
  return multer({
    storage: multer.diskStorage({
      destination: config.uploadDir,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + types[baseType(file)]),
    }),
    limits: { fileSize: maxBytes },
    fileFilter: (req, file, cb) => {
      if (types[baseType(file)]) return cb(null, true);
      const err = new Error(`That file type (${file.mimetype || 'unknown'}) isn't supported.`);
      err.uploadError = true;
      cb(err);
    },
  });
}

const imageUpload = maker(IMAGE_TYPES, 15 * 1024 * 1024);
const videoUpload = maker(VIDEO_TYPES, 2 * 1024 * 1024 * 1024);

function removeUpload(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const file = path.join(config.uploadDir, path.basename(publicPath));
  fs.rm(file, { force: true }, () => {});
}

module.exports = { imageUpload, videoUpload, removeUpload };
