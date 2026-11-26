// Postgres everywhere. On Vercel (or anywhere DATABASE_URL is set) it talks to a
// real Postgres server such as Neon. Without one it runs PGlite, a copy of
// Postgres that lives in the data/ folder, so local development needs no setup.
const fs = require('node:fs');
const config = require('./config');

let backend;

function connect() {
  if (backend) return backend;
  if (config.databaseUrl) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: config.databaseUrl, max: 3, idleTimeoutMillis: 10000 });
    pool.on('error', (err) => console.error('Database connection error:', err.message));
    backend = { query: (sql, params) => pool.query(sql, params) };
  } else {
    if (config.onVercel) throw new Error('No database connected. Add a Postgres database (e.g. Neon) to the Vercel project.');
    const { PGlite } = require('@electric-sql/pglite');
    fs.mkdirSync(config.dataDir, { recursive: true });
    const lite = new PGlite(`${config.dataDir}/pg`);
    backend = { query: (sql, params) => lite.query(sql, params) };
  }
  return backend;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS products (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    details     TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'Other',
    price_cents INTEGER NOT NULL,
    sizes       TEXT NOT NULL DEFAULT '',
    stock       INTEGER NOT NULL DEFAULT 0,
    images      JSONB NOT NULL DEFAULT '[]',
    color       TEXT NOT NULL DEFAULT '#e7e2da',
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_cents INTEGER;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS colours TEXT NOT NULL DEFAULT '';

  CREATE TABLE IF NOT EXISTS videos (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    file        TEXT NOT NULL,
    product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                SERIAL PRIMARY KEY,
    status            TEXT NOT NULL DEFAULT 'pending',
    email             TEXT,
    customer_name     TEXT,
    shipping_address  TEXT,
    total_cents       INTEGER NOT NULL,
    stripe_session_id TEXT,
    demo              BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at           TIMESTAMPTZ
  );
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone TEXT;
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;

  CREATE TABLE IF NOT EXISTS order_items (
    id               SERIAL PRIMARY KEY,
    order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id       INTEGER,
    name             TEXT NOT NULL,
    size             TEXT,
    unit_price_cents INTEGER NOT NULL,
    quantity         INTEGER NOT NULL
  );
  ALTER TABLE order_items ADD COLUMN IF NOT EXISTS colour TEXT;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS live_state (
    id         INTEGER PRIMARY KEY DEFAULT 1,
    session    TEXT,
    title      TEXT,
    started_at TIMESTAMPTZ,
    heartbeat  TIMESTAMPTZ,
    pinned_id  INTEGER
  );
  INSERT INTO live_state (id) VALUES (1) ON CONFLICT DO NOTHING;

  CREATE TABLE IF NOT EXISTS live_viewers (
    id        TEXT PRIMARY KEY,
    session   TEXT NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS live_signals (
    id         SERIAL PRIMARY KEY,
    session    TEXT NOT NULL,
    to_id      TEXT NOT NULL,
    from_id    TEXT NOT NULL,
    payload    JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS live_signals_to ON live_signals (to_id);

  CREATE TABLE IF NOT EXISTS live_chat (
    id         SERIAL PRIMARY KEY,
    session    TEXT NOT NULL,
    viewer_id  TEXT,
    name       TEXT NOT NULL,
    text       TEXT NOT NULL,
    seller     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

// Starter pieces so the shop isn't empty the first time. Delete or edit them in the admin.
const STARTERS = [
  ['The Long Wool Coat', 'Outerwear', 45000000, 'XS,S,M,L,XL', 12, '#c49a6c',
    'A floor-skimming coat cut from double-faced Italian wool. Dropped shoulders, a wide notch lapel and deep side pockets. Unlined, so it drapes rather than stands.',
    '80% virgin wool, 20% cashmere\nUnlined, hand-finished seams\nDry clean only\nMade in Portugal'],
  ['Cashmere Crew Knit', 'Knitwear', 32000000, 'XS,S,M,L,XL', 20, '#efe4d2',
    'Twelve-gauge Mongolian cashmere knitted to a relaxed, slightly boxy shape. Ribbed collar, cuffs and hem. Soft from the first wear.',
    '100% grade-A cashmere\nHand wash cold, dry flat\nMade in Scotland'],
  ['Pleated Wide-Leg Trouser', 'Trousers', 25000000, '24,26,28,30,32,34', 18, '#3b3834',
    'High rise with a deep double pleat and a full leg that breaks softly over the shoe. The wool blend holds a crease and sheds wrinkles.',
    '70% wool, 28% polyester, 2% elastane\nSide adjusters, no belt loops\nDry clean\nMade in Italy'],
  ['Silk Slip Dress', 'Dresses', 38000000, 'XS,S,M,L', 9, '#2e3a63',
    'Bias-cut sandwashed silk with fine adjustable straps. Falls to mid-calf. Wear it alone in summer or over a knit when it cools down.',
    '100% mulberry silk, 22 momme\nCool hand wash or dry clean\nMade in Portugal'],
  ['Heavyweight Boxy Tee', 'Tops', 6500000, 'XS,S,M,L,XL', 40, '#fafafa',
    'Dense 300gsm cotton jersey, garment dyed so every piece is slightly different. Cropped and boxy with a narrow ribbed neck.',
    '100% organic cotton\nMachine wash cold, hang dry\nMade in Portugal'],
  ['Relaxed Linen Shirt', 'Tops', 15000000, 'XS,S,M,L,XL', 22, '#c9d9ee',
    'Washed Irish linen in an easy, slightly oversized fit. Mother-of-pearl buttons and a soft camp collar.',
    '100% linen\nMachine wash cold\nMade in Lithuania'],
  ['Leather Day Tote', 'Accessories', 28000000, '', 7, '#9b6a43',
    'Vegetable-tanned leather that darkens and softens with use. Big enough for a laptop, with an inner zip pocket and raw painted edges.',
    'Full-grain vegetable-tanned leather\n40 x 32 x 12 cm\nMade in Spain'],
  ['Ribbed Merino Beanie', 'Accessories', 4500000, '', 30, '#c0553a',
    'Chunky rib in extra-fine merino. Fold the cuff or wear it slouched.',
    '100% extra-fine merino wool\nHand wash cold\nMade in Ireland'],
];

const DEFAULT_SETTINGS = {
  announcement: 'Free delivery in Kampala on orders over UGX 300,000',
  whatsapp_numbers: '0744 315492, 0795567578',
  splash_title: 'Your Everyday *Shopping* _Companion!_',
  splash_media: '',
  hero_kicker: 'New season just landed',
  hero_title: 'Your everyday *wardrobe* _edit_',
  hero_text: 'Natural fibres, small runs and cuts that last for years. Every new piece is tried on live before it goes on sale.',
  hero_media: '',
  hero_media_type: '',
  shipping_info: 'We deliver across Kampala within one to two days, and upcountry by courier. Pay by Mobile Money or cash on delivery once we confirm your order on WhatsApp. Exchanges within 7 days if the item is unworn with tags on.',
  about: 'A small studio making considered everyday clothes from natural fibres, in limited runs.',
  instagram: '',
};

// Shops created with the first version (dollar prices, earthy colours, card
// payments) are moved over once: untouched starter pieces get shilling prices
// and the brighter colours, untouched homepage text gets the new wording, and
// test orders from the old card checkout are removed.
const UPGRADE_V2 = [
  // name, old price, new price, old colours, new colour
  ['The Long Wool Coat', 42000, 45000000, ['#cfc6b8', '#c49a6c'], '#c49a6c'],
  ['Cashmere Crew Knit', 29000, 32000000, ['#e4dccf', '#efe4d2'], '#efe4d2'],
  ['Pleated Wide-Leg Trouser', 24000, 25000000, ['#3b3834'], '#3b3834'],
  ['Silk Slip Dress', 31000, 38000000, ['#b9a48a', '#2e3a63'], '#2e3a63'],
  ['Heavyweight Boxy Tee', 8500, 6500000, ['#efebe4', '#fafafa'], '#fafafa'],
  ['Relaxed Linen Shirt', 18000, 15000000, ['#d7d9d2', '#c9d9ee'], '#c9d9ee'],
  ['Leather Day Tote', 36000, 28000000, ['#7a5a43', '#9b6a43'], '#9b6a43'],
  ['Ribbed Merino Beanie', 9500, 4500000, ['#8c8f86', '#c0553a'], '#c0553a'],
];
const OLD_TEXT = {
  announcement: ['Complimentary shipping on orders over $250 · Free returns within 30 days'],
  hero_kicker: ['Autumn / Winter'],
  hero_title: ['Quiet clothes, made slowly'],
  shipping_info: ['Orders ship within two working days, tracked and insured. Free returns within 30 days of delivery, as long as items are unworn with their tags on.'],
};

async function upgradeV2(db) {
  const done = await db.query(`SELECT 1 FROM settings WHERE key = 'upgraded_v2'`);
  if (done.rows.length) return;
  for (const [name, oldPrice, newPrice, oldColours, colour] of UPGRADE_V2) {
    await db.query(`UPDATE products SET price_cents = $2, compare_cents = NULL WHERE name = $1 AND price_cents = $3`, [name, newPrice, oldPrice]);
    await db.query(`UPDATE products SET color = $2 WHERE name = $1 AND color = ANY($3::text[])`, [name, colour, oldColours]);
  }
  for (const [key, olds] of Object.entries(OLD_TEXT)) {
    await db.query('UPDATE settings SET value = $2 WHERE key = $1 AND value = ANY($3::text[])', [key, DEFAULT_SETTINGS[key], olds]);
  }
  await db.query('DELETE FROM orders WHERE demo');
  await db.query(`INSERT INTO settings (key, value) VALUES ('upgraded_v2', '1') ON CONFLICT DO NOTHING`);
}

let ready;
function init() {
  if (!ready) {
    ready = (async () => {
      const db = connect();
      for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
      const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM products');
      if (rows[0].n === 0) {
        // Inserted in reverse so the first starter shows first (newest first).
        for (const [name, category, price, sizes, stock, color, description, details] of [...STARTERS].reverse()) {
          await db.query(`INSERT INTO products (name, category, price_cents, sizes, stock, color, description, details)
                          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [name, category, price, sizes, stock, color, description, details]);
        }
      }
      const fresh = rows[0].n === 0;
      if (!fresh) await upgradeV2(db);
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', [key, value]);
      }
      if (fresh) await db.query(`INSERT INTO settings (key, value) VALUES ('upgraded_v2', '1') ON CONFLICT DO NOTHING`);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

async function query(sql, params = []) {
  await init();
  const res = await connect().query(sql, params);
  return res.rows;
}

async function one(sql, params) {
  return (await query(sql, params))[0] || null;
}

async function getSettings() {
  const rows = await query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.filter((r) => r.key in DEFAULT_SETTINGS).map((r) => [r.key, r.value]));
}

module.exports = { query, one, init, getSettings, SETTING_KEYS: Object.keys(DEFAULT_SETTINGS) };
