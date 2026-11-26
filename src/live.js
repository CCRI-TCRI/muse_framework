// Live selling.
// The admin's browser sends video straight to each viewer over WebRTC. This
// file only passes the connection setup messages back and forth, runs the
// chat and keeps track of which product is pinned on screen.
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const auth = require('./auth');
const db = require('./db');

const MAX_VIEWERS = 60; // each viewer is a separate upload from the seller's connection

const state = {
  broadcaster: null,
  title: '',
  startedAt: null,
  pinnedId: null,
  viewers: new Map(),
  chat: [],
};

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function toViewers(msg) {
  for (const v of state.viewers.values()) send(v, msg);
}

function pinnedProduct() {
  if (!state.pinnedId) return null;
  const p = db.prepare('SELECT id, name, price_cents, image, color, sizes, stock FROM products WHERE id = ? AND active = 1').get(state.pinnedId);
  if (!p) return null;
  return { ...p, sizes: p.sizes.split(',').filter(Boolean), in_stock: p.stock > 0, stock: undefined };
}

function status() {
  return {
    live: !!state.broadcaster,
    title: state.title,
    startedAt: state.startedAt,
    viewers: state.viewers.size,
    pinned: state.broadcaster ? pinnedProduct() : null,
  };
}

function updateCounts() {
  const n = state.viewers.size;
  send(state.broadcaster, { type: 'count', viewers: n });
  toViewers({ type: 'count', viewers: n });
}

function addChat(from, text, isSeller = false) {
  const msg = { type: 'chat', from: String(from).slice(0, 30), text: String(text).slice(0, 300), seller: isSeller, at: Date.now() };
  state.chat.push(msg);
  if (state.chat.length > 60) state.chat.shift();
  send(state.broadcaster, msg);
  toViewers(msg);
}

function endStream() {
  state.broadcaster = null;
  state.title = '';
  state.startedAt = null;
  state.pinnedId = null;
  state.chat = [];
  toViewers({ type: 'ended' });
}

function parse(data) {
  try { return JSON.parse(data); } catch { return null; }
}

function handleBroadcaster(ws) {
  if (state.broadcaster) {
    // Opening the studio in a second tab takes over from the first one.
    const old = state.broadcaster;
    state.broadcaster = null;
    send(old, { type: 'replaced' });
    old.close();
  }
  state.broadcaster = ws;

  ws.on('message', (data) => {
    const msg = parse(data);
    if (!msg) return;
    switch (msg.type) {
      case 'start':
        state.title = String(msg.title || 'Live now').slice(0, 100);
        state.startedAt = Date.now();
        toViewers({ type: 'status', ...status() });
        break;
      case 'signal': {
        const viewer = state.viewers.get(msg.to);
        send(viewer, { type: 'signal', data: msg.data });
        break;
      }
      case 'pin':
        state.pinnedId = Number(msg.productId) || null;
        toViewers({ type: 'pin', product: pinnedProduct() });
        break;
      case 'chat':
        if (msg.text) addChat('Seller', msg.text, true);
        break;
      case 'stop':
        ws.close();
        break;
    }
  });

  ws.on('close', () => {
    if (state.broadcaster === ws) endStream();
  });

  send(ws, { type: 'hello', viewers: state.viewers.size });
}

function handleViewer(ws) {
  if (state.viewers.size >= MAX_VIEWERS) {
    send(ws, { type: 'full' });
    return ws.close();
  }
  const id = crypto.randomUUID();
  state.viewers.set(id, ws);
  let lastChat = 0;

  send(ws, { type: 'status', ...status() });
  for (const m of state.chat) send(ws, m);
  updateCounts();

  ws.on('message', (data) => {
    const msg = parse(data);
    if (!msg) return;
    switch (msg.type) {
      case 'ready': // viewer wants the video
        if (state.broadcaster && state.startedAt) send(state.broadcaster, { type: 'viewer-ready', id });
        break;
      case 'signal':
        send(state.broadcaster, { type: 'signal', from: id, data: msg.data });
        break;
      case 'chat': {
        const now = Date.now();
        if (!state.broadcaster || now - lastChat < 800) return;
        const text = String(msg.text || '').trim();
        if (!text) return;
        lastChat = now;
        addChat(String(msg.name || '').trim() || 'Guest', text);
        break;
      }
    }
  });

  ws.on('close', () => {
    state.viewers.delete(id);
    send(state.broadcaster, { type: 'viewer-left', id });
    updateCounts();
  });
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/live-ws') return socket.destroy();
    const wantsBroadcast = url.searchParams.get('role') === 'seller';
    if (wantsBroadcast && !auth.isAdminRequest(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (wantsBroadcast) handleBroadcaster(ws);
      else handleViewer(ws);
    });
  });

  // Drop dead connections so the viewer count stays honest.
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });
  wss.on('close', () => clearInterval(timer));
}

module.exports = { attach, status };
