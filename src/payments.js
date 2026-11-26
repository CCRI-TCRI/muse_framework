const config = require('./config');
const db = require('./db');
const { sign } = require('./auth');

const stripe = config.stripeSecretKey ? require('stripe')(config.stripeSecretKey) : null;
const demoMode = !stripe;

const SHIP_COUNTRIES = (process.env.SHIP_COUNTRIES || 'US,CA,GB,IE,AU,NZ,DE,FR,NL,BE,ES,IT,SE,DK,NO,FI,AT,CH,PT')
  .split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);

// Turns a cart sent by the browser into priced line items using the database.
// Prices from the browser are never trusted.
function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Your bag is empty.');
  if (items.length > 50) throw new Error('That is a lot of items. Please split it into two orders.');

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1');
  const lines = [];
  const wanted = new Map();

  for (const raw of items) {
    const id = Number(raw.id);
    const qty = Math.floor(Number(raw.qty));
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error('Something in your bag looks off. Try removing it and adding it again.');
    const product = getProduct.get(id);
    if (!product) throw new Error('One of the items in your bag is no longer available.');

    const sizes = product.sizes.split(',').map((s) => s.trim()).filter(Boolean);
    const size = sizes.length ? String(raw.size || '') : '';
    if (sizes.length && !sizes.includes(size)) throw new Error(`Please pick a size for ${product.name}.`);

    wanted.set(id, (wanted.get(id) || 0) + qty);
    if (wanted.get(id) > product.stock) {
      throw new Error(product.stock > 0
        ? `Only ${product.stock} of ${product.name} left, please lower the quantity.`
        : `${product.name} just sold out, sorry.`);
    }
    lines.push({ product, size, qty });
  }
  return lines;
}

function createOrder(lines) {
  const total = lines.reduce((sum, l) => sum + l.product.price_cents * l.qty, 0);
  const order = db.prepare('INSERT INTO orders (total_cents, demo) VALUES (?, ?)').run(total, demoMode ? 1 : 0);
  const orderId = Number(order.lastInsertRowid);
  const addItem = db.prepare(`INSERT INTO order_items (order_id, product_id, name, size, unit_price_cents, quantity)
                              VALUES (?, ?, ?, ?, ?, ?)`);
  for (const l of lines) addItem.run(orderId, l.product.id, l.product.name, l.size || null, l.product.price_cents, l.qty);
  return orderId;
}

function demoToken(orderId) {
  return sign(`demo-order-${orderId}`);
}

async function startCheckout(items) {
  const lines = priceCart(items);
  const orderId = createOrder(lines);

  if (demoMode) {
    return { url: `/success.html?order=${orderId}&token=${demoToken(orderId)}` };
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lines.map((l) => ({
      quantity: l.qty,
      price_data: {
        currency: config.currency,
        unit_amount: l.product.price_cents,
        product_data: {
          name: l.size ? `${l.product.name} (${l.size})` : l.product.name,
          ...(l.product.image ? { images: [config.publicUrl + l.product.image] } : {}),
        },
      },
    })),
    shipping_address_collection: { allowed_countries: SHIP_COUNTRIES },
    phone_number_collection: { enabled: true },
    client_reference_id: String(orderId),
    metadata: { order_id: String(orderId) },
    success_url: `${config.publicUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.publicUrl}/cart.html?cancelled=1`,
  });

  db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(session.id, orderId);
  return { url: session.url };
}

function formatAddress(details) {
  if (!details || !details.address) return null;
  const a = details.address;
  return [details.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country]
    .filter(Boolean).join('\n');
}

// Marks an order paid and takes the items out of stock. Safe to call twice.
function markPaid(orderId, { email = null, name = null, address = null } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) { db.exec('ROLLBACK'); return null; }
    if (order.status === 'pending') {
      db.prepare(`UPDATE orders SET status = 'paid', paid_at = datetime('now'), email = ?, customer_name = ?, shipping_address = ?
                  WHERE id = ?`).run(email, name, address, orderId);
      const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(orderId);
      const takeStock = db.prepare('UPDATE products SET stock = MAX(stock - ?, 0) WHERE id = ?');
      for (const item of items) if (item.product_id) takeStock.run(item.quantity, item.product_id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return orderId;
}

async function handlePaidSession(session) {
  if (session.payment_status !== 'paid') return null;
  const orderId = Number(session.metadata?.order_id || session.client_reference_id);
  if (!orderId) return null;
  const shipping = session.collected_information?.shipping_details || session.shipping_details;
  return markPaid(orderId, {
    email: session.customer_details?.email || null,
    name: shipping?.name || session.customer_details?.name || null,
    address: formatAddress(shipping),
  });
}

async function confirm({ sessionId, orderId, token }) {
  let id = null;
  if (sessionId && stripe) {
    const session = await stripe.checkout.sessions.retrieve(String(sessionId));
    id = await handlePaidSession(session);
    if (!id) return { status: 'unpaid' };
  } else if (orderId && token && demoMode) {
    id = Number(orderId);
    if (token !== demoToken(id)) return { status: 'unknown' };
    markPaid(id, { name: 'Demo customer' });
  } else {
    return { status: 'unknown' };
  }

  const order = db.prepare('SELECT id, status, total_cents, email, demo FROM orders WHERE id = ?').get(id);
  const items = db.prepare('SELECT name, size, unit_price_cents, quantity FROM order_items WHERE order_id = ?').all(id);
  return { ...order, items };
}

function webhook(rawBody, signature) {
  if (!stripe || !config.stripeWebhookSecret) throw new Error('Webhooks are not set up.');
  const event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    return handlePaidSession(event.data.object);
  }
  return null;
}

module.exports = { demoMode, startCheckout, confirm, webhook };
