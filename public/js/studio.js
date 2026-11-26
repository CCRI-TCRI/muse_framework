// The "Go live" tab. Your camera goes straight to each viewer's browser over WebRTC.
document.addEventListener('admin:ready', async () => {
  const $ = (id) => document.getElementById(id);
  const cfg = await Store.config();
  const preview = $('preview');
  const peers = new Map(); // viewer id -> RTCPeerConnection
  let stream = null, ws = null, isLive = false, recorder = null, chunks = [];

  function err(msg) {
    $('studio-error').textContent = msg;
    $('studio-error').classList.toggle('hidden', !msg);
  }

  /* ----- camera ----- */
  async function openCamera(deviceId) {
    err('');
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
                        : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      // Swap the tracks for anyone already watching so they don't drop off.
      for (const pc of peers.values()) {
        for (const sender of pc.getSenders()) {
          const track = next.getTracks().find((t) => t.kind === sender.track?.kind);
          if (track) sender.replaceTrack(track);
        }
      }
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = next;
      preview.srcObject = stream;
      $('studio-idle').classList.add('hidden');
      $('go-live').disabled = isLive;
      $('cam-on').classList.add('hidden');
      $('mic-toggle').classList.remove('hidden');
      await listCameras();
    } catch (e) {
      err(e.name === 'NotAllowedError'
        ? 'The browser blocked the camera. Allow camera and microphone access for this site and try again.'
        : `Couldn't open the camera: ${e.message}`);
    }
  }

  async function listCameras() {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = $('cam-select');
    sel.classList.toggle('hidden', cams.length < 2);
    const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
    sel.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}" ${c.deviceId === current ? 'selected' : ''}>${Store.esc(c.label || `Camera ${i + 1}`)}</option>`).join('');
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
    err('This browser cannot use the camera here. Use a recent Chrome, Safari or Firefox, and make sure the site is on https.');
    $('cam-on').disabled = true;
  }

  /* ----- connections to viewers ----- */
  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  async function addViewer(id) {
    peers.get(id)?.close();
    const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
    peers.set(id, pc);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    // Cap video quality per viewer so one upload can feed more people.
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      params.encodings[0].maxBitrate = 1_200_000;
      sender.setParameters(params).catch(() => {});
    }

    pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'signal', to: id, data: { candidate: e.candidate } }); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) { pc.close(); peers.delete(id); }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: 'signal', to: id, data: { sdp: pc.localDescription } });
  }

  async function onSignal(from, data) {
    const pc = peers.get(from);
    if (!pc) return;
    if (data.sdp) await pc.setRemoteDescription(data.sdp);
    else if (data.candidate) { try { await pc.addIceCandidate(data.candidate); } catch {} }
  }

  function addChat(m) {
    const log = $('studio-log');
    if (log.querySelector('.muted')) log.innerHTML = '';
    const row = document.createElement('div');
    if (m.seller) row.className = 'seller';
    row.innerHTML = `<b>${Store.esc(m.from)}</b>${Store.esc(m.text)}`;
    log.append(row);
    log.scrollTop = log.scrollHeight;
  }

  /* ----- going live ----- */
  $('go-live').addEventListener('click', () => {
    if (!stream) return;
    err('');
    $('go-live').disabled = true;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live-ws?role=seller`);

    ws.onopen = () => {
      send({ type: 'start', title: $('stream-title').value.trim() || 'Live now' });
      if ($('pin-select').value) send({ type: 'pin', productId: $('pin-select').value });
      isLive = true;
      $('studio-badge').classList.remove('hidden');
      $('studio-count').classList.remove('hidden');
      $('end-live').classList.remove('hidden');
      $('go-live').classList.add('hidden');
      $('stream-title').disabled = true;
      $('studio-log').innerHTML = '<div class="muted small">You are live. Viewer messages show up here.</div>';
      startRecording();
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case 'viewer-ready': addViewer(msg.id); break;
        case 'viewer-left': peers.get(msg.id)?.close(); peers.delete(msg.id); break;
        case 'signal': onSignal(msg.from, msg.data); break;
        case 'count': case 'hello': $('studio-count').textContent = `${msg.viewers} watching`; break;
        case 'chat': addChat(msg); break;
        case 'replaced': err('The stream was taken over by another tab or device.'); break;
      }
    };

    ws.onclose = (e) => {
      if (isLive) wrapUp();
      else {
        err(e.code === 1006 ? 'Could not start the stream. Try logging out and in again.' : '');
        $('go-live').disabled = false;
      }
    };
  });

  $('end-live').addEventListener('click', () => {
    if (!confirm('End the stream for everyone?')) return;
    send({ type: 'stop' });
    ws.close();
  });

  $('pin-select').addEventListener('change', (e) => send({ type: 'pin', productId: e.target.value }));

  $('studio-chat').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('studio-text').value.trim();
    if (!text || !isLive) return;
    send({ type: 'chat', text });
    $('studio-text').value = '';
  });

  function wrapUp() {
    isLive = false;
    for (const pc of peers.values()) pc.close();
    peers.clear();
    $('studio-badge').classList.add('hidden');
    $('studio-count').classList.add('hidden');
    $('end-live').classList.add('hidden');
    $('go-live').classList.remove('hidden');
    $('go-live').disabled = !stream;
    $('stream-title').disabled = false;
    stopRecording();
  }

  /* ----- replay recording ----- */
  function startRecording() {
    chunks = [];
    if (!$('record').checked || typeof MediaRecorder === 'undefined') return;
    const type = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported(t));
    try {
      recorder = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 2_500_000 } : undefined);
    } catch { recorder = null; return; }
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.start(5000);
  }

  function stopRecording() {
    if (!recorder || recorder.state === 'inactive') return;
    const title = $('stream-title').value.trim() || 'Live stream';
    recorder.onstop = async () => {
      const type = recorder.mimeType.split(';')[0] || 'video/webm';
      const blob = new Blob(chunks, { type });
      recorder = null;
      chunks = [];
      if (blob.size < 50_000) return;
      const fd = new FormData();
      fd.append('video', new File([blob], `replay.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type }));
      fd.append('title', `Replay: ${title}`);
      fd.append('description', `Recorded live on ${new Date().toLocaleDateString()}`);
      try {
        await Admin.uploadVideo(fd, $('replay-progress'));
        addChat({ from: 'Studio', text: 'Replay saved to Videos.', seller: true });
      } catch (e) {
        err(`The replay didn't save: ${e.message}`);
      }
    };
    recorder.stop();
  }

  window.addEventListener('beforeunload', (e) => {
    if (isLive) { e.preventDefault(); e.returnValue = ''; }
  });
});
