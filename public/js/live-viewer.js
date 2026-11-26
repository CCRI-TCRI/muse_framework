// Live page for shoppers. Checks in with the server every second or two,
// picks up chat, the pinned piece, and the seller's video connection.
(async () => {
  const { api, esc, money, art } = Store;
  const cfg = await Store.chrome('live');
  const $ = (id) => document.getElementById(id);
  const video = $('video');

  let session = null;      // which stream we're watching
  let viewerId = null;     // our seat in that stream
  let lastChat = 0;
  let pc = null;
  let pinnedId = null;
  let joinedAt = 0;
  let wasLive = false;

  try { $('name').value = localStorage.getItem('store-chat-name') || ''; } catch {}

  // Waits until the browser has found its network routes, so the whole answer
  // goes in one message instead of many small ones.
  function gathered(conn) {
    if (conn.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { if (conn.iceGatheringState === 'complete') { conn.removeEventListener('icegatheringstatechange', done); resolve(); } };
      conn.addEventListener('icegatheringstatechange', done);
      setTimeout(resolve, 2500);
    });
  }

  function dropVideo() {
    if (pc) { pc.close(); pc = null; }
    video.srcObject = null;
    video.classList.add('hidden');
    $('unmute').classList.add('hidden');
  }

  async function join() {
    dropVideo();
    viewerId = null;
    const r = await api('/live/join', { method: 'POST' });
    if (r.full) { $('idle').innerHTML = '<div class="eyebrow">Full house</div><h2>So many of you</h2><p class="small">The stream is full right now. Try again in a few minutes.</p>'; return; }
    viewerId = r.viewerId || null;
    joinedAt = Date.now();
  }

  async function answer(offer) {
    dropVideo();
    pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
    const conn = pc;
    pc.ontrack = (e) => {
      video.srcObject = e.streams[0];
      video.classList.remove('hidden');
      video.play().catch(() => {});
      if (video.muted) $('unmute').classList.remove('hidden');
    };
    pc.onconnectionstatechange = () => {
      if (conn.connectionState === 'failed') join().catch(() => {});
    };
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    await api('/live/signal', { method: 'POST', body: { viewer: viewerId, data: { sdp: pc.localDescription } } });
  }

  function showPinned(p) {
    const box = $('pinned');
    if (!p) { pinnedId = null; box.classList.add('hidden'); return; }
    if (p.id === pinnedId) return;
    pinnedId = p.id;
    box.classList.remove('hidden');
    box.innerHTML = `
      <a class="frame" href="/product?id=${p.id}" target="_blank">${art(p)}</a>
      <div>
        <div class="eyebrow" style="font-size:9px">Wearing now</div>
        <div class="name">${esc(p.name)}</div>
        <div class="small muted">${money(p.price_cents)}</div>
        ${p.in_stock ? `<div class="row">
          ${p.sizes.length > 1 ? `<select id="pin-size" aria-label="Size"><option value="">Size</option>${p.sizes.map((s) => `<option>${esc(s)}</option>`).join('')}</select>` : ''}
          <button class="btn" id="pin-add">Add to bag</button>
        </div><div class="small" id="pin-note" style="margin-top:6px"></div>` : '<div class="small" style="margin-top:6px">Sold out</div>'}
      </div>`;
    $('pin-add')?.addEventListener('click', () => {
      const size = p.sizes.length > 1 ? $('pin-size').value : (p.sizes[0] || '');
      if (p.sizes.length > 1 && !size) { $('pin-note').textContent = 'Choose a size'; return; }
      Store.addToBag(p, size);
      $('pin-note').innerHTML = 'Added. <button class="text-btn" data-open="bag">View bag</button>';
    });
  }

  function addChat(m) {
    const log = $('log');
    if (!log.querySelector('[data-msg]')) log.innerHTML = '';
    const row = document.createElement('div');
    row.dataset.msg = '';
    if (m.seller) row.className = 'seller';
    row.innerHTML = m.name ? `<b>${esc(m.name)}</b>${esc(m.text)}` : `<span style="opacity:.6">${esc(m.text)}</span>`;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.append(row);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  function setLive(st) {
    $('idle').classList.toggle('hidden', st.live);
    $('badge').classList.toggle('hidden', !st.live);
    if (st.live) {
      $('count').textContent = `${st.viewers} watching`;
      $('title').textContent = st.title;
      $('sub').innerHTML = '<span class="live-dot"></span>On air now';
      showPinned(st.pinned);
    } else {
      $('sub').textContent = 'Live shopping';
      $('title').textContent = 'Watch, ask, and buy as we try things on';
      showPinned(null);
    }
  }

  async function tick() {
    let delay = 6000;
    try {
      const r = await api(`/live/poll?${new URLSearchParams({ viewer: viewerId || '', after: lastChat })}`);
      const st = r.status;
      setLive(st);
      if (!st.live) {
        if (wasLive) addChat({ text: 'The stream has ended. Thank you for watching.' });
        wasLive = false; session = null; viewerId = null;
        dropVideo();
      } else {
        wasLive = true;
        if (st.session !== session) { session = st.session; lastChat = 0; $('log').innerHTML = ''; await join(); }
        else if (r.rejoin || (viewerId && !video.srcObject && Date.now() - joinedAt > 15000)) await join();
        for (const m of r.chat) { addChat(m); lastChat = Math.max(lastChat, m.id); }
        for (const s of r.signals) if (s.data?.sdp?.type === 'offer') await answer(s.data.sdp);
        delay = video.srcObject ? 1500 : 700;
      }
    } catch (err) {
      console.warn(err.message);
    }
    setTimeout(tick, document.hidden && !wasLive ? 15000 : delay);
  }

  $('unmute').addEventListener('click', () => {
    video.muted = false;
    video.play().catch(() => {});
    $('unmute').classList.add('hidden');
  });

  $('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('text').value.trim();
    if (!text) return;
    if (!viewerId) { addChat({ text: 'Chat opens when we go live.' }); return; }
    try { localStorage.setItem('store-chat-name', $('name').value.trim()); } catch {}
    $('text').value = '';
    try {
      await api('/live/chat', { method: 'POST', body: { viewer: viewerId, name: $('name').value.trim(), text } });
    } catch (err) {
      addChat({ text: err.message });
      $('text').value = text;
    }
  });

  tick();
})();
