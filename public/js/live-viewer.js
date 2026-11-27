// Live page for shoppers: the stream fills the screen with everything floating
// on top, like a live streaming app. It checks in with the server every second
// or two for chat, the piece being worn, and the seller's video connection.
(async () => {
  const { api, esc, money, art } = Store;
  const cfg = await Store.chrome('live');
  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const lv = $('lv');
  document.body.classList.add('live-page', 'no-bottom-nav');

  const ic = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  $('lv-send').innerHTML = ic('<path d="M4 12 20 4l-6 16-3-7z"/>');
  $('lv-bag').innerHTML = `${Store.icon('bag')}<span class="lv-count" data-bag-count></span>`;
  $('lv-share').innerHTML = ic('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>');
  $('lv-avatar').textContent = Store.initials(cfg.storeName);
  $('lt-store').textContent = cfg.storeName;
  Store.writeBag(Store.readBag()); // fill the bag count on the new button

  let session = null;      // which stream we're watching
  let viewerId = null;     // our seat in that stream
  let lastChat = 0;
  let pc = null;
  let pinned = null;
  let joinedAt = 0;
  let wasLive = false;
  let stopped = false;
  let timer = null;
  // Leaving the page inside the app: stop polling and drop the video.
  Store.onLeave(() => { stopped = true; clearTimeout(timer); dropVideo(); BuyCard.close(); });

  let myName = '';
  try { myName = localStorage.getItem('store-chat-name') || ''; } catch {}

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
    if (r.full) {
      $('idle').innerHTML = '<div class="lv-idle-eyebrow">Full house</div><h2>So many of you</h2><p>The stream is full right now. Try again in a few minutes.</p>';
      $('idle').classList.remove('hidden');
      return;
    }
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

  // The piece being worn. Tapping it brings up the buy card over the stream.
  function showPinned(p) {
    const box = $('pinned');
    if (!p) { pinned = null; box.classList.add('hidden'); return; }
    if (pinned && p.id === pinned.id && p.in_stock === pinned.in_stock) return;
    pinned = p;
    box.classList.remove('hidden');
    box.innerHTML = `
      <span class="lv-pinned-pic">${art(p)}</span>
      <span class="lv-pinned-text"><small>Wearing now</small><b>${esc(p.name)}</b><small>${money(p.price_cents)}</small></span>
      <span class="lv-pinned-btn">${p.in_stock ? 'Add to bag' : 'Sold out'}</span>`;
  }
  $('pinned').addEventListener('click', () => {
    if (pinned && pinned.in_stock) BuyCard.open({ ...pinned, colours: pinned.colours || [], images: pinned.images || [] });
  });

  function addChat(m) {
    const log = $('log');
    const row = document.createElement('div');
    if (m.seller) row.className = 'seller';
    if (!m.name) row.className = 'note';
    row.innerHTML = m.name ? `<b>${esc(m.name)}</b> ${esc(m.text)}` : esc(m.text);
    log.append(row);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  function setLive(st) {
    lv.classList.toggle('is-live', !!st.live);
    $('idle').classList.toggle('hidden', !!st.live);
    $('count').classList.toggle('hidden', !st.live);
    if (st.live) {
      $('count').innerHTML = `${ic('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}<span>${st.viewers}</span>`;
      $('lv-state').innerHTML = `<i class="lv-dot"></i>LIVE${st.title ? ` · ${esc(st.title)}` : ''}`;
      showPinned(st.pinned);
    } else {
      $('lv-state').textContent = 'Off air';
      showPinned(null);
    }
  }

  async function tick() {
    if (stopped) return;
    let delay = 6000;
    try {
      const r = await api(`/live/poll?${new URLSearchParams({ viewer: viewerId || '', after: lastChat })}`);
      const st = r.status;
      setLive(st);
      if (!st.live) {
        if (wasLive) {
          $('idle').querySelector('h2').textContent = 'Thanks for watching';
          $('idle').querySelector('p').textContent = 'The stream has ended. Everything we showed is in the shop, and the next session will start here by itself.';
          $('log').innerHTML = '';
        }
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
    if (!stopped) timer = setTimeout(tick, document.hidden && !wasLive ? 15000 : delay);
  }

  $('unmute').addEventListener('click', () => {
    video.muted = false;
    video.play().catch(() => {});
    $('unmute').classList.add('hidden');
  });

  // Chat: ask for a name once, then just type.
  $('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('text').value.trim();
    if (!myName) {
      const n = $('name').value.trim();
      if (!n) {
        $('lv-name-row').classList.remove('hidden');
        $('name').focus();
        if (!text) return;
        return;
      }
      myName = n;
      try { localStorage.setItem('store-chat-name', myName); } catch {}
      $('lv-name-row').classList.add('hidden');
    }
    if (!text) { $('text').focus(); return; }
    if (!viewerId) { addChat({ text: 'Chat opens when we go live.' }); return; }
    $('text').value = '';
    try {
      await api('/live/chat', { method: 'POST', body: { viewer: viewerId, name: myName, text } });
    } catch (err) {
      addChat({ text: err.message });
      $('text').value = text;
    }
  });
  $('text').addEventListener('focus', () => { if (!myName) $('lv-name-row').classList.remove('hidden'); });

  // Share the live with friends (WhatsApp and the like).
  $('lv-share').addEventListener('click', async () => {
    const url = `${location.origin}/live`;
    const text = `${cfg.storeName} is live, come and watch: `;
    if (navigator.share) {
      try { await navigator.share({ title: cfg.storeName, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text + url)}`, '_blank', 'noopener');
  });

  tick();
})();
