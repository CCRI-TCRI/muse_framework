const express = require('express');
const db = require('./db');
const config = require('./config');
const payments = require('./payments');
const live = require('./live');
const auth = require('./auth');
const storage = require('./storage');

const router = express.Router();
router.use(express.json({ limit: '200kb' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, err, code = 400) => res.status(code).json({ error: err.message || String(err) });
const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

const publicProduct = (p) => ({
  id: p.id, name: p.name, description: p.description, details: p.details, category: p.category,
  price_cents: p.price_cents, compare_cents: p.compare_cents > p.price_cents ? p.compare_cents : null, sizes: p.sizes.split(',').map((s) => s.trim()).filter(Boolean),
  in_stock: p.stock > 0, low_stock: p.stock > 0 && p.stock <= 3 ? p.stock : null,
  images: p.images, color: p.color, created_at: p.created_at,
});

/* ---------- shop ---------- */

router.get('/config', wrap(async (req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (config.turn) iceServers.push(config.turn);
  res.json({
    storeName: config.storeName, currency: config.currency, demoMode: payments.demoMode,
    uploadMode: storage.mode, iceServers, settings: await db.getSettings(),
  });
}));

router.get('/products', wrap(async (req, res) => {
  const rows = await db.query('SELECT * FROM products WHERE active ORDER BY id DESC');
  res.json(rows.map(publicProduct));
}));

router.get('/products/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const p = Number.isInteger(id) && await db.one('SELECT * FROM products WHERE id = $1 AND active', [id]);
  if (!p) return res.status(404).json({ error: 'We could not find that piece.' });
  const videos = await db.query('SELECT id, title, description, file FROM videos WHERE product_id = $1 ORDER BY id DESC', [p.id]);
  const related = await db.query('SELECT * FROM products WHERE active AND id <> $1 ORDER BY (category = $2) DESC, id DESC LIMIT 4', [p.id, p.category]);
  res.json({ ...publicProduct(p), videos, related: related.map(publicProduct) });
}));

router.get('/videos', wrap(async (req, res) => {
  res.json(await db.query(`SELECT v.id, v.title, v.description, v.file, v.created_at, p.id AS product_id,
                                  p.name AS product_name, p.price_cents AS product_price
                           FROM videos v LEFT JOIN products p ON p.id = v.product_id AND p.active
                           ORDER BY v.id DESC`));
}));

router.post('/checkout', wrap(async (req, res) => {
  try {
    res.json(await payments.startCheckout(req.body.items, baseUrl(req)));
  } catch (err) {
    if (err.type && String(err.type).startsWith('Stripe')) {
      console.error('Stripe error:', err.message);
      return fail(res, new Error('The payment provider had a problem. Please try again in a minute.'), 502);
    }
    fail(res, err);
  }
}));

router.get('/orders/confirm', wrap(async (req, res) => {
  res.json(await payments.confirm({ sessionId: req.query.session_id, orderId: req.query.order, token: req.query.token }));
}));

/* ---------- live (viewers) ---------- */

router.get('/live/status', wrap(async (req, res) => res.json(await live.status())));
router.post('/live/join', wrap(async (req, res) => res.json(await live.join())));
router.get('/live/poll', wrap(async (req, res) => res.json(await live.viewerPoll(req.query.viewer, req.query.after))));
router.post('/live/signal', wrap(async (req, res) => {
  try { await live.viewerSignal(req.body.viewer, req.body.data); res.json({ ok: true }); } catch (err) { fail(res, err); }
}));
router.post('/live/chat', wrap(async (req, res) => {
  try { await live.viewerChat(req.body.viewer, req.body.name, req.body.text); res.json({ ok: true }); } catch (err) { fail(res, err); }
}));

/* ---------- admin ---------- */

const admin = express.Router();

admin.post('/login', auth.loginRateLimit, (req, res) => {
  if (!config.adminPassword) return fail(res, new Error('No admin password is set yet. Add ADMIN_PASSWORD in your Vercel project settings, then redeploy.'), 503);
  if (!auth.passwordMatches(req.body.password)) return fail(res, new Error('That password is not right.'), 401);
  auth.setLoginCookie(req, res);
  res.json({ ok: true });
});

admin.post('/logout', (req, res) => { auth.clearLoginCookie(res); res.json({ ok: true }); });
admin.get('/me', (req, res) => res.json({ loggedIn: auth.isAdminRequest(req), passwordSet: !!config.adminPassword }));

// Vercel Blob talks to this route too (to confirm uploads), so it sits before the login check.
admin.post('/blob', wrap((req, res) => storage.blobTokenRoute(req, res, auth.isAdminRequest(req))));

admin.use(auth.requireAdmin);

if (storage.mode === 'local') {
  const upload = storage.localUploadMiddleware();
  admin.post('/upload', upload, (req, res) => {
    if (!req.file) return fail(res, new Error('Choose a file to upload.'));
    res.json({ url: `/uploads/${req.file.filename}` });
  });
}

admin.get('/summary', wrap(async (req, res) => {
  const sales = await db.one(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total_cents), 0)::int AS revenue
                              FROM orders WHERE status IN ('paid', 'shipped')`);
  const toShip = await db.one(`SELECT COUNT(*)::int AS n FROM orders WHERE status = 'paid'`);
  const lowStock = await db.one('SELECT COUNT(*)::int AS n FROM products WHERE active AND stock <= 3');
  res.json({ ...sales, toShip: toShip.n, lowStock: lowStock.n, demoMode: payments.demoMode, uploadMode: storage.mode });
}));

admin.get('/products', wrap(async (req, res) => res.json(await db.query('SELECT * FROM products ORDER BY id DESC'))));

function readProduct(body) {
  const name = String(body.name || '').trim();
  const price = Math.round(Number(body.price) * 100);
  if (!name) throw new Error('Give the piece a name.');
  if (!Number.isFinite(price) || price < 50) throw new Error('The price needs to be at least 0.50.');
  const compare = body.compare_price === '' || body.compare_price == null ? null : Math.round(Number(body.compare_price) * 100);
  if (compare !== null && (!Number.isFinite(compare) || compare <= price)) throw new Error('The "was" price needs to be higher than the price, or left empty.');
  const images = Array.isArray(body.images) ? body.images.filter(storage.isOurFile).slice(0, 8) : [];
  return {
    name: name.slice(0, 120),
    description: String(body.description || '').slice(0, 4000),
    details: String(body.details || '').slice(0, 2000),
    category: String(body.category || '').trim().slice(0, 40) || 'Other',
    price,
    compare,
    stock: Math.max(0, Math.floor(Number(body.stock) || 0)),
    sizes: String(body.sizes || '').split(',').map((s) => s.trim()).filter(Boolean).join(','),
    color: /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '#e7e2da',
    active: body.active !== false,
    images,
  };
}

admin.post('/products', wrap(async (req, res) => {
  let f;
  try { f = readProduct(req.body); } catch (err) { return fail(res, err); }
  const row = await db.one(`INSERT INTO products (name, description, details, category, price_cents, sizes, stock, color, active, images, compare_cents)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [f.name, f.description, f.details, f.category, f.price, f.sizes, f.stock, f.color, f.active, JSON.stringify(f.images), f.compare]);
  res.json(row);
}));

admin.put('/products/:id', wrap(async (req, res) => {
  const existing = await db.one('SELECT * FROM products WHERE id = $1', [Number(req.params.id)]);
  if (!existing) return fail(res, new Error('Product not found.'), 404);
  let f;
  try { f = readProduct(req.body); } catch (err) { return fail(res, err); }
  await db.query(`UPDATE products SET name = $1, description = $2, details = $3, category = $4, price_cents = $5, sizes = $6,
                  stock = $7, color = $8, active = $9, images = $10, compare_cents = $11 WHERE id = $12`,
    [f.name, f.description, f.details, f.category, f.price, f.sizes, f.stock, f.color, f.active, JSON.stringify(f.images), f.compare, existing.id]);
  for (const old of existing.images) if (!f.images.includes(old)) storage.removeFile(old);
  res.json({ ok: true });
}));

admin.delete('/products/:id', wrap(async (req, res) => {
  const p = await db.one('DELETE FROM products WHERE id = $1 RETURNING images', [Number(req.params.id)]);
  if (!p) return fail(res, new Error('Product not found.'), 404);
  for (const img of p.images) storage.removeFile(img);
  res.json({ ok: true });
}));

admin.get('/videos', wrap(async (req, res) => {
  res.json(await db.query(`SELECT v.*, p.name AS product_name FROM videos v
                           LEFT JOIN products p ON p.id = v.product_id ORDER BY v.id DESC`));
}));

admin.post('/videos', wrap(async (req, res) => {
  if (!storage.isOurFile(req.body.file)) return fail(res, new Error('Upload the video file first.'));
  const productId = Number(req.body.product_id) || null;
  if (productId && !await db.one('SELECT id FROM products WHERE id = $1', [productId])) return fail(res, new Error('That product no longer exists.'));
  const row = await db.one('INSERT INTO videos (title, description, file, product_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [String(req.body.title || '').trim().slice(0, 140) || 'Untitled', String(req.body.description || '').slice(0, 2000), req.body.file, productId]);
  res.json(row);
}));

admin.delete('/videos/:id', wrap(async (req, res) => {
  const v = await db.one('DELETE FROM videos WHERE id = $1 RETURNING file', [Number(req.params.id)]);
  if (!v) return fail(res, new Error('Video not found.'), 404);
  storage.removeFile(v.file);
  res.json({ ok: true });
}));

admin.get('/orders', wrap(async (req, res) => {
  const orders = await db.query(`SELECT * FROM orders WHERE status <> 'pending' OR created_at > now() - interval '1 day'
                                 ORDER BY id DESC LIMIT 300`);
  const items = await db.query('SELECT * FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY id', [orders.map((o) => o.id)]);
  res.json(orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id) })));
}));

admin.patch('/orders/:id', wrap(async (req, res) => {
  if (!['paid', 'shipped', 'cancelled'].includes(req.body.status)) return fail(res, new Error('Unknown status.'));
  const r = await db.one(`UPDATE orders SET status = $1 WHERE id = $2 AND status <> 'pending' RETURNING id`, [req.body.status, Number(req.params.id)]);
  if (!r) return fail(res, new Error('Only paid orders can be updated.'));
  res.json({ ok: true });
}));

admin.put('/settings', wrap(async (req, res) => {
  const current = await db.getSettings();
  for (const key of db.SETTING_KEYS) {
    if (!(key in req.body)) continue;
    let value = String(req.body[key] ?? '').slice(0, 2000);
    if (key === 'hero_media' && value && !storage.isOurFile(value)) continue;
    if (key === 'hero_media_type' && !['', 'image', 'video'].includes(value)) continue;
    if (key === 'hero_media' && current.hero_media && current.hero_media !== value) storage.removeFile(current.hero_media);
    await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
  }
  res.json(await db.getSettings());
}));

/* ----- live (seller) ----- */
admin.post('/live/start', wrap(async (req, res) => res.json(await live.start(req.body.title))));
admin.get('/live/poll', wrap(async (req, res) => res.json(await live.sellerPoll(req.query.session, req.query.after))));
admin.post('/live/signal', wrap(async (req, res) => { await live.sellerSignal(req.body.session, req.body.to, req.body.data); res.json({ ok: true }); }));
admin.post('/live/pin', wrap(async (req, res) => { await live.pin(req.body.productId); res.json({ ok: true }); }));
admin.post('/live/chat', wrap(async (req, res) => { await live.sellerChat(req.body.session, req.body.text); res.json({ ok: true }); }));
admin.post('/live/stop', wrap(async (req, res) => { await live.stop(); res.json({ ok: true }); }));

router.use('/admin', admin);

router.use((err, req, res, next) => {
  if (err.uploadError) return fail(res, err);
  if (err.code === 'LIMIT_FILE_SIZE') return fail(res, new Error('That file is too big.'));
  if (err.type === 'entity.too.large') return fail(res, new Error('That request was too large.'), 413);
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

module.exports = router;
