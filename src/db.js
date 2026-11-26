const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'store.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'Other',
    price_cents INTEGER NOT NULL,
    sizes       TEXT NOT NULL DEFAULT '',
    stock       INTEGER NOT NULL DEFAULT 0,
    image       TEXT,
    color       TEXT NOT NULL DEFAULT '#d9cfc1',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS videos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    file        TEXT NOT NULL,
    product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    status            TEXT NOT NULL DEFAULT 'pending',
    email             TEXT,
    customer_name     TEXT,
    shipping_address  TEXT,
    total_cents       INTEGER NOT NULL,
    stripe_session_id TEXT,
    demo              INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at           TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id       INTEGER,
    name             TEXT NOT NULL,
    size             TEXT,
    unit_price_cents INTEGER NOT NULL,
    quantity         INTEGER NOT NULL
  );
`);

// A few starter pieces so the shop isn't empty the first time you open it.
// Delete or edit them from the admin area.
const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (count === 0) {
  const insert = db.prepare(`INSERT INTO products (name, description, category, price_cents, sizes, stock, color)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insert.run('Heavyweight Boxy Tee', 'Thick 280gsm cotton, dropped shoulders and a cropped boxy cut. Washes soft and keeps its shape.', 'Tops', 3800, 'S,M,L,XL', 40, '#e8e1d6');
  insert.run('Washed Denim Overshirt', 'Mid-blue denim, stone washed so it already feels worn in. Two chest pockets and horn buttons.', 'Outerwear', 8900, 'S,M,L,XL', 18, '#9fb3c8');
  insert.run('Pleated Wide Trousers', 'High rise, double pleat, a lot of leg. Wool blend that drapes well and does not crease easily.', 'Bottoms', 7400, '26,28,30,32,34', 22, '#3f3a36');
  insert.run('Ribbed Knit Beanie', 'Chunky rib knit in a merino blend. One size, folds up or wears slouchy.', 'Accessories', 2400, 'One size', 60, '#b5523b');
}

module.exports = db;
