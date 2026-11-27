// Runs the shop on your own computer or server. On Vercel, api/index.js is used instead.
const app = require('./src/app');
const config = require('./src/config');
const db = require('./src/db');
const storage = require('./src/storage');

db.init().then(() => {
  app.listen(config.port, () => {
    const url = config.publicUrl || `http://localhost:${config.port}`;
    console.log(`\n  ${config.storeName} is running at ${url}`);
    console.log(`  Admin: ${url}/admin`);
    if (config.generatedPassword) console.log(`  No ADMIN_PASSWORD set, so this one works until the next restart: ${config.adminPassword}`);
    console.log(`  Database: ${config.databaseUrl ? 'Postgres (DATABASE_URL)' : 'local, in the data/ folder'}`);
    console.log(`  Uploads: ${storage.mode === 'blob' ? 'Vercel Blob' : 'local, in the uploads/ folder'}`);
    console.log('');
  });
}).catch((err) => {
  console.error('Could not start the database:', err.message);
  process.exit(1);
});
