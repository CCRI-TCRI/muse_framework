const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const env = process.env;
const onVercel = !!env.VERCEL;

// On Vercel every request can land on a fresh server, so a random password
// would change constantly. There the password has to come from the settings.
let adminPassword = env.ADMIN_PASSWORD || '';
let generatedPassword = false;
if (!adminPassword && !onVercel) {
  adminPassword = crypto.randomBytes(6).toString('hex');
  generatedPassword = true;
}

const sessionSecret = env.SESSION_SECRET
  || crypto.createHash('sha256').update(`store-session:${adminPassword}`).digest('hex');

module.exports = {
  onVercel,
  port: Number(env.PORT) || 3000,
  storeName: env.STORE_NAME || 'Muhoozi Martin Clothes',
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  // Prices are in Uganda shillings.
  currency: 'ugx',
  adminPassword,
  generatedPassword,
  sessionSecret,
  databaseUrl: env.DATABASE_URL || env.POSTGRES_URL || '',
  blobToken: env.BLOB_READ_WRITE_TOKEN || '',
  turn: env.TURN_URL
    ? { urls: env.TURN_URL, username: env.TURN_USERNAME || '', credential: env.TURN_CREDENTIAL || '' }
    : null,
  dataDir: path.join(__dirname, '..', 'data'),
  uploadDir: path.join(__dirname, '..', 'uploads'),
};
