const { v2: cloudinary } = require('cloudinary');
const multer = require('multer');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const FOLDERS = { celebrity: 'famevote/celebrities', category: 'famevote/categories', avatar: 'famevote/avatars', banner: 'famevote/banners', campaign: 'famevote/campaigns' };

const isConfigured = () => Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
if (isConfigured()) {
  cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
}

/** Multer keeps the file in memory (<=5MB); nothing touches disk and the API secret never leaves the server. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED[file.mimetype] ? cb(null, true) : cb(ApiError.badRequest('Only JPEG, PNG or WebP images are allowed', 'BAD_FILE_TYPE'))),
});

/** The declared MIME type is client-controlled, so also check the real file signature (magic bytes). */
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

async function uploadImage(file, kind) {
  if (!file) throw ApiError.badRequest('No image uploaded', 'NO_FILE');
  if (sniff(file.buffer) !== file.mimetype) throw ApiError.badRequest('File content does not match its type', 'BAD_FILE_TYPE');
  if (!isConfigured()) throw ApiError.unavailable('Image storage is not configured', 'STORAGE_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: FOLDERS[kind], resource_type: 'image', overwrite: false, unique_filename: true, allowed_formats: ['jpg', 'png', 'webp'], transformation: [{ width: 1600, height: 1600, crop: 'limit' }] },
      (err, res) => (err ? reject(ApiError.unavailable('Image upload failed', 'UPLOAD_FAILED')) : resolve({ url: res.secure_url, publicId: res.public_id }))
    ).end(file.buffer);
  });
}

async function destroyImage(publicId) {
  if (!publicId || !isConfigured()) return;
  try { await cloudinary.uploader.destroy(publicId, { invalidate: true }); } catch (e) { console.error('[cloudinary] destroy failed', publicId, e.message); }
}

/** Upload the new image first; only delete the old one once the new one is safely stored on the document. */
async function replaceImage(doc, field, file, kind) {
  const old = doc[field]?.publicId;
  const fresh = await uploadImage(file, kind);
  doc[field] = fresh;
  try { await doc.save(); } catch (e) { await destroyImage(fresh.publicId); throw e; }
  await destroyImage(old);
  return fresh;
}

module.exports = { upload, uploadImage, destroyImage, replaceImage, isConfigured, MAX_BYTES };
