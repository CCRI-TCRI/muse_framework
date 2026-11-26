// The "Go live" tab. Video goes straight from this device to each viewer over
// WebRTC; the server just passes the setup messages and chat along.
document.addEventListener('admin:ready', async () => {
  const $ = (id) => document.getElementById(id);
  const { api, esc } = Store;
  const cfg = await Store.config();
  const preview = $('preview');
  const peers = new Map(); // viewer id -> RTCPeerConnection
  let stream = null;
  let session = null;
  let lastChat = 0;
  let timer = null;
  let recorder = null;
  let chunks = [];

  function err(msg) {
    $('studio-error').textContent = msg || '';
    $('studio-error').classList.toggle('hidden', !msg);
  }

  /* ----- camera ----- */
  async function openCamera(deviceId) {
    err('');
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }), width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      // Swap tracks for anyone already watching so nobody drops off.
      for (const pc of peers.values()) {
        for (const sender of pc.getSenders()) {
          const track = next.getTracks().find((t) => t.kind === sender.track?.kind);
          if (track) sender.replaceTrack(track);
        }
      }
      stream?.getTracks().forEach((t) => t.stop());
      stream = next;
      preview.srcObject = stream;
      $('studio-idle').classList.add('hidden');
      $('go-live').disabled = !!session;
      $('cam-on').classList.add('hidden');
      $('mic-toggle').classList.remove('hidden');
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
      $('cam-select').classList.toggle('hidden', cams.length < 2);
      $('cam-select').innerHTML = cams.map((c, i) => `<option value="${esc(c.deviceId)}" ${c.deviceId === current ? 'selected' : ''}>${esc(c.label || `Camera ${i + 1}`)}</option>`).join('');
    } catch (e) {
      err(e.name === 'NotAllowedError'
        ? 'The browser blocked the camera. Allow camera and microphone for this site, then try again.'
        : `Couldn't open the camera: ${e.message}`);
    }
  }

  $('cam-on').addEventListener('click', () => openCamera());
  $('cam-select').addEventListener('change', (e) => openCamera(e.target.value));
  $('mic-toggle').addEventListener('click', () => {
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $('mic-toggle').textContent = track.enabled ? 'Mute mic' : 'Unmute mic';
  });
  if (!navigator.mediaDevices?.getUserMedia) {
    err('This browser cannot use the camera here. Use a recent Chrome, Safari or Firefox on an https address.');
    $('cam-on').disabled = true;
  }

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

  function addChat(m) {
    const log = $('studio-log');
    if (!log.querySelector('[data-msg]')) log.innerHTML = '';
    const row = document.createElement('div');
    row.dataset.msg = '';
    if (m.seller) row.className = 'seller';
    row.innerHTML = `<b>${esc(m.name)}</b>${esc(m.text)}`;
    log.append(row);
    log.scrollTop = log.scrollHeight;
  }

  async function tick() {
    if (!session) return;
    try {
      const r = await api(`/admin/live/poll?${new URLSearchParams({ session, after: lastChat })}`);
      if (r.ended) { err('This stream was ended from another tab or device.'); wrapUp(); return; }
      $('studio-count').textContent = `${r.viewers} watching`;
      for (const m of r.chat) { addChat(m); lastChat = Math.max(lastChat, m.id); }
      for (const s of r.signals) {
        if (s.type === 'join') offerTo(s.from).catch((e) => console.warn(e));
        else if (s.data?.sdp?.type === 'answer') peers.get(s.from)?.setRemoteDescription(s.data.sdp).catch((e) => console.warn(e));
      }
    } catch (e) {
      console.warn(e.message);
    }
    timer = setTimeout(tick, 1000);
  }

  /* ----- going live ----- */
  $('go-live').addEventListener('click', async () => {
    if (!stream) return;
    err('');
    $('go-live').disabled = true;
    try {
      ({ session } = await api('/admin/live/start', { method: 'POST', body: { title: $('stream-title').value.trim() } }));
      lastChat = 0;
      if ($('pin-select').value) await api('/admin/live/pin', { method: 'POST', body: { productId: $('pin-select').value } });
    } catch (e) {
      err(`Couldn't start the stream: ${e.message}`);
      $('go-live').disabled = false;
      return;
    }
    $('studio-badge').classList.remove('hidden');
    $('end-live').classList.remove('hidden');
    $('go-live').classList.add('hidden');
    $('stream-title').disabled = true;
    $('studio-log').innerHTML = '<div class="small" style="opacity:.55">You are live. Messages from viewers show up here.</div>';
    startRecording();
    tick();
  });

  $('end-live').addEventListener('click', async () => {
    if (!confirm('End the stream for everyone?')) return;
    await api('/admin/live/stop', { method: 'POST' }).catch(() => {});
    wrapUp();
  });

  $('pin-select').addEventListener('change', (e) => {
    if (session) api('/admin/live/pin', { method: 'POST', body: { productId: e.target.value } }).catch((x) => err(x.message));
  });

  $('studio-chat').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('studio-text').value.trim();
    if (!text || !session) return;
    $('studio-text').value = '';
    await api('/admin/live/chat', { method: 'POST', body: { session, text } }).catch((x) => err(x.message));
  });

  function wrapUp() {
    session = null;
    clearTimeout(timer);
    for (const pc of peers.values()) pc.close();
    peers.clear();
    $('studio-badge').classList.add('hidden');
    $('end-live').classList.add('hidden');
    $('go-live').classList.remove('hidden');
    $('go-live').disabled = !stream;
    $('stream-title').disabled = false;
    stopRecording();
  }

  /* ----- replay ----- */
  function startRecording() {
    chunks = [];
    recorder = null;
    if (!$('record').checked || typeof MediaRecorder === 'undefined') return;
    const type = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    try {
      recorder = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 2_500_000 } : undefined);
    } catch { return; }
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.start(5000);
  }

  function stopRecording() {
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
        await Admin.addFilm({ file, title: `Replay: ${title}`, description: `Recorded live on ${new Date().toLocaleDateString()}` }, $('replay-progress'));
        addChat({ name: 'Studio', text: 'Replay saved to Films.', seller: true });
      } catch (e) {
        err(`The replay didn't save: ${e.message}`);
      }
    };
    rec.stop();
    recorder = null;
  }

  addEventListener('beforeunload', (e) => { if (session) { e.preventDefault(); e.returnValue = ''; } });
});
