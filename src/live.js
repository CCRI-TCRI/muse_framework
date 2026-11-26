// Live selling.
// Video goes straight from the seller's browser to each viewer over WebRTC.
// The server only passes the connection setup messages along, runs the chat and
// remembers which product is pinned. Everything goes through the database and
// short polling, because Vercel can't keep WebSocket connections open.
const crypto = require('node:crypto');
const db = require('./db');

const SELLER = 'seller';
const HEARTBEAT_SECONDS = 45; // stream counts as ended if the seller goes quiet this long
const VIEWER_SECONDS = 15;
const MAX_VIEWERS = 60; // every viewer is a separate upload from the seller's connection

async function state() {
  return db.one(`SELECT *, (started_at IS NOT NULL AND heartbeat > now() - interval '${HEARTBEAT_SECONDS} seconds') AS live
                 FROM live_state WHERE id = 1`);
}

async function viewerCount(session) {
  const r = await db.one(`SELECT COUNT(*)::int AS n FROM live_viewers
                          WHERE session = $1 AND last_seen > now() - interval '${VIEWER_SECONDS} seconds'`, [session]);
  return r.n;
}

async function pinnedProduct(id) {
  if (!id) return null;
  const p = await db.one('SELECT id, name, price_cents, images, color, category, sizes, stock FROM products WHERE id = $1 AND active', [id]);
  if (!p) return null;
  const { stock, ...rest } = p;
  return { ...rest, sizes: p.sizes.split(',').map((s) => s.trim()).filter(Boolean), in_stock: stock > 0 };
}

async function status() {
  const s = await state();
  if (!s.live) return { live: false };
  return {
    live: true, session: s.session, title: s.title, startedAt: s.started_at,
    viewers: await viewerCount(s.session), pinned: await pinnedProduct(s.pinned_id),
  };
}

async function newChat(session, after) {
  return db.query(`SELECT id, name, text, seller FROM live_chat WHERE session = $1 AND id > $2 ORDER BY id LIMIT 100`,
    [session, Number(after) || 0]);
}

// Hands over (and deletes) the setup messages waiting for someone.
async function takeSignals(session, toId) {
  return db.query(`DELETE FROM live_signals WHERE session = $1 AND to_id = $2 RETURNING from_id, payload`, [session, toId]);
}

async function sendSignal(session, from, to, payload) {
  await db.query('INSERT INTO live_signals (session, to_id, from_id, payload) VALUES ($1, $2, $3, $4)',
    [session, to, from, JSON.stringify(payload)]);
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

/* ----- viewers ----- */

async function join() {
  const s = await state();
  if (!s.live) return { live: false };
  if (await viewerCount(s.session) >= MAX_VIEWERS) return { full: true };
  const id = crypto.randomUUID();
  await db.query('INSERT INTO live_viewers (id, session) VALUES ($1, $2)', [id, s.session]);
  await sendSignal(s.session, id, SELLER, { type: 'join' });
  return { viewerId: id };
}

async function viewerPoll(viewerId, after) {
  const st = await status();
  if (!st.live) return { status: st, chat: [], signals: [] };
  const known = viewerId
    ? await db.one('UPDATE live_viewers SET last_seen = now() WHERE id = $1 AND session = $2 RETURNING id', [viewerId, st.session])
    : null;
  return {
    status: st,
    chat: await newChat(st.session, after),
    signals: known ? (await takeSignals(st.session, viewerId)).map((s) => s.payload) : [],
    rejoin: !!viewerId && !known,
  };
}

async function viewerSignal(viewerId, data) {
  const s = await state();
  const v = s.live && await db.one('SELECT id FROM live_viewers WHERE id = $1 AND session = $2', [String(viewerId), s.session]);
  if (!v) throw new Error('The stream has ended.');
  await sendSignal(s.session, v.id, SELLER, { type: 'signal', data });
}

async function viewerChat(viewerId, name, text) {
  const s = await state();
  if (!s.live) throw new Error('Chat opens when the stream starts.');
  const v = await db.one('SELECT id FROM live_viewers WHERE id = $1 AND session = $2', [String(viewerId), s.session]);
  if (!v) throw new Error('Refresh the page to join the chat.');
  text = clean(text, 300);
  if (!text) return;
  const recent = await db.one(`SELECT 1 AS x FROM live_chat WHERE viewer_id = $1 AND created_at > now() - interval '1 second'`, [v.id]);
  if (recent) throw new Error('Slow down a little.');
  await db.query('INSERT INTO live_chat (session, viewer_id, name, text) VALUES ($1, $2, $3, $4)',
    [s.session, v.id, clean(name, 30) || 'Guest', text]);
}

/* ----- seller ----- */

async function start(title) {
  const session = crypto.randomUUID();
  await db.query('DELETE FROM live_signals');
  await db.query('DELETE FROM live_viewers');
  await db.query(`DELETE FROM live_chat WHERE created_at < now() - interval '1 day'`);
  await db.query(`UPDATE live_state SET session = $1, title = $2, started_at = now(), heartbeat = now(), pinned_id = NULL WHERE id = 1`,
    [session, clean(title, 100) || 'Live now']);
  return { session };
}

async function sellerPoll(session, after) {
  const s = await state();
  if (s.session !== session || !s.started_at) return { ended: true };
  await db.query('UPDATE live_state SET heartbeat = now() WHERE id = 1');
  return {
    viewers: await viewerCount(session),
    chat: await newChat(session, after),
    signals: (await takeSignals(session, SELLER)).map((r) => ({ from: r.from_id, ...r.payload })),
  };
}

async function sellerSignal(session, to, data) {
  await sendSignal(session, SELLER, String(to), { type: 'signal', data });
}

async function pin(productId) {
  await db.query('UPDATE live_state SET pinned_id = $1 WHERE id = 1', [Number(productId) || null]);
}

async function sellerChat(session, text) {
  text = clean(text, 300);
  if (text) await db.query('INSERT INTO live_chat (session, name, text, seller) VALUES ($1, $2, $3, TRUE)', [session, 'Studio', text]);
}

async function stop() {
  await db.query('UPDATE live_state SET started_at = NULL, pinned_id = NULL WHERE id = 1');
  await db.query('DELETE FROM live_signals');
}

module.exports = { status, join, viewerPoll, viewerSignal, viewerChat, start, sellerPoll, sellerSignal, pin, sellerChat, stop };
