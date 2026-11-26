const crypto = require('node:crypto');
const config = require('./config');

const COOKIE = 'store_admin';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // a week

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

function makeToken() {
  const expires = String(Date.now() + MAX_AGE_MS);
  return `${expires}.${sign(expires)}`;
}

function tokenIsValid(token) {
  if (!token || typeof token !== 'string') return false;
  const [expires, sig] = token.split('.');
  if (!expires || !sig) return false;
  const expected = sign(expires);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(expires) > Date.now();
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function isAdminRequest(req) {
  return tokenIsValid(readCookie(req.headers.cookie, COOKIE));
}

function passwordMatches(attempt) {
  if (typeof attempt !== 'string' || !config.adminPassword) return false;
  const a = crypto.createHash('sha256').update(attempt).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

function setLoginCookie(req, res) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${makeToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_MS / 1000}${secure}`);
}

function clearLoginCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function requireAdmin(req, res, next) {
  if (isAdminRequest(req)) return next();
  res.status(401).json({ error: 'Please log in again.' });
}

// Brute force guard for the login form: 8 tries per IP per 15 minutes.
// On Vercel this is per server instance, so treat it as a speed bump.
const attempts = new Map();
function loginRateLimit(req, res, next) {
  const now = Date.now();
  const entry = attempts.get(req.ip) || { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 15 * 60 * 1000; }
  entry.count += 1;
  attempts.set(req.ip, entry);
  if (entry.count > 8) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  next();
}

module.exports = {
  isAdminRequest, passwordMatches, setLoginCookie, clearLoginCookie, requireAdmin, loginRateLimit, sign,
};
