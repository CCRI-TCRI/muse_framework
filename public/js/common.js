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

  function money(cents) {
    const currency = ((cfg && cfg.currency) || 'usd').toUpperCase();
    const whole = cents % 100 === 0;
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
  }

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

  // Picture for a product: its photo, or a drawing on the product's colour.
  function art(p, { index = 0, hover = false } = {}) {
    const imgs = p.images || [];
    if (imgs[index]) {
      const alt = hover && imgs[index + 1] ? `<img class="alt" src="${esc(imgs[index + 1])}" alt="" loading="lazy">` : '';
      return `<div class="art"><img src="${esc(imgs[index])}" alt="${esc(p.name)}" loading="lazy">${alt}</div>`;
    }
    const stroke = isDark(p.color) ? 'rgba(255,255,255,.72)' : 'rgba(18,18,18,.5)';
    return `<div class="art" style="background:${esc(p.color)}"><div class="sketch">
      <svg viewBox="0 0 200 250" fill="none" stroke="${stroke}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round" role="img" aria-label="${esc(p.name)}">${sketchFor(p)}</svg>
    </div></div>`;
  }

  function card(p) {
    const tag = !p.in_stock ? 'Sold out' : p.low_stock ? `Only ${p.low_stock} left` : '';
    return `<a class="card reveal" href="/product?id=${p.id}">
      <div class="frame">${tag ? `<span class="tag">${tag}</span>` : ''}${art(p, { hover: true })}</div>
      <div class="meta"><span class="name">${esc(p.name)}</span><span class="price">${money(p.price_cents)}</span></div>
    </a>`;
  }

  /* ----- bag (kept in this browser) ----- */
  const KEY = 'store-bag';
  function readBag() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function writeBag(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
    document.querySelectorAll('[data-bag-count]').forEach((el) => { el.textContent = bagCount(); });
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
        <a class="frame" href="/product?id=${i.id}">${art(i)}</a>
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

  async function checkout(btn, errEl) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'One moment';
    errEl?.classList.add('hidden');
    try {
      const items = readBag().map(({ id, size, qty }) => ({ id, size, qty }));
      const { url } = await api('/checkout', { method: 'POST', body: { items } });
      location.href = url;
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
      btn.disabled = false;
      btn.textContent = label;
    }
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
  async function chrome(active = '') {
    const c = await config();
    const s = c.settings;
    const name = esc(c.storeName);

    const top = document.createElement('div');
    top.innerHTML = `
      ${c.demoMode ? '<div class="announce demo">Test mode. Checkout works, but no cards are charged yet.</div>' : ''}
      ${s.announcement ? `<div class="announce">${esc(s.announcement)}</div>` : ''}
      <header class="site-header">
        <div class="bar">
          <nav class="nav-left">
            <button class="menu-btn" data-open="menu" aria-label="Menu"><span></span><span></span></button>
            <a href="/shop" class="${active === 'shop' ? 'on' : ''}">Shop</a>
            <a href="/videos" class="${active === 'videos' ? 'on' : ''}">Films</a>
            <a href="/live" class="${active === 'live' ? 'on' : ''}" data-live-link>Live</a>
          </nav>
          <a class="wordmark" href="/">${name}</a>
          <nav class="nav-right">
            <button data-open="bag">Bag (<span data-bag-count>0</span>)</button>
          </nav>
        </div>
      </header>`;
    document.body.prepend(...top.children);

    const cats = [...new Set((await products().catch(() => [])).map((p) => p.category))];

    const drawers = document.createElement('div');
    drawers.innerHTML = `
      <div class="scrim"></div>
      <aside class="drawer left" id="menu" aria-label="Menu">
        <div class="drawer-head"><span class="eyebrow">Menu</span><button class="close" data-close>Close</button></div>
        <nav class="menu-links">
          <a href="/shop">Shop all</a>
          ${cats.map((cat) => `<a class="sub" href="/shop?category=${encodeURIComponent(cat)}">${esc(cat)}</a>`).join('')}
          <a href="/videos">Films</a>
          <a href="/live" data-live-link>Live</a>
        </nav>
      </aside>
      <aside class="drawer right" id="bag" aria-label="Shopping bag">
        <div class="drawer-head"><span class="eyebrow">Your bag (<span data-bag-count>0</span>)</span><button class="close" data-close>Close</button></div>
        <div class="drawer-body" id="bag-body"></div>
        <div class="drawer-foot" id="bag-foot">
          <div class="totals big"><span>Subtotal</span><span id="bag-subtotal"></span></div>
          <div class="small muted">Shipping and taxes are worked out at checkout.</div>
          <div class="note err hidden" id="bag-error"></div>
          <button class="btn block" id="drawer-checkout">Checkout</button>
          <a class="btn ghost block" href="/cart">View bag</a>
        </div>
      </aside>`;
    document.body.append(...drawers.children);

    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `
      <div class="wrap">
        <div class="foot-grid">
          <div><a class="wordmark" href="/">${name}</a><p>${esc(s.about)}</p></div>
          <div><h4>Shop</h4><ul>
            <li><a href="/shop">All pieces</a></li>
            ${cats.slice(0, 6).map((cat) => `<li><a href="/shop?category=${encodeURIComponent(cat)}">${esc(cat)}</a></li>`).join('')}
          </ul></div>
          <div><h4>Studio</h4><ul>
            <li><a href="/videos">Films</a></li>
            <li><a href="/live">Live try-ons</a></li>
            <li><a href="/cart">Your bag</a></li>
            ${s.instagram ? `<li><a href="${esc(s.instagram)}" target="_blank" rel="noopener">Instagram</a></li>` : ''}
          </ul></div>
          <div><h4>Delivery &amp; returns</h4><p>${esc(s.shipping_info)}</p></div>
        </div>
        <div class="foot-base"><span>&copy; ${new Date().getFullYear()} ${name}</span><span>Secure payments by Stripe</span></div>
      </div>`;
    document.body.append(footer);

    document.addEventListener('click', (e) => {
      const open = e.target.closest('[data-open]');
      if (open) { openDrawer(open.dataset.open); return; }
      if (e.target.closest('[data-close]') || e.target.classList.contains('scrim')) closeDrawers();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawers(); });
    document.getElementById('bag-body').addEventListener('click', bagClicks);
    document.getElementById('drawer-checkout').addEventListener('click', (e) => checkout(e.currentTarget, document.getElementById('bag-error')));

    const header = document.querySelector('.site-header');
    const onScroll = () => header.classList.toggle('scrolled', scrollY > 10);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    document.title = document.title ? `${document.title} · ${c.storeName}` : c.storeName;
    writeBag(readBag());

    livePromise = api('/live/status').catch(() => ({ live: false }));
    livePromise.then((st) => {
      if (!st.live) return;
      document.querySelectorAll('[data-live-link]').forEach((a) => { a.innerHTML = '<span class="live-dot"></span>Live'; });
    });

    return c;
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

  return { live, api, config, products, money, esc, art, card, isDark, readBag, writeBag, addToBag, bagCount, bagLines, bagClicks, subtotal, checkout, openDrawer, chrome, reveal };
})();
