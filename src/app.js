const path = require('node:path');
const express = require('express');
const config = require('./config');
const routes = require('./routes');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use('/api', routes);

// On Vercel the files in public/ are served by Vercel itself. These lines
// only matter when running the server yourself.
if (!config.onVercel) {
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', fallthrough: false }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html')));
}

module.exports = app;
