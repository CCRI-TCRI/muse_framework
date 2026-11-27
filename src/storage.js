// Where photos and videos live.
// With BLOB_READ_WRITE_TOKEN set (Vercel Blob), the browser uploads files
// straight to Vercel Blob, which gets around Vercel's 4.5 MB request limit.
// Without it, files are saved to the local uploads/ folder.
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif' };
const VIDEO_TYPES = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-m4v': '.m4v' };
const LIMITS = { image: 20 * 1024 * 1024, video: 2 * 1024 * 1024 * 1024 };

const mode = config.blobToken ? 'blob' : 'local';
const baseType = (t) => String(t || '').split(';')[0].trim().toLowerCase();

/* ----- Vercel Blob ----- */

async function blobTokenRoute(req, res, isAdmin) {
  const { handleUpload } = require('@vercel/blob/client');
  // Token requests come from the admin's browser. Completion pings come from
  // Vercel itself and are checked by their signature inside handleUpload.
  if (req.body?.type === 'blob.generate-client-token' && !isAdmin) {
    return res.status(401).json({ error: 'Please log in again.' });
  }
  try {
    const result = await handleUpload({
      body: req.body,
      request: req,
      token: config.blobToken,
      onBeforeGenerateToken: async (pathname) => {
        const kind = pathname.startsWith('videos/') ? 'video' : 'image';
        return {
          allowedContentTypes: Object.keys(kind === 'video' ? VIDEO_TYPES : IMAGE_TYPES),
          maximumSizeInBytes: LIMITS[kind],
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/* ----- local disk ----- */

function localUploadMiddleware() {
  const multer = require('multer');
  fs.mkdirSync(config.uploadDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: config.uploadDir,
      filename: (req, file, cb) => {
        const t = baseType(file.mimetype);
        cb(null, crypto.randomBytes(12).toString('hex') + (IMAGE_TYPES[t] || VIDEO_TYPES[t]));
      },
    }),
    limits: { fileSize: LIMITS.video },
    fileFilter: (req, file, cb) => {
      const t = baseType(file.mimetype);
      if (IMAGE_TYPES[t] || VIDEO_TYPES[t]) return cb(null, true);
      const err = new Error(`That file type (${file.mimetype || 'unknown'}) isn't supported.`);
      err.uploadError = true;
      cb(err);
    },
  }).single('file');
}

/* ----- shared ----- */

// Only accept URLs that point at our own storage.
function isOurFile(url) {
  if (typeof url !== 'string') return false;
  if (url.startsWith('/uploads/')) return /^\/uploads\/[a-f0-9]{24}\.[a-z0-9]+$/.test(url);
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com');
  } catch { return false; }
}

async function removeFile(url) {
  if (!url) return;
  try {
    if (url.startsWith('/uploads/')) {
      await fs.promises.rm(path.join(config.uploadDir, path.basename(url)), { force: true });
    } else if (config.blobToken && isOurFile(url)) {
      const { del } = require('@vercel/blob');
      await del(url, { token: config.blobToken });
    }
  } catch (err) {
    console.error('Could not delete file', url, err.message);
  }
}

module.exports = { mode, blobTokenRoute, localUploadMiddleware, isOurFile, removeFile };
