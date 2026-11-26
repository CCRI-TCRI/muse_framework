(async () => {
  const cfg = await Store.chrome('live');
  const $ = (id) => document.getElementById(id);
  const video = $('video');
  let ws, pc, live = false, retryTimer;

  const nameInput = $('name');
  try { nameInput.value = localStorage.getItem('store-chat-name') || ''; } catch {}

  function setLive(status) {
    live = status.live && !!status.startedAt;
    $('idle').classList.toggle('hidden', live);
    $('badge').classList.toggle('hidden', !live);
    $('count').classList.toggle('hidden', !live);
    $('title').textContent = live ? status.title : '';
    if (live) {
      setCount(status.viewers);
      showPinned(status.pinned);
      if (!pc) requestStream();
    } else {
      stopVideo();
      showPinned(null);
    }
  }

  function setCount(n) {
    $('count').textContent = `${n} watching`;
  }

  function requestStream() {
    send({ type: 'ready' });
  }

  function stopVideo() {
    if (pc) { pc.close(); pc = null; }
    video.srcObject = null;
    video.classList.add('hidden');
    $('unmute').classList.add('hidden');
  }

  async function onSignal(data) {
    if (data.sdp && data.sdp.type === 'offer') {
      if (pc) pc.close();
      pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
      pc.ontrack = (e) => {
        video.srcObject = e.streams[0];
        video.classList.remove('hidden');
        video.play().catch(() => {});
        if (video.muted) $('unmute').classList.remove('hidden');
      };
      pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'signal', data: { candidate: e.candidate } }); };
      pc.onconnectionstatechange = () => {
        if (pc && pc.connectionState === 'failed') {
          stopVideo();
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => live && requestStream(), 2000);
        }
      };
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ type: 'signal', data: { sdp: pc.localDescription } });
    } else if (data.candidate && pc) {
      try { await pc.addIceCandidate(data.candidate); } catch {}
    }
  }

  function showPinned(p) {
    const box = $('pinned');
    if (!p) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="pic">${Store.picture(p)}</div>
      <div>
        <div style="font-weight:500">${Store.esc(p.name)}</div>
        <div class="small muted">${Store.money(p.price_cents)}</div>
        ${p.in_stock ? `<div class="actions">
          ${p.sizes.length > 1 ? `<select id="pin-size"><option value="">Size</option>${p.sizes.map((s) => `<option>${Store.esc(s)}</option>`).join('')}</select>` : ''}
          <button class="btn sm accent" id="pin-add">Add to bag</button>
        </div>
        <div class="small" id="pin-note"></div>` : '<div class="small">Sold out</div>'}
      </div>`;
    $('pin-add')?.addEventListener('click', () => {
      const size = p.sizes.length > 1 ? $('pin-size').value : (p.sizes[0] || '');
      if (p.sizes.length > 1 && !size) { $('pin-note').textContent = 'Pick a size'; return; }
      Store.addToBag(p, size);
      $('pin-note').innerHTML = 'Added! <a href="/cart.html" target="_blank">Open bag</a>';
    });
  }

  function addChat(m) {
    const log = $('log');
    if (log.querySelector('.muted')) log.innerHTML = '';
    const row = document.createElement('div');
    if (m.seller) row.className = 'seller';
    row.innerHTML = `<b>${Store.esc(m.from)}</b>${Store.esc(m.text)}`;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.append(row);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live-ws`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case 'status': setLive(msg); break;
        case 'count': setCount(msg.viewers); break;
        case 'signal': onSignal(msg.data); break;
        case 'pin': showPinned(msg.product); break;
        case 'chat': addChat(msg); break;
        case 'ended':
          setLive({ live: false });
          addChat({ from: '', text: 'The stream has ended. Thanks for watching!' });
          break;
        case 'full':
          $('idle').innerHTML = '<h2>The stream is full</h2><p>Lots of people are watching right now. Try again in a few minutes.</p>';
          break;
      }
    };
    ws.onclose = () => {
      stopVideo();
      setTimeout(connect, 3000);
    };
  }

  $('unmute').addEventListener('click', () => {
    video.muted = false;
    video.play().catch(() => {});
    $('unmute').classList.add('hidden');
  });

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('text').value.trim();
    if (!text) return;
    if (!live) { addChat({ from: '', text: 'Chat opens when the stream starts.' }); return; }
    try { localStorage.setItem('store-chat-name', nameInput.value.trim()); } catch {}
    send({ type: 'chat', name: nameInput.value.trim(), text });
    $('text').value = '';
  });

  connect();
})();
