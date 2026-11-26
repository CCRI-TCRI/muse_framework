const express = require('express');
const multer = require('multer');
const db = require('./db');
const config = require('./config');
const payments = require('./payments');
const live = require('./live');
const auth = require('./auth');
const { imageUpload, videoUpload, removeUpload } = require('./uploads');

const router = express.Router();
const json = express.json({ limit: '100kb' });

const publicProduct = (p) => ({
  id: p.id, name: p.name, description: p.description, category: p.category,
  price_cents: p.price_cents, sizes: p.sizes.split(',').map((s) => s.trim()).filter(Boolean),
  in_stock: p.stock > 0, low_stock: p.stock > 0 && p.stock <= 5 ? p.stock : null,
  image: p.image, color: p.color,
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- Shop ---------- */

router.get('/config', (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (config.turn) iceServers.push(config.turn);
  res.json({ storeName: config.storeName, currency: config.currency, demoMode: payments.demoMode, iceServers });
});

router.get('/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY created_at DESC, id DESC').all();
  res.json(rows.map(publicProduct));
});

router.get('/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'We could not find that item.' });
  const videos = db.prepare('SELECT id, title, description, file FROM videos WHERE product_id = ? ORDER BY id DESC').all(p.id);
  res.json({ ...publicProduct(p), videos });
});

router.get('/videos', (req, res) => {
  const rows = db.prepare(`SELECT v.id, v.title, v.description, v.file, v.created_at, v.product_id,
                                  p.name AS product_name, p.price_cents AS product_price
                           FROM videos v LEFT JOIN products p ON p.id = v.product_id AND p.active = 1
                           ORDER BY v.id DESC`).all();
  res.json(rows);
});

router.get('/live', (req, res) => res.json(live.status()));

router.post('/checkout', json, wrap(async (req, res) => {
  try {
    res.json(await payments.startCheckout(req.body.items));
  } catch (err) {
    if (err.type && err.type.startsWith('Stripe')) {
      console.error('Stripe error:', err.message);
      return res.status(502).json({ error: 'The payment provider had a problem. Please try again in a minute.' });
    }
    res.status(400).json({ error: err.message });
  }
}));

router.get('/orders/confirm', wrap(async (req, res) => {
  res.json(await payments.confirm({
    sessionId: req.query.session_id, orderId: req.query.order, token: req.query.token,
  }));
}));

/* ---------- Admin ---------- */

const admin = express.Router();

admin.post('/login', auth.loginRateLimit, json, (req, res) => {
  if (!auth.passwordMatches(req.body.password)) return res.status(401).json({ error: 'Wrong password.' });
  auth.setLoginCookie(res);
  res.json({ ok: true });
});

admin.post('/logout', (req, res) => {
  auth.clearLoginCookie(res);
  res.json({ ok: true });
});

admin.get('/me', (req, res) => res.json({ loggedIn: auth.isAdminRequest(req) }));

admin.use(auth.requireAdmin);

admin.get('/summary', (req, res) => {
  const sales = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS revenue
                            FROM orders WHERE status IN ('paid', 'shipped')`).get();
  const toShip = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'`).get().n;
  const lowStock = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND stock <= 5').get().n;
  res.json({ ...sales, toShip, lowStock, demoMode: payments.demoMode });
});

admin.get('/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all());
});

function readProductFields(body) {
  const name = String(body.name || '').trim();
  const price = Math.round(Number(body.price) * 100);
  if (!name) throw new Error('Give the item a name.');
  if (!Number.isFinite(price) || price < 50) throw new Error('Price needs to be at least 0.50.');
  const stock = Math.max(0, Math.floor(Number(body.stock) || 0));
  const sizes = String(body.sizes || '').split(',').map((s) => s.trim()).filter(Boolean).join(',');
  const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '#d9cfc1';
  return {
    name: name.slice(0, 120),
    description: String(body.description || '').slice(0, 4000),
    category: String(body.category || 'Other').trim().slice(0, 40) || 'Other',
    price, stock, sizes, color,
    active: body.active === 'false' || body.active === '0' ? 0 : 1,
  };
}

admin.post('/products', imageUpload.single('image'), (req, res) => {
  try {
    const f = readProductFields(req.body);
    const image = req.file ? `/uploads/${req.file.filename}` : null;
    const r = db.prepare(`INSERT INTO products (name, description, category, price_cents, sizes, stock, color, active, image)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(f.name, f.description, f.category, f.price, f.sizes, f.stock, f.color, f.active, image);
    res.json({ id: Number(r.lastInsertRowid) });
  } catch (err) {
    if (req.file) removeUpload(`/uploads/${req.file.filename}`);
    res.status(400).json({ error: err.message });
  }
});

admin.put('/products/:id', imageUpload.single('image'), (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  try {
    const f = readProductFields(req.body);
    let image = existing.image;
    if (req.file) { removeUpload(existing.image); image = `/uploads/${req.file.filename}`; }
    else if (req.body.removeImage === '1') { removeUpload(existing.image); image = null; }
    db.prepare(`UPDATE products SET name = ?, description = ?, category = ?, price_cents = ?, sizes = ?, stock = ?,
                color = ?, active = ?, image = ? WHERE id = ?`)
      .run(f.name, f.description, f.category, f.price, f.sizes, f.stock, f.color, f.active, image, existing.id);
    res.json({ ok: true });
  } catch (err) {
    if (req.file) removeUpload(`/uploads/${req.file.filename}`);
    res.status(400).json({ error: err.message });
  }
});

admin.delete('/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Item not found.' });
  removeUpload(p.image);
  db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

admin.get('/videos', (req, res) => {
  res.json(db.prepare(`SELECT v.*, p.name AS product_name FROM videos v
                       LEFT JOIN products p ON p.id = v.product_id ORDER BY v.id DESC`).all());
});

admin.post('/videos', videoUpload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pick a video file to upload.' });
  const title = String(req.body.title || '').trim().slice(0, 140) || 'Untitled video';
  const productId = Number(req.body.product_id) || null;
  if (productId && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) {
    removeUpload(`/uploads/${req.file.filename}`);
    return res.status(400).json({ error: 'That item no longer exists.' });
  }
  const r = db.prepare('INSERT INTO videos (title, description, file, product_id) VALUES (?, ?, ?, ?)')
    .run(title, String(req.body.description || '').slice(0, 2000), `/uploads/${req.file.filename}`, productId);
  res.json({ id: Number(r.lastInsertRowid) });
});

admin.patch('/videos/:id', json, (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'Video not found.' });
  const title = String(req.body.title ?? v.title).trim().slice(0, 140) || v.title;
  const productId = req.body.product_id === undefined ? v.product_id : (Number(req.body.product_id) || null);
  db.prepare('UPDATE videos SET title = ?, product_id = ? WHERE id = ?').run(title, productId, v.id);
  res.json({ ok: true });
});

admin.delete('/videos/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'Video not found.' });
  removeUpload(v.file);
  db.prepare('DELETE FROM videos WHERE id = ?').run(v.id);
  res.json({ ok: true });
});

admin.get('/orders', (req, res) => {
  const orders = db.prepare(`SELECT * FROM orders WHERE status != 'pending' OR created_at > datetime('now', '-1 day')
                             ORDER BY id DESC LIMIT 300`).all();
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  res.json(orders.map((o) => ({ ...o, items: items.all(o.id) })));
});

admin.patch('/orders/:id', json, (req, res) => {
  const allowed = ['paid', 'shipped', 'cancelled'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status.' });
  const r = db.prepare(`UPDATE orders SET status = ? WHERE id = ? AND status != 'pending'`).run(req.body.status, Number(req.params.id));
  if (!r.changes) return res.status(400).json({ error: 'Only paid orders can be updated.' });
  res.json({ ok: true });
});

router.use('/admin', admin);

// Friendly messages for upload problems instead of a stack trace.
router.use((err, req, res, next) => {
  if (err.uploadError) return res.status(400).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too big.' : 'The upload did not go through. Please try again.';
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

module.exports = router;
