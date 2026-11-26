// Liquid glass tab bar.
// The bar is see-through glass that bends the light from whatever is behind
// it, with a slight colour split at the edges like real glass. The selected tab
// is a glass lens you can drag along the bar; it magnifies the icons under it
// and snaps to the nearest tab when you let go.
//
// The bending uses an SVG displacement map as a backdrop filter. Chrome and
// most Android browsers support that; elsewhere (Safari, Firefox) the bar falls
// back to frosted glass and the lens still magnifies.
(() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  // Only Chromium-based browsers (Chrome, Edge, Samsung Internet, most Android
  // browsers) can bend the backdrop with an SVG filter. Chrome on iPhone is
  // Safari underneath, so it's left out.
  const ua = navigator.userAgent;
  const chromium = (navigator.userAgentData && navigator.userAgentData.brands.some((b) => /Chromium/.test(b.brand)))
    || (/Chrome\/|Chromium\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua));
  const canRefract = chromium && CSS.supports('backdrop-filter', 'blur(1px)');

  // Builds a displacement map for a rounded rectangle: pixels near the rim are
  // pulled inwards, strongest right at the edge, like light through a curved lens.
  // magnify > 1 also pulls the middle inwards, so whatever is under the glass
  // looks enlarged, like a drop of water.
  function displacementMap(w, h, radius, depth, magnify = 1, scale = 1) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const r = Math.min(radius, w / 2, h / 2);
    const cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - cx, py = y + 0.5 - cy;
        const qx = Math.abs(px) - (w / 2 - r), qy = Math.abs(py) - (h / 2 - r);
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
        const dist = outside + Math.min(Math.max(qx, qy), 0) - r; // negative inside
        const inside = -dist;
        let nx, ny;
        if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py); }
        else if (qx > qy) { nx = Math.sign(px); ny = 0; }
        else { nx = 0; ny = Math.sign(py); }
        const t = Math.max(0, Math.min(1, 1 - inside / depth));
        const bend = t * t * (3 - 2 * t);
        // zoom part, in pixels, turned into the same -1..1 range as the rim bend
        const zx = magnify > 1 ? (px * (1 / magnify - 1)) / (scale / 2) : 0;
        const zy = magnify > 1 ? (py * (1 / magnify - 1)) / (scale / 2) : 0;
        const dx = Math.max(-1, Math.min(1, -nx * bend + zx));
        const dy = Math.max(-1, Math.min(1, -ny * bend + zy));
        const i = (y * w + x) * 4;
        img.data[i] = 128 + dx * 127;
        img.data[i + 1] = 128 + dy * 127;
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  // One filter per element: three displacements at slightly different strengths,
  // one per colour channel, blended back together. That gives the rainbow fringe.
  function makeFilter(id) {
    const f = document.createElementNS(SVGNS, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '100%'); f.setAttribute('height', '100%');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.innerHTML = `
      <feImage result="map" preserveAspectRatio="none" x="0" y="0"/>
      <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" result="dr"/>
      <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
      <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" result="dg"/>
      <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
      <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" result="db"/>
      <feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
      <feBlend in="r" in2="g" mode="screen" result="rg"/>
      <feBlend in="rg" in2="b" mode="screen"/>`;
    return f;
  }

  function updateFilter(filter, el, depth, strength, magnify = 1) {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const key = `${w}x${h}`;
    if (filter.dataset.key === key) return;
    filter.dataset.key = key;
    const img = filter.querySelector('feImage');
    img.setAttribute('width', w); img.setAttribute('height', h);
    img.setAttribute('href', displacementMap(w, h, Math.min(w, h) / 2, depth, magnify, strength));
    const maps = filter.querySelectorAll('feDisplacementMap');
    [1, 0.9, 0.8].forEach((k, i) => maps[i].setAttribute('scale', String(strength * k)));
  }

  function init() {
    const bar = document.getElementById('tabbar');
    if (!bar || bar.dataset.ready) return;
    bar.dataset.ready = '1';
    const tabs = [...bar.querySelectorAll('a[data-tab]')];
    const lens = bar.querySelector('.lens');
    const track = lens.querySelector('.lens-track');
    // The lens floats over the bar instead of sitting inside it: glass inside
    // glass can't see the page behind it, so it has to be a separate layer.
    document.body.append(lens);
    track.innerHTML = tabs.map((t) => `<span class="lens-item">${t.innerHTML}</span>`).join('');

    if (canRefract) {
      document.documentElement.classList.add('refract');
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.position = 'absolute';
      const fBar = makeFilter('lg-bar'), fLens = makeFilter('lg-lens');
      svg.append(fBar, fLens);
      document.body.append(svg);
      const refresh = () => { updateFilter(fBar, bar, 22, 46); updateFilter(fLens, lens, 11, 16, 1.16); };
      refresh();
      new ResizeObserver(refresh).observe(bar);
      new ResizeObserver(refresh).observe(lens);
    }

    // Stop the browser treating a swipe across the menu as dragging a link.
    tabs.forEach((t) => { t.draggable = false; });

    let current = tabs.findIndex((t) => t.classList.contains('on'));
    if (current < 0) { current = 0; lens.classList.add('idle'); }
    const slot = () => bar.clientWidth / tabs.length;
    const pad = 6;

    // Puts the lens centred on x (in bar coordinates) and keeps the magnified
    // copy of the icons lined up with the real ones underneath.
    function place(x, stretch = 0) {
      const w = slot() - pad * 2;
      const min = pad + w / 2, max = bar.clientWidth - pad - w / 2;
      x = Math.max(min, Math.min(max, x));
      const left = x - w / 2;
      const r = bar.getBoundingClientRect();
      lens.style.left = `${r.left}px`;
      lens.style.top = `${r.top + (r.height - lens.offsetHeight) / 2}px`;
      lens.style.width = `${w}px`;
      lens.style.transform = `translateX(${left}px) scale(${1 + stretch}, ${1 - stretch * 0.45})`;
      track.style.width = `${bar.clientWidth}px`;
      track.style.transform = `translateX(${-left}px) scale(var(--zoom, 1.14))`;
      track.style.transformOrigin = `${x}px 50%`;
      return x;
    }
    const centreOf = (i) => slot() * i + slot() / 2;

    lens.classList.add('no-anim');
    place(centreOf(current));
    requestAnimationFrame(() => lens.classList.remove('no-anim'));
    addEventListener('resize', () => place(centreOf(current)));

    let drag = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      e.preventDefault();
      lens.classList.remove('idle');
      const rect = bar.getBoundingClientRect();
      drag = { id: e.pointerId, x0: e.clientX, x: e.clientX - rect.left, moved: 0, last: e.clientX, t: performance.now(), rect };
      bar.setPointerCapture(e.pointerId);
      bar.classList.add('dragging');
      lens.classList.add('dragging');
      place(drag.x, 0.08);
    });
    bar.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const now = performance.now();
      const v = (e.clientX - drag.last) / Math.max(1, now - drag.t);
      drag.last = e.clientX; drag.t = now;
      drag.moved = Math.max(drag.moved, Math.abs(e.clientX - drag.x0));
      drag.x = e.clientX - drag.rect.left;
      place(drag.x, Math.min(0.28, 0.08 + Math.abs(v) * 0.12));
    });
    const release = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const i = Math.max(0, Math.min(tabs.length - 1, Math.floor(drag.x / slot())));
      drag = null;
      bar.classList.remove('dragging');
      lens.classList.remove('dragging');
      place(centreOf(i));
      if (i !== current) {
        current = i;
        tabs.forEach((t, k) => t.classList.toggle('on', k === i));
        setTimeout(() => { location.href = tabs[i].href; }, 260);
      }
    };
    bar.addEventListener('pointerup', release);
    bar.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) { drag = null; bar.classList.remove('dragging'); lens.classList.remove('dragging'); place(centreOf(current)); } });
    // Taps and drags are handled above; keyboard users still get normal links.
    tabs.forEach((t) => t.addEventListener('click', (e) => { if (e.detail !== 0) e.preventDefault(); }));
  }

  window.Glass = { init };
})();
