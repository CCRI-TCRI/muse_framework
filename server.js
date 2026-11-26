const http = require('node:http');
const path = require('node:path');
const express = require('express');
const config = require('./src/config');
const payments = require('./src/payments');
const live = require('./src/live');
const routes = require('./src/routes');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Stripe needs the raw body to check the signature, so this comes before any JSON parsing.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  try {
    await payments.webhook(req.body, req.headers['stripe-signature']);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(400).send(`Webhook error: ${err.message}`);
  }
});

app.use('/api', routes);

app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', fallthrough: false }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

const server = http.createServer(app);
live.attach(server);

server.listen(config.port, () => {
  console.log(`\n  ${config.storeName} is running at ${config.publicUrl}`);
  console.log(`  Admin area: ${config.publicUrl}/admin`);
  if (config.generatedPassword) {
    console.log(`  No ADMIN_PASSWORD set, so this one works until the next restart: ${config.adminPassword}`);
  }
  if (payments.demoMode) {
    console.log('  Payments are in DEMO mode. Add STRIPE_SECRET_KEY to .env to take real card payments.');
  }
  console.log('');
});
