// Shared bits used on every page: settings, money formatting, the bag and the header.
const Store = (() => {
  let settings = null;

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      credentials: 'same-origin',
      ...opts,
      headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json', ...opts.headers } : opts.headers,
      body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  async function config() {
    if (!settings) settings = await api('/config');
    return settings;
  }

  function money(cents) {
    const currency = (settings && settings.currency) || 'usd';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Product picture, or a coloured block with the item's initials if no photo yet.
  function picture(p) {
    if (p.image) return `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`;
    const initials = p.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    return `<div class="placeholder" style="background:${esc(p.color || '#d9cfc1')}">${esc(initials)}</div>`;
  }

  /* ----- bag (kept in the browser) ----- */
  const KEY = 'store-bag';
  function readBag() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function writeBag(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
    updateBagCount();
  }
  function addToBag(product, size, qty = 1) {
    const items = readBag();
    const found = items.find((i) => i.id === product.id && i.size === size);
    if (found) found.qty = Math.min(found.qty + qty, 20);
    else items.push({ id: product.id, size, qty, name: product.name, price_cents: product.price_cents, image: product.image, color: product.color });
    writeBag(items);
  }
  function bagCount() {
    return readBag().reduce((n, i) => n + i.qty, 0);
  }
  function updateBagCount() {
    const el = document.querySelector('[data-bag-count]');
    if (el) el.textContent = bagCount();
  }

  /* ----- header + footer ----- */
  async function chrome(active) {
    const cfg = await config();
    const name = esc(cfg.storeName);
    const [first, ...rest] = name.split(' ');
    const logo = rest.length ? `${first} <em>${rest.join(' ')}</em>` : name;

    const header = document.createElement('header');
    header.className = 'site-header';
    header.innerHTML = `
      <div class="wrap">
        <a class="logo" href="/">${logo}</a>
        <nav class="nav">
          <a href="/" class="${active === 'shop' ? 'on' : ''}">Shop</a>
          <a href="/videos.html" class="${active === 'videos' ? 'on' : ''}">Videos</a>
          <a href="/live.html" class="${active === 'live' ? 'on' : ''}" data-live-link>Live</a>
          <a href="/cart.html" class="bag">Bag (<span data-bag-count>0</span>)</a>
        </nav>
      </div>`;
    document.body.prepend(header);

    if (cfg.demoMode) {
      const note = document.createElement('div');
      note.className = 'demo-note';
      note.textContent = 'Test mode: checkout works but no real cards are charged yet.';
      document.body.prepend(note);
    }

    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `<div class="wrap">© ${new Date().getFullYear()} ${name}. Free returns within 30 days.</div>`;
    document.body.append(footer);

    document.title = document.title ? `${document.title} · ${cfg.storeName}` : cfg.storeName;
    updateBagCount();

    // Show a red dot and a banner when a stream is on.
    api('/live').then((s) => {
      if (!s.live) return;
      const link = document.querySelector('[data-live-link]');
      if (link) link.innerHTML = '<span class="live-dot"></span>Live';
      if (active !== 'live') {
        const banner = document.createElement('div');
        banner.className = 'live-banner';
        banner.innerHTML = `<a href="/live.html"><span class="live-dot"></span>We're live right now: ${esc(s.title)}. Come watch</a>`;
        header.after(banner);
      }
    }).catch(() => {});

    return cfg;
  }

  return { api, config, money, esc, picture, readBag, writeBag, addToBag, bagCount, chrome };
})();
