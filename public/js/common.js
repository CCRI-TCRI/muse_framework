// Shared bits used on every page: settings, money, product pictures, the bag,
// the header, footer and the slide-out drawers.
const Store = (() => {
  let cfgPromise = null;
  let productsPromise = null;
  let cfg = null;
  let livePromise = Promise.resolve({ live: false });

  async function api(path, opts = {}) {
    const isJson = opts.body && !(opts.body instanceof FormData);
    const res = await fetch('/api' + path, {
      credentials: 'same-origin',
      ...opts,
      headers: isJson ? { 'Content-Type': 'application/json', ...opts.headers } : opts.headers,
      body: isJson ? JSON.stringify(opts.body) : opts.body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  function config() {
    if (!cfgPromise) cfgPromise = api('/config').then((c) => (cfg = c));
    return cfgPromise;
  }

  function products() {
    if (!productsPromise) productsPromise = api('/products');
    return productsPromise;
  }

  // Prices are stored in hundredths, like cents. Shillings have no smaller
  // unit, so they always show as whole numbers: UGX 450,000.
  function money(cents) {
    const currency = ((cfg && cfg.currency) || 'ugx').toUpperCase();
    const whole = currency === 'UGX' || cents % 100 === 0;
    const locale = currency === 'UGX' ? 'en-UG' : undefined;
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })
      .format(cents / 100).replace(/\u00a0/g, ' ');
  }

  // A soft colour per product, so the shop isn't a wall of grey.
  const TINTS = ['var(--p-lav)', 'var(--p-peach)', 'var(--p-mint)', 'var(--p-sky)', 'var(--p-butter)', 'var(--p-rose)'];
  const tint = (id) => TINTS[Math.abs(Number(id) || 0) % TINTS.length];

  /* ----- WhatsApp ----- */
  // "0744 315492" becomes 256744315492 (Uganda), which is what wa.me and tel: links need.
  function intl(num) {
    let d = String(num).replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = '256' + d.slice(1);
    else if (d.length === 9) d = '256' + d;
    return d;
  }
  function shopNumbers() {
    return String((cfg && cfg.settings.whatsapp_numbers) || '').split(/[,;\n]+/).map((n) => n.trim()).filter((n) => n.replace(/\D/g, '').length >= 9);
  }
  const waLink = (num, text = '') => `https://wa.me/${intl(num)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  const telLink = (num) => `tel:+${intl(num)}`;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ----- product pictures ----- */

  // Line drawings shown until a product has real photos.
  const SKETCHES = {
    tee: '<path d="M74 40Q100 56 126 40L160 58 176 92 152 102 144 86V214H56V86L48 102 24 92 40 58Z"/><path d="M80 43Q100 60 120 43"/>',
    knit: '<path d="M72 38Q100 54 128 38L158 52Q170 60 172 80L182 196 162 200 148 96V210H52V96L38 200 18 196 28 80Q30 60 42 52Z"/><path d="M72 38Q100 64 128 38M52 196H148M64 196V210M76 196V210M88 196V210M100 196V210M112 196V210M124 196V210M136 196V210M20 184 40 188M160 188 180 184"/>',
    shirt: '<path d="M72 38Q100 50 128 38L158 52Q170 60 172 80L182 196 162 200 148 96V212H52V96L38 200 18 196 28 80Q30 60 42 52Z"/><path d="M72 38 86 60 100 46 114 60 128 38M100 46V212"/><circle cx="104" cy="80" r="1.6"/><circle cx="104" cy="110" r="1.6"/><circle cx="104" cy="140" r="1.6"/><circle cx="104" cy="170" r="1.6"/>',
    coat: '<path d="M78 28 100 42 122 28 150 42Q162 50 164 68L176 206 156 208 146 92 150 236H50L54 92 44 208 24 206 36 68Q38 50 50 42Z"/><path d="M78 28 84 62 100 112 116 62 122 28M84 62 95 69M116 62 105 69M100 112V236M60 172H80M120 172H140"/><circle cx="108" cy="134" r="2"/><circle cx="108" cy="164" r="2"/>',
    trousers: '<path d="M64 26H136L146 236H108L100 92 92 236H54Z"/><path d="M64 40H136M82 40 84 92M118 40 116 92"/>',
    dress: '<path d="M83 26 85 70M117 26 115 70"/><path d="M85 70Q100 82 115 70L124 112 152 232Q100 244 48 232L76 112Z"/><path d="M78 108Q100 118 122 108"/>',
    bag: '<path d="M46 100H154L164 222H36Z"/><path d="M74 100Q74 46 100 46 126 46 126 100M86 100Q86 62 100 62 114 62 114 100"/>',
    beanie: '<path d="M50 166Q50 72 100 72 150 72 150 166"/><path d="M44 166H156V202H44ZM58 166V202M72 166V202M86 166V202M100 166V202M114 166V202M128 166V202M142 166V202M76 166Q78 108 94 76M124 166Q122 108 106 76"/>',
    shoe: '<path d="M30 176Q30 140 50 134L96 124Q112 120 124 140L170 156Q184 162 184 178V194H30Z"/><path d="M30 182H184M96 124 102 150M110 128 116 150"/>',
    hanger: '<path d="M100 76Q100 58 112 58 124 58 120 70 117 78 100 86L28 134H172L100 86"/>',
  };

  function sketchFor(p) {
    const s = `${p.category} ${p.name}`.toLowerCase();
    const rules = [
      [/coat|jacket|outer|blazer|trench|parka/, 'coat'], [/dress|gown/, 'dress'],
      [/knit|sweater|jumper|cardigan|cashmere|hoodie|sweat/, 'knit'], [/shirt|blouse/, 'shirt'],
      [/trouser|pant|jean|bottom|short|skirt|denim/, 'trousers'], [/bag|tote|clutch|wallet/, 'bag'],
      [/beanie|hat|cap|scarf/, 'beanie'], [/shoe|boot|sneaker|loafer|trainer|sandal/, 'shoe'], [/tee|top|tank|vest|t-shirt/, 'tee'],
    ];
    const hit = rules.find(([re]) => re.test(s));
    return SKETCHES[hit ? hit[1] : 'hanger'];
  }

  function isDark(hex) {
    const n = parseInt(String(hex || '#e7e2da').slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
  }

  // Picture for a product: its photo, or a drawing of the garment in its colour.
  function art(p, { index = 0, hover = false } = {}) {
    const imgs = p.images || [];
    if (imgs[index]) {
      const alt = hover && imgs[index + 1] ? `<img class="alt" src="${esc(imgs[index + 1])}" alt="" loading="lazy">` : '';
      return `<div class="art"><img src="${esc(imgs[index])}" alt="${esc(p.name)}" loading="lazy">${alt}</div>`;
    }
    const fill = /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#e7e2da';
    const stroke = isDark(fill) ? 'rgba(255,255,255,.45)' : 'rgba(17,17,17,.55)';
    return `<div class="art"><div class="sketch">
      <svg viewBox="0 0 200 250" fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" role="img" aria-label="${esc(p.name)}">${sketchFor(p)}</svg>
    </div></div>`;
  }

  // "Muhoozi Martin Clothes" -> "MM"
  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((words[0] || 'M')[0] + (words[1] ? words[1][0] : '')).toUpperCase();
  }

  /* ----- small line icons ----- */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
    bag: '<path d="M5 8h14l-1.2 12.1a1 1 0 0 1-1 .9H7.2a1 1 0 0 1-1-.9z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    live: '<circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    film: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9.5 4.5 2.5-4.5 2.5z"/>',
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    box: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  };
  const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  // Headlines: *word* gets the black box, _word_ goes light italic.
  function headline(text) {
    return esc(text).replace(/\*([^*]+)\*/g, '<span class="hl">$1</span>').replace(/_([^_]+)_/g, '<span class="it">$1</span>');
  }

  /* ----- saved pieces (hearts) ----- */
  const SAVED = 'store-saved';
  function readSaved() {
    try { return JSON.parse(localStorage.getItem(SAVED)) || []; } catch { return []; }
  }
  function isSaved(id) { return readSaved().includes(id); }
  function toggleSaved(id) {
    const list = readSaved();
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    try { localStorage.setItem(SAVED, JSON.stringify(next)); } catch {}
    document.querySelectorAll(`[data-heart="${id}"]`).forEach((b) => b.classList.toggle('on', next.includes(id)));
    updateCounts();
    return next.includes(id);
  }
  function heartButton(id) {
    return `<button class="heart ${isSaved(id) ? 'on' : ''}" data-heart="${id}" aria-label="Save">${icon('heart')}</button>`;
  }

  function priceHtml(p) {
    return `${money(p.price_cents)}${p.compare_cents ? `<span class="was">${money(p.compare_cents)}</span>` : ''}`;
  }

  function card(p) {
    const off = p.compare_cents ? Math.round((1 - p.price_cents / p.compare_cents) * 100) : 0;
    const tag = !p.in_stock ? '<span class="tag">Sold out</span>'
      : off >= 5 ? `<span class="tag sale">${off}% off</span>`
      : p.low_stock ? `<span class="tag">Only ${p.low_stock} left</span>` : '';
    return `<div class="card reveal">
      <a class="frame" href="/product?id=${p.id}" style="--tint:${tint(p.id)}">${tag}${art(p, { hover: true })}<span class="shop-pill">${icon('bag')}Shop</span></a>
      ${heartButton(p.id)}
      <a class="meta" href="/product?id=${p.id}"><span class="name">${esc(p.name)}</span><span class="price">${priceHtml(p)}</span></a>
    </div>`;
  }

  /* ----- bag (kept in this browser) ----- */
  const KEY = 'store-bag';
  function readBag() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function writeBag(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
    updateCounts();
    renderDrawer();
  }
  function bagCount() { return readBag().reduce((n, i) => n + i.qty, 0); }
  function addToBag(p, size, qty = 1) {
    const items = readBag();
    const found = items.find((i) => i.id === p.id && i.size === size);
    if (found) found.qty = Math.min(found.qty + qty, 20);
    else items.push({ id: p.id, size, qty, name: p.name, price_cents: p.price_cents, images: (p.images || []).slice(0, 1), color: p.color, category: p.category });
    writeBag(items);
  }

  function bagLines(items) {
    return items.map((i, n) => `
      <div class="line">
        <a class="frame" href="/product?id=${i.id}" style="--tint:${tint(i.id)}">${art(i)}</a>
        <div>
          <div class="name">${esc(i.name)}</div>
          ${i.size ? `<div class="small muted">Size ${esc(i.size)}</div>` : ''}
          <div class="qty">
            <button data-n="${n}" data-d="-1" aria-label="One fewer">&minus;</button><span>${i.qty}</span><button data-n="${n}" data-d="1" aria-label="One more">+</button>
          </div>
        </div>
        <div style="text-align:right;display:grid;align-content:space-between">
          <span>${money(i.price_cents * i.qty)}</span>
          <button class="text-btn" data-remove="${n}">Remove</button>
        </div>
      </div>`).join('');
  }

  function bagClicks(e) {
    const items = readBag();
    const q = e.target.closest('[data-d]');
    const r = e.target.closest('[data-remove]');
    if (q) { const it = items[q.dataset.n]; it.qty = Math.max(1, Math.min(20, it.qty + Number(q.dataset.d))); }
    else if (r) items.splice(r.dataset.remove, 1);
    else return false;
    writeBag(items);
    return true;
  }

  const subtotal = (items) => items.reduce((s, i) => s + i.price_cents * i.qty, 0);

  function checkout() {
    location.href = '/checkout';
  }

  /* ----- orders placed on this phone ----- */
  function myOrders() {
    try { return JSON.parse(localStorage.getItem('store-orders')) || []; } catch { return []; }
  }
  function rememberOrder(id, token) {
    const list = myOrders().filter((o) => o.id !== id);
    list.unshift({ id, token });
    try { localStorage.setItem('store-orders', JSON.stringify(list.slice(0, 30))); } catch {}
  }

  /* ----- drawers ----- */
  function openDrawer(id) {
    document.getElementById(id)?.classList.add('open');
    document.querySelector('.scrim')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawers() {
    document.querySelectorAll('.drawer.open').forEach((d) => d.classList.remove('open'));
    document.querySelector('.scrim')?.classList.remove('open');
    document.body.style.overflow = '';
  }

  function renderDrawer() {
    const body = document.getElementById('bag-body');
    if (!body) return;
    const items = readBag();
    document.getElementById('bag-foot').classList.toggle('hidden', !items.length);
    body.innerHTML = items.length ? bagLines(items)
      : '<div class="empty" style="padding:60px 0"><p class="muted">Your bag is empty.</p><a class="u-link small" href="/shop">Continue shopping</a></div>';
    document.getElementById('bag-subtotal').textContent = money(subtotal(items));
  }

  /* ----- page chrome ----- */
  function updateCounts() {
    const bag = bagCount();
    const saved = readSaved().length;
    document.querySelectorAll('[data-bag-count]').forEach((el) => { el.textContent = bag || ''; });
    document.querySelectorAll('[data-saved-count]').forEach((el) => { el.textContent = saved || ''; });
  }

  async function chrome(active = '') {
    const c = await config();
    const s = c.settings;
    const name = esc(c.storeName);
    const initial = esc(initials(c.storeName));
    const q = new URLSearchParams(location.search).get('q') || '';
    const on = (k) => (active === k ? 'on' : '');
    let customer = '';
    try { customer = (JSON.parse(localStorage.getItem('store-details') || '{}').name || '').trim().split(/\s+/)[0]; } catch {}
    const avatar = esc(customer ? customer[0].toUpperCase() : initials(c.storeName));

    const top = document.createElement('div');
    top.innerHTML = `
      ${s.announcement ? `<div class="announce">${esc(s.announcement)}</div>` : ''}
      <header class="site-header">
        <div class="bar">
          <a class="brand" href="/">
            <span class="mark">${avatar}</span>
            <span class="name">${name}</span>
            <span class="hello"><b>${customer ? `Hello, ${esc(customer)}` : 'Hello there'}</b><span>${name}</span></span>
          </a>
          <nav class="nav">
            <a href="/" class="${on('home')}">Home</a>
            <a href="/shop" class="${on('shop')}">Shop</a>
            <a href="/videos" class="${on('videos')}">Films</a>
            <a href="/live" class="${on('live')}" data-live-link>Live</a>
          </nav>
          <form class="search" action="/shop" role="search">${icon('search')}<input name="q" placeholder="Search" value="${esc(q)}" aria-label="Search the shop"></form>
          <div class="actions">
            <div class="icon-group">
              <a href="/live" aria-label="Live sessions" data-live-bell>${icon('bell')}</a>
              <button data-open="bag" aria-label="Bag">${icon('bag')}<span class="count" data-bag-count></span></button>
            </div>
          </div>
        </div>
      </header>`;
    document.body.prepend(...top.children);

    const cats = [...new Set((await products().catch(() => [])).map((p) => p.category))];

    const extra = document.createElement('div');
    extra.innerHTML = `
      <div class="scrim"></div>
      <aside class="drawer" id="bag" aria-label="Shopping bag">
        <div class="drawer-head"><span class="eyebrow">My bag</span><button class="close" data-close aria-label="Close">Close</button></div>
        <div class="drawer-body" id="bag-body"></div>
        <div class="drawer-foot" id="bag-foot">
          <div class="totals big"><span>Subtotal</span><span id="bag-subtotal"></span></div>
          <div class="small muted">Delivery is confirmed with you on WhatsApp.</div>
          <div class="note err hidden" id="bag-error"></div>
          <button class="btn block" id="drawer-checkout">Checkout</button>
          <a class="btn ghost block" href="/cart">View bag</a>
        </div>
      </aside>
      <nav class="bottom-nav glass" id="tabbar" aria-label="Main">
        <a data-tab href="/" class="${on('home')}">${icon('home')}<span>Home</span></a>
        <a data-tab href="/shop" class="${on('shop')}">${icon('search')}<span>Search</span></a>
        <a data-tab href="/shop?saved=1" class="${on('saved')}">${icon('heart')}<span>Saved</span></a>
        <a data-tab href="/orders" class="${on('orders')}">${icon('user')}<span>Orders</span></a>
        <span class="lens" aria-hidden="true"><span class="lens-track"></span></span>
      </nav>`;
    document.body.append(...extra.children);

    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `
      <div class="wrap"><div class="foot-card">
        <div class="foot-grid">
          <div><a class="brand" href="/"><span class="mark">${initial}</span><span class="name" style="display:inline">${name}</span></a><p>${esc(s.about)}</p></div>
          <div><h4>Shop</h4><ul>
            <li><a href="/shop">All pieces</a></li>
            ${cats.slice(0, 6).map((cat) => `<li><a href="/shop?category=${encodeURIComponent(cat)}">${esc(cat)}</a></li>`).join('')}
          </ul></div>
          <div><h4>Studio</h4><ul>
            <li><a href="/videos">Films</a></li>
            <li><a href="/live">Live try-ons</a></li>
            <li><a href="/shop?saved=1">Saved pieces</a></li>
            <li><a href="/orders">My orders</a></li>
            ${s.instagram ? `<li><a href="${esc(s.instagram)}" target="_blank" rel="noopener">Instagram</a></li>` : ''}
          </ul></div>
          <div><h4>Delivery &amp; returns</h4><p>${esc(s.shipping_info)}</p></div>
        </div>
        <div class="foot-base"><span>&copy; ${new Date().getFullYear()} ${name}</span><span>Order on WhatsApp · Mobile Money or cash on delivery</span></div>
      </div></div>`;
    document.body.append(footer);

    document.addEventListener('click', (e) => {
      const heart = e.target.closest('[data-heart]');
      if (heart) { e.preventDefault(); toggleSaved(Number(heart.dataset.heart)); return; }
      const open = e.target.closest('[data-open]');
      if (open) { openDrawer(open.dataset.open); return; }
      if (e.target.closest('[data-close]') || e.target.classList.contains('scrim')) closeDrawers();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawers(); });
    document.getElementById('bag-body').addEventListener('click', bagClicks);
    document.getElementById('drawer-checkout').addEventListener('click', checkout);

    // The liquid glass menu (phones).
    const glass = document.createElement('script');
    glass.src = '/js/glass.js';
    glass.onload = () => window.Glass && window.Glass.init();
    document.body.append(glass);

    document.title = document.title ? `${document.title} · ${c.storeName}` : c.storeName;
    writeBag(readBag());

    livePromise = api('/live/status').catch(() => ({ live: false }));
    livePromise.then((st) => {
      if (!st.live) return;
      document.querySelectorAll('[data-live-link], [data-live-bell]').forEach((a) => a.insertAdjacentHTML('beforeend', '<span class="live-dot"></span>'));
    });

    return c;
  }

  // Search box + filter button used on phones (the header search hides there).
  function searchRow(value = '') {
    return `<div class="search-row">
      <form class="search" action="/shop" role="search">${icon('search')}<input name="q" placeholder="Search" value="${esc(value)}" aria-label="Search the shop"></form>
      <span class="divider"></span>
      <a class="icon-btn" href="/shop" aria-label="Browse and sort">${icon('sliders')}</a>
    </div>`;
  }

  // Fade things in as they scroll into view.
  let observer;
  function reveal(root = document) {
    if (!('IntersectionObserver' in window)) { root.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')); return; }
    observer = observer || new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); observer.unobserve(en.target); }
    }, { rootMargin: '0px 0px -40px 0px' });
    root.querySelectorAll('.reveal:not(.in)').forEach((el) => observer.observe(el));
  }

  const live = () => livePromise;

  return { initials, myOrders, rememberOrder, tint, intl, shopNumbers, waLink, telLink, live, icon, headline, priceHtml, heartButton, searchRow, readSaved, toggleSaved, api, config, products, money, esc, art, card, isDark, readBag, writeBag, addToBag, bagCount, bagLines, bagClicks, subtotal, checkout, openDrawer, chrome, reveal };
})();
