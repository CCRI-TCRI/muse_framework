// Orders. Customers place an order on the site, then confirm it and arrange
// payment (for example Mobile Money) with the shop on WhatsApp. The shop marks
// it paid in the admin, which is when stock goes down.
const db = require('./db');
const { sign } = require('./auth');

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

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

const orderToken = (id) => sign(`order-${id}`);

async function place(body) {
  const name = clean(body.name, 80);
  const phone = clean(body.phone, 30);
  const address = clean(body.address, 300);
  const notes = clean(body.notes, 500);
  if (!name) throw new Error('Please add your name.');
  if ((phone.match(/\d/g) || []).length < 9) throw new Error('Please add a phone number we can reach you on.');
  if (!address) throw new Error('Please tell us where to deliver.');

  const lines = await priceCart(body.items);
  const total = lines.reduce((sum, l) => sum + l.product.price_cents * l.qty, 0);
  const order = await db.one(`INSERT INTO orders (total_cents, customer_name, phone, shipping_address, notes)
                              VALUES ($1, $2, $3, $4, $5) RETURNING id`, [total, name, phone, address, notes || null]);
  for (const l of lines) {
    await db.query(`INSERT INTO order_items (order_id, product_id, name, size, unit_price_cents, quantity)
                    VALUES ($1, $2, $3, $4, $5, $6)`, [order.id, l.product.id, l.product.name, l.size || null, l.product.price_cents, l.qty]);
  }
  return { id: order.id, token: orderToken(order.id) };
}

async function summary(id, token) {
  id = Number(id);
  if (!Number.isInteger(id) || token !== orderToken(id)) return null;
  const order = await db.one(`SELECT id, status, total_cents, customer_name, phone, shipping_address, notes, created_at
                              FROM orders WHERE id = $1`, [id]);
  if (!order) return null;
  const items = await db.query('SELECT name, size, unit_price_cents, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [id]);
  return { ...order, items };
}

// Marks an order paid and takes its items out of stock, in one statement so it
// can't half-happen. Doing it twice does nothing the second time.
async function markPaid(id) {
  const rows = await db.query(`
    WITH paid AS (
      UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1 AND status = 'pending' RETURNING id
    ), taken AS (
      SELECT oi.product_id, SUM(oi.quantity)::int AS qty
      FROM order_items oi JOIN paid ON paid.id = oi.order_id
      WHERE oi.product_id IS NOT NULL GROUP BY oi.product_id
    ), stock AS (
      UPDATE products p SET stock = GREATEST(p.stock - taken.qty, 0) FROM taken WHERE p.id = taken.product_id RETURNING p.id
    )
    SELECT id FROM paid`, [id]);
  return rows.length > 0;
}

async function setStatus(id, status) {
  id = Number(id);
  if (status === 'paid') {
    if (await markPaid(id)) return true;
    throw new Error('Only new orders can be marked paid.');
  }
  const allowed = { shipped: ['paid'], cancelled: ['pending', 'paid'] };
  if (!allowed[status]) throw new Error('Unknown status.');
  const r = await db.one(`UPDATE orders SET status = $1 WHERE id = $2 AND status = ANY($3::text[]) RETURNING id`, [status, id, allowed[status]]);
  if (!r) throw new Error(status === 'shipped' ? 'Mark the order paid before delivering it.' : 'That order can no longer be cancelled.');
  return true;
}

module.exports = { place, summary, setStatus };
