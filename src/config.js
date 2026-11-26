const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;

let adminPassword = env.ADMIN_PASSWORD;
let generatedPassword = false;
if (!adminPassword) {
  adminPassword = crypto.randomBytes(6).toString('hex');
  generatedPassword = true;
}

module.exports = {
  port: Number(env.PORT) || 3000,
  storeName: env.STORE_NAME || 'Muse Wear',
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  currency: (env.CURRENCY || 'usd').toLowerCase(),
  adminPassword,
  generatedPassword,
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  stripeSecretKey: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  turn: env.TURN_URL
    ? { urls: env.TURN_URL, username: env.TURN_USERNAME || '', credential: env.TURN_CREDENTIAL || '' }
    : null,
  dataDir: path.join(__dirname, '..', 'data'),
  uploadDir: path.join(__dirname, '..', 'uploads'),
};
