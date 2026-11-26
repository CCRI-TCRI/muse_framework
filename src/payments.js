const config = require('./config');
const db = require('./db');
const { sign } = require('./auth');

const stripe = config.stripeSecretKey ? require('stripe')(config.stripeSecretKey) : null;
const demoMode = !stripe;

// Turns the bag sent by the browser into priced lines using the database.
// Prices from the browser are never trusted.
async function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Your bag is empty.');
  if (items.length > 50) throw new Error('That is a lot of items. Please split it into two orders.');

  const ids = [...new Set(items.map((i) => Number(i.id)).filter(Number.isInteger))];
  const rows = await db.query('SELECT * FROM products WHERE id = ANY($1::int[]) AND active', [ids]);
  const byId = new Map(rows.map((p) => [p.id, p]));
  const lines = [];
  const wanted = new Map();

  for (const raw of items) {
    const id = Number(raw.id);
    const qty = Math.floor(Number(raw.qty));
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error('Something in your bag looks off. Try removing it and adding it again.');
    const product = byId.get(id);
    if (!product) throw new Error('One of the items in your bag is no longer available.');

    const sizes = product.sizes.split(',').map((s) => s.trim()).filter(Boolean);
    const size = sizes.length ? String(raw.size || '') : '';
    if (sizes.length && !sizes.includes(size)) throw new Error(`Please choose a size for ${product.name}.`);

    wanted.set(id, (wanted.get(id) || 0) + qty);
    if (wanted.get(id) > product.stock) {
      throw new Error(product.stock > 0
        ? `Only ${product.stock} of ${product.name} left. Please lower the quantity.`
        : `${product.name} has just sold out, sorry.`);
    }
    lines.push({ product, size, qty });
  }
  return lines;
}

async function createOrder(lines) {
  const total = lines.reduce((sum, l) => sum + l.product.price_cents * l.qty, 0);
  const order = await db.one('INSERT INTO orders (total_cents, demo) VALUES ($1, $2) RETURNING id', [total, demoMode]);
  for (const l of lines) {
    await db.query(`INSERT INTO order_items (order_id, product_id, name, size, unit_price_cents, quantity)
                    VALUES ($1, $2, $3, $4, $5, $6)`, [order.id, l.product.id, l.product.name, l.size || null, l.product.price_cents, l.qty]);
  }
  return order.id;
}

const demoToken = (orderId) => sign(`demo-order-${orderId}`);

async function startCheckout(items, baseUrl) {
  const lines = await priceCart(items);
  const orderId = await createOrder(lines);

  if (demoMode) return { url: `/success?order=${orderId}&token=${demoToken(orderId)}` };

  const absolute = (url) => (url.startsWith('http') ? url : baseUrl + url);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lines.map((l) => ({
      quantity: l.qty,
      price_data: {
        currency: config.currency,
        unit_amount: l.product.price_cents,
        product_data: {
          name: l.size ? `${l.product.name}, size ${l.size}` : l.product.name,
          ...(l.product.images[0] ? { images: [absolute(l.product.images[0])] } : {}),
        },
      },
    })),
    shipping_address_collection: { allowed_countries: config.shipCountries },
    phone_number_collection: { enabled: true },
    client_reference_id: String(orderId),
    metadata: { order_id: String(orderId) },
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/cart?cancelled=1`,
  });

  await db.query('UPDATE orders SET stripe_session_id = $1 WHERE id = $2', [session.id, orderId]);
  return { url: session.url };
}

function formatAddress(details) {
  if (!details || !details.address) return null;
  const a = details.address;
  return [details.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country]
    .filter(Boolean).join('\n');
}

// Marks an order paid and takes its items out of stock, in one statement so
// it can't half-happen. Calling it twice does nothing the second time.
async function markPaid(orderId, { email = null, name = null, address = null } = {}) {
  await db.query(`
    WITH paid AS (
      UPDATE orders SET status = 'paid', paid_at = now(), email = $2, customer_name = $3, shipping_address = $4
      WHERE id = $1 AND status = 'pending'
      RETURNING id
    ), taken AS (
      SELECT oi.product_id, SUM(oi.quantity)::int AS qty
      FROM order_items oi JOIN paid ON paid.id = oi.order_id
      WHERE oi.product_id IS NOT NULL
      GROUP BY oi.product_id
    )
    UPDATE products p SET stock = GREATEST(p.stock - taken.qty, 0)
    FROM taken WHERE p.id = taken.product_id`, [orderId, email, name, address]);
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
    if (!Number.isInteger(id) || token !== demoToken(id)) return { status: 'unknown' };
    await markPaid(id, { name: 'Test customer' });
  } else {
    return { status: 'unknown' };
  }

  const order = await db.one('SELECT id, status, total_cents, email, demo FROM orders WHERE id = $1', [id]);
  if (!order) return { status: 'unknown' };
  const items = await db.query('SELECT name, size, unit_price_cents, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [id]);
  return { ...order, items };
}

async function webhook(rawBody, signature) {
  if (!stripe || !config.stripeWebhookSecret) throw new Error('Webhooks are not set up.');
  const event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    return handlePaidSession(event.data.object);
  }
  return null;
}

module.exports = { demoMode, startCheckout, confirm, webhook };
