// Live studio: a full-screen camera with controls floating on top, like a live
// streaming app. Video goes straight from this device to each viewer over
// WebRTC; the server only passes the setup messages and chat along.
document.addEventListener('admin:ready', async () => {
  const $ = (id) => document.getElementById(id);
  const { api, esc, money, art } = Store;
  const cfg = await Store.config();
  const preview = $('preview');
  const peers = new Map(); // viewer id -> RTCPeerConnection
  let stream = null;       // what viewers receive (camera video + microphone)
  let facing = 'user';     // front camera first, like selfie mode
  let session = null;
  let lastChat = 0;
  let pollTimer = null;
  let clockTimer = null;
  let startedAt = 0;
  let recorder = null;
  let chunks = [];
  let canvasLoop = null;
  let pinnedId = '';

  /* ----- small icons for the round buttons ----- */
  const ic = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = {
    chat: ic('<path d="M4 5h16v11H9l-5 4z"/>'),
    flip: ic('<path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2"/><path d="M20 4v4h-4M4 20v-4h4"/>'),
    mic: ic('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
    micOff: ic('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18"/>'),
    tag: ic('<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>'),
    stop: ic('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    eye: ic('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  };
  $('sf-chat-btn').innerHTML = ICON.chat;
  $('sf-flip-btn').innerHTML = ICON.flip;
  $('mic-toggle').innerHTML = ICON.mic;
  $('sf-pick-btn').innerHTML = ICON.tag;
  $('end-live').innerHTML = ICON.stop;

  function err(msg) {
    $('studio-error').textContent = msg || '';
    $('studio-error').classList.toggle('hidden', !msg);
  }

  /* ----- opening and leaving the studio ----- */
  document.addEventListener('admin:tab', (e) => {
    if (e.detail === 'studio') {
      document.body.classList.add('studio-open');
      if (!stream) openCamera();
    }
  });

  $('studio-close').addEventListener('click', () => {
    if (session && !confirm('End the stream and leave the studio?')) return;
    if (session) endStream();
    stopCamera();
    leaveFullscreen();
    document.body.classList.remove('studio-open');
    document.querySelector('#tabs [data-tab="overview"]').click();
  });

  function goFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
  function leaveFullscreen() {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }

  /* ----- camera ----- */
  async function openCamera() {
    err('');
    if (!navigator.mediaDevices?.getUserMedia) {
      err('This browser cannot use the camera here. Use a recent Chrome or Safari on the https address.');
      return;
    }
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream = cam;
      preview.srcObject = stream;
      preview.classList.toggle('mirror', facing === 'user');
      $('studio-idle').classList.add('hidden');
      $('go-live').disabled = !!session;
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      $('sf-flip-btn').classList.toggle('hidden', cams.length < 2);
    } catch (e) {
      $('studio-idle').classList.remove('hidden');
      err(e.name === 'NotAllowedError'
        ? 'The camera is blocked. Tap the lock icon by the address, allow Camera and Microphone, then tap "Turn camera on".'
        : `Couldn't open the camera: ${e.message}`);
    }
  }

  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    preview.srcObject = null;
    $('studio-idle').classList.remove('hidden');
    $('go-live').disabled = true;
  }

  // Swap between front and back camera. Only the picture changes: the
  // microphone keeps running and viewers stay connected.
  async function flipCamera() {
    if (!stream) return;
    const want = facing === 'user' ? 'environment' : 'user';
    try {
      const v = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: want }, width: { ideal: 1280 }, height: { ideal: 720 } } })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: want } }));
      const newTrack = v.getVideoTracks()[0];
      const oldTrack = stream.getVideoTracks()[0];
      for (const pc of peers.values()) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(newTrack);
      }
      stream.removeTrack(oldTrack);
      stream.addTrack(newTrack);
      oldTrack.stop();
      facing = want;
      preview.srcObject = stream;
      preview.classList.toggle('mirror', facing === 'user');
    } catch (e) {
      err(`Couldn't switch camera: ${e.message}`);
    }
  }
  $('sf-flip-btn').addEventListener('click', flipCamera);
  $('cam-on').addEventListener('click', openCamera);

  $('mic-toggle').addEventListener('click', () => {
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $('mic-toggle').innerHTML = track.enabled ? ICON.mic : ICON.micOff;
    $('mic-toggle').classList.toggle('off', !track.enabled);
    $('mic-toggle').setAttribute('aria-label', track.enabled ? 'Mute microphone' : 'Unmute microphone');
  });

  /* ----- the piece viewers can buy ----- */
  function openPicker() {
    const list = (Admin.products || []).filter((p) => p.active);
    $('sf-sheet-list').innerHTML = `
      <button type="button" class="sf-pick ${pinnedId ? '' : 'on'}" data-pin=""><span class="sf-pick-pic none">&times;</span><span><b>Nothing for now</b><small>Viewers just watch</small></span></button>
      ${list.map((p) => `
        <button type="button" class="sf-pick ${String(p.id) === String(pinnedId) ? 'on' : ''}" data-pin="${p.id}">
          <span class="sf-pick-pic">${art(p)}</span>
          <span><b>${esc(p.name)}</b><small>${money(p.price_cents)} · ${p.stock} in stock</small></span>
        </button>`).join('')}`;
    $('sf-sheet').classList.add('open');
    $('sf-sheet-scrim').classList.remove('hidden');
  }
  function closePicker() {
    $('sf-sheet').classList.remove('open');
    $('sf-sheet-scrim').classList.add('hidden');
  }
  function setPinned(id) {
    pinnedId = id;
    $('pin-select').value = id;
    const p = (Admin.products || []).find((x) => String(x.id) === String(id));
    $('sf-pick-name').textContent = p ? p.name : 'None';
    $('sf-pinned').classList.toggle('hidden', !p);
    if (p) $('sf-pinned').innerHTML = `<span class="sf-pinned-pic">${art(p)}</span><span><small>Selling now</small><b>${esc(p.name)}</b><small>${money(p.price_cents)}</small></span>`;
    if (session) api('/admin/live/pin', { method: 'POST', body: { productId: id } }).catch((x) => err(x.message));
  }
  $('sf-pick-open').addEventListener('click', openPicker);
  $('sf-pick-btn').addEventListener('click', openPicker);
  $('sf-pinned').addEventListener('click', openPicker);
  $('sf-sheet-close').addEventListener('click', closePicker);
  $('sf-sheet-scrim').addEventListener('click', closePicker);
  $('sf-sheet-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pin]');
    if (!b) return;
    setPinned(b.dataset.pin);
    closePicker();
  });

  /* ----- chat ----- */
  function addChat(m) {
    const log = $('studio-log');
    const row = document.createElement('div');
    if (m.seller) row.className = 'seller';
    row.innerHTML = m.name ? `<b>${esc(m.name)}</b> ${esc(m.text)}` : esc(m.text);
    log.append(row);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  $('sf-chat-btn').addEventListener('click', () => {
    const f = $('studio-chat');
    f.classList.toggle('hidden');
    if (!f.classList.contains('hidden')) $('studio-text').focus();
  });
  $('studio-chat').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('studio-text').value.trim();
    if (!text || !session) return;
    $('studio-text').value = '';
    await api('/admin/live/chat', { method: 'POST', body: { session, text } }).catch((x) => err(x.message));
  });

  /* ----- viewers ----- */
  function gathered(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', done); resolve(); } };
      pc.addEventListener('icegatheringstatechange', done);
      setTimeout(resolve, 2500);
    });
  }

  async function offerTo(viewerId) {
    peers.get(viewerId)?.close();
    const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
    peers.set(viewerId, pc);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    // Cap quality per viewer so one upload connection can feed more people.
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      params.encodings[0].maxBitrate = 1_200_000;
      sender.setParameters(params).catch(() => {});
    }
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && peers.get(viewerId) === pc) {
        setTimeout(() => { if (pc.connectionState !== 'connected') { pc.close(); peers.delete(viewerId); } }, 5000);
      }
    };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    await api('/admin/live/signal', { method: 'POST', body: { session, to: viewerId, data: { sdp: pc.localDescription } } });
  }

  async function tick() {
    if (!session) return;
    try {
      const r = await api(`/admin/live/poll?${new URLSearchParams({ session, after: lastChat })}`);
      if (r.ended) { err('This stream was ended from another tab or device.'); wrapUp(); return; }
      $('studio-count').innerHTML = `${ICON.eye}<span>${r.viewers}</span>`;
      for (const m of r.chat) { addChat(m); lastChat = Math.max(lastChat, m.id); }
      for (const s of r.signals) {
        if (s.type === 'join') offerTo(s.from).catch((e) => console.warn(e));
        else if (s.data?.sdp?.type === 'answer') peers.get(s.from)?.setRemoteDescription(s.data.sdp).catch((e) => console.warn(e));
      }
    } catch (e) {
      console.warn(e.message);
    }
    pollTimer = setTimeout(tick, 1000);
  }

  function clock() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const t = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    $('studio-badge').innerHTML = `<i class="sf-dot"></i>LIVE · ${t}`;
  }

  /* ----- going live ----- */
  $('go-live').addEventListener('click', async () => {
    if (!stream) return;
    err('');
    $('go-live').disabled = true;
    $('go-live').textContent = 'Starting...';
    goFullscreen();
    try {
      ({ session } = await api('/admin/live/start', { method: 'POST', body: { title: $('stream-title').value.trim() } }));
      lastChat = 0;
      if (pinnedId) await api('/admin/live/pin', { method: 'POST', body: { productId: pinnedId } });
    } catch (e) {
      err(`Couldn't start the stream: ${e.message}`);
      $('go-live').disabled = false;
      $('go-live').textContent = 'Go live';
      return;
    }
    document.body.classList.add('studio-live');
    $('sf-setup').classList.add('hidden');
    $('sf-live').classList.remove('hidden');
    $('studio-log').innerHTML = '';
    addChat({ text: 'You are live. Messages from viewers appear here.' });
    $('studio-count').innerHTML = `${ICON.eye}<span>0</span>`;
    startedAt = Date.now();
    clock();
    clockTimer = setInterval(clock, 1000);
    startRecording();
    tick();
  });

  async function endStream() {
    await api('/admin/live/stop', { method: 'POST' }).catch(() => {});
    wrapUp();
  }
  $('end-live').addEventListener('click', () => {
    if (!confirm('End the stream for everyone?')) return;
    endStream();
  });

  function wrapUp() {
    session = null;
    clearTimeout(pollTimer);
    clearInterval(clockTimer);
    for (const pc of peers.values()) pc.close();
    peers.clear();
    document.body.classList.remove('studio-live');
    $('studio-badge').textContent = 'Preview';
    $('studio-count').textContent = '0';
    $('sf-live').classList.add('hidden');
    $('studio-chat').classList.add('hidden');
    $('sf-setup').classList.remove('hidden');
    $('go-live').textContent = 'Go live';
    $('go-live').disabled = !stream;
    stopRecording();
  }

  /* ----- replay -----
     The replay records a copy of the picture drawn onto a canvas, plus the
     microphone. That way flipping the camera mid-stream doesn't cut it off. */
  function startRecording() {
    chunks = [];
    recorder = null;
    if (!$('record').checked || typeof MediaRecorder === 'undefined') return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const draw = () => {
      const w = preview.videoWidth, h = preview.videoHeight;
      if (w && h) {
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        ctx.drawImage(preview, 0, 0, w, h);
      }
      canvasLoop = requestAnimationFrame(draw);
    };
    draw();
    const recStream = canvas.captureStream(30);
    const mic = stream.getAudioTracks()[0];
    if (mic) recStream.addTrack(mic);
    const type = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    try {
      recorder = new MediaRecorder(recStream, type ? { mimeType: type, videoBitsPerSecond: 2_500_000 } : undefined);
    } catch { cancelAnimationFrame(canvasLoop); return; }
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.start(5000);
  }

  function stopRecording() {
    cancelAnimationFrame(canvasLoop);
    if (!recorder || recorder.state === 'inactive') return;
    const title = $('stream-title').value.trim() || 'Live session';
    const rec = recorder;
    rec.onstop = async () => {
      const type = rec.mimeType.split(';')[0] || 'video/webm';
      const blob = new Blob(chunks, { type });
      chunks = [];
      if (blob.size < 50_000) return;
      const file = new File([blob], `replay-${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
      try {
        $('replay-progress').classList.remove('hidden');
        await Admin.addFilm({ file, title: `Replay: ${title}`, description: `Recorded live on ${new Date().toLocaleDateString()}` }, $('replay-progress'));
        err('Replay saved to Films.');
        setTimeout(() => err(''), 5000);
      } catch (e) {
        err(`The replay didn't save: ${e.message}`);
      }
    };
    rec.stop();
    recorder = null;
  }

  addEventListener('beforeunload', (e) => { if (session) { e.preventDefault(); e.returnValue = ''; } });
});
