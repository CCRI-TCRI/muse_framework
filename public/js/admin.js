const Admin = (() => {
  const $ = (id) => document.getElementById(id);
  const { api, esc, money, art, tint } = Store;
  let cfg;
  let products = [];
  let orders = [];

  /* ----- icons for the sidebar ----- */
  const ICONS = {
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
    film: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9.5 4.5 2.5-4.5 2.5z"/>',
    live: '<circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5 11v9h14v-9"/>',
    out: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 9"/>',
  };
  const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
  document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon); });

  function showError(el, err) {
    el.textContent = err.message || String(err);
    el.classList.remove('hidden');
  }

  /* ----- file uploads ----- */

  // Sends a file to storage and returns its address. On Vercel it goes straight
  // to Vercel Blob from the browser; when running locally it goes to the server.
  async function uploadFile(file, folder, bar) {
    const progress = (fraction) => {
      if (!bar) return;
      bar.classList.remove('hidden');
      bar.firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
    };
    const done = () => { if (bar) { bar.classList.add('hidden'); bar.firstElementChild.style.width = '0'; } };
    const type = String(file.type || '').split(';')[0];

    try {
      if (cfg.uploadMode === 'blob') {
        const { upload } = await import('/js/vendor/blob-client.js');
        const safe = (file.name || 'file').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(-80);
        const blob = await upload(`${folder}/${safe}`, file, {
          access: 'public',
          handleUploadUrl: '/api/admin/blob',
          contentType: type,
          multipart: file.size > 40 * 1024 * 1024,
          onUploadProgress: (e) => progress(e.percentage / 100),
        });
        return blob.url;
      }
      return await new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append('file', type && type !== file.type ? new File([file], file.name || 'file', { type }) : file);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/admin/upload');
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) progress(e.loaded / e.total); };
        xhr.onload = () => {
          let data = {};
          try { data = JSON.parse(xhr.responseText); } catch {}
          xhr.status < 300 ? resolve(data.url) : reject(new Error(data.error || 'Upload failed.'));
        };
        xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
        xhr.send(fd);
      });
    } finally {
      done();
    }
  }

  /* ----- sign in ----- */
  async function start() {
    cfg = await Store.config();
    const initial = (cfg.storeName.trim()[0] || 'M').toUpperCase();
    document.querySelectorAll('[data-initial]').forEach((el) => { el.textContent = initial; });
    document.querySelectorAll('[data-store-name]').forEach((el) => { el.textContent = cfg.storeName; });
    document.title = `Admin · ${cfg.storeName}`;
    $('today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

    const me = await api('/admin/me');
    if (me.loggedIn) return showAdmin();
    $('login-view').classList.remove('hidden');
    if (!me.passwordSet) showError($('login-error'), 'No admin password is set yet. Add ADMIN_PASSWORD in your Vercel project settings (Settings, Environment Variables), then redeploy.');
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-error').classList.add('hidden');
    try {
      await api('/admin/login', { method: 'POST', body: { password: $('password').value } });
      $('login-view').classList.add('hidden');
      showAdmin();
    } catch (err) {
      showError($('login-error'), err);
    }
  });

  $('logout').addEventListener('click', async () => {
    await api('/admin/logout', { method: 'POST' });
    location.reload();
  });

  async function showAdmin() {
    $('admin-view').classList.remove('hidden');
    await loadProducts();
    loadOverview();
    document.dispatchEvent(new Event('admin:ready'));
    setInterval(() => { if (!document.hidden) refreshBadge(); }, 60000);
  }

  /* ----- navigation ----- */
  const TITLES = { overview: 'Overview', orders: 'Orders', products: 'Products', films: 'Films', studio: 'Live studio', settings: 'Shop settings' };
  const LOADERS = { overview: () => loadOverview(), orders: () => loadOrders(), products: () => loadProducts(), films: () => loadFilms(), settings: () => loadSettings() };

  function go(tab) {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab));
    $('page-title').textContent = TITLES[tab];
    $('quick-add').classList.toggle('hidden', tab === 'studio');
    LOADERS[tab]?.();
    window.scrollTo({ top: 0 });
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) go(g.dataset.goto);
  });
  $('quick-add').addEventListener('click', () => { go('products'); resetForm(); openForm(); });

  /* ----- overview ----- */
  function refreshBadge(n) {
    const set = (count) => { $('new-badge').textContent = count; $('new-badge').classList.toggle('hidden', !count); };
    if (n !== undefined) return set(n);
    api('/admin/summary').then((s) => set(s.newOrders)).catch(() => {});
  }

  async function loadOverview() {
    const s = await api('/admin/summary');
    refreshBadge(s.newOrders);
    $('stats').innerHTML = `
      <div class="kpi a"><div class="label">Total sales</div><div class="n">${money(s.revenue)}</div><div class="sub">${s.orders} paid ${s.orders === 1 ? 'order' : 'orders'}</div></div>
      <div class="kpi b"><div class="label">This week</div><div class="n">${money(s.weekRevenue)}</div><div class="sub">Paid in the last 7 days</div></div>
      <button class="kpi c" data-goto="orders"><div class="label">New orders</div><div class="n">${s.newOrders}</div><div class="sub">Waiting for WhatsApp confirmation</div></button>
      <button class="kpi d" data-goto="orders"><div class="label">To deliver</div><div class="n">${s.toDeliver}</div><div class="sub">Paid, not yet delivered</div></button>`;

    $('recent').innerHTML = s.recent.map((o) => `
      <div class="row-item">
        <span class="av">${esc((o.customer_name || '?')[0].toUpperCase())}</span>
        <div><b>${esc(o.customer_name || 'Customer')} · #${o.id}</b><small>${new Date(o.created_at).toLocaleString()}</small></div>
        <div style="text-align:right"><b>${money(o.total_cents)}</b><span class="pill ${o.status}">${statusLabel(o.status)}</span></div>
      </div>`).join('') || '<p class="muted small">No orders yet. They will appear here as soon as someone checks out.</p>';

    $('low').innerHTML = s.lowStock.map((p) => `
      <div class="row-item">
        <span class="av" style="background:var(--p-peach);color:var(--coral)">${p.stock}</span>
        <div><b>${esc(p.name)}</b><small>${p.stock === 0 ? 'Sold out' : `${p.stock} left`}</small></div>
        <button class="link" data-edit-product="${p.id}">Restock</button>
      </div>`).join('') || '<p class="muted small">Everything is well stocked.</p>';

    const tips = [];
    if (!Store.shopNumbers().length) tips.push('<li>Add your WhatsApp numbers in <button class="link" data-goto="settings">Shop settings</button> so customers can confirm orders.</li>');
    if (s.uploadMode === 'local') tips.push('<li>Photos are being saved on this computer. On Vercel, connect a Blob store so they are kept safely.</li>');
    if (products.length && products.every((p) => !p.images.length)) tips.push('<li>Add real photos to your products. They make the biggest difference.</li>');
    $('setup').innerHTML = `<div class="box-head"><h2>${tips.length ? 'To do' : 'All set'}</h2></div>${tips.length ? `<ul style="margin:0;padding-left:20px;display:grid;gap:8px;font-size:14px">${tips.join('')}</ul>` : '<p class="muted small" style="margin:0">Orders, photos and WhatsApp are all set up.</p>'}`;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit-product]');
    if (!b) return;
    go('products');
    editProduct(Number(b.dataset.editProduct));
  });

  /* ----- orders ----- */
  const statusLabel = (s) => ({ pending: 'New', paid: 'Paid', shipped: 'Delivered', cancelled: 'Cancelled' }[s] || s);
  let orderFilter = 'pending';

  async function loadOrders() {
    orders = await api('/admin/orders');
    refreshBadge(orders.filter((o) => o.status === 'pending').length);
    drawOrders();
  }

  function drawOrders() {
    const count = (st) => orders.filter((o) => st === 'all' || o.status === st).length;
    $('order-filters').innerHTML = ['pending', 'paid', 'shipped', 'cancelled', 'all'].map((st) => `
      <button class="${st === orderFilter ? 'on' : ''}" data-filter="${st}">${st === 'all' ? 'All' : statusLabel(st)}<em>${count(st)}</em></button>`).join('');
    const list = orders.filter((o) => orderFilter === 'all' || o.status === orderFilter);
    $('order-list').innerHTML = list.map(orderCard).join('') || `<div class="box"><p class="muted" style="margin:0">No ${orderFilter === 'all' ? '' : statusLabel(orderFilter).toLowerCase() + ' '}orders.</p></div>`;
  }

  function orderCard(o) {
    const first = (o.customer_name || '').split(' ')[0] || 'there';
    const items = o.items.map((i) => `${i.quantity} x ${i.name}${i.size ? ` (${i.size})` : ''}`).join(', ');
    const msg = {
      pending: `Hello ${first}, thank you for your order #${o.id} from ${cfg.storeName} (${items}). The total is ${money(o.total_cents)}. `,
      paid: `Hello ${first}, your order #${o.id} from ${cfg.storeName} is paid and on its way to you soon.`,
      shipped: `Hello ${first}, how are you finding your order #${o.id} from ${cfg.storeName}?`,
      cancelled: `Hello ${first}, about your order #${o.id} from ${cfg.storeName}: `,
    }[o.status];
    const hasPhone = (o.phone || '').replace(/\D/g, '').length >= 9;
    return `
      <article class="order-card ${o.status}">
        <div class="top"><b>#${o.id}</b><span class="pill ${o.status}">${statusLabel(o.status)}</span></div>
        <div class="who">
          <span class="name">${esc(o.customer_name || 'No name')}</span>
          ${o.phone ? `<a href="${Store.telLink(o.phone)}">${esc(o.phone)}</a>` : ''}
          ${o.shipping_address ? `<span class="addr">${esc(o.shipping_address)}</span>` : ''}
          ${o.notes ? `<span class="small muted">Note: ${esc(o.notes)}</span>` : ''}
          <span class="small muted">${new Date(o.created_at).toLocaleString()}</span>
        </div>
        <div class="items">
          ${o.items.map((i) => `<div class="totals"><span>${i.quantity} &times; ${esc(i.name)}${i.size ? `, ${esc(i.size)}` : ''}</span><span>${money(i.unit_price_cents * i.quantity)}</span></div>`).join('')}
          <div class="totals big"><span>Total</span><span>${money(o.total_cents)}</span></div>
        </div>
        <div class="acts">
          ${hasPhone ? `<a class="btn wa" href="${Store.waLink(o.phone, msg)}" target="_blank" rel="noopener">${WA_ICON.replace('fill:#25d366', 'fill:currentColor')}WhatsApp</a>` : ''}
          ${o.status === 'pending' ? `<button class="btn violet" data-status="paid" data-order="${o.id}">Mark paid</button>` : ''}
          ${o.status === 'paid' ? `<button class="btn mint" data-status="shipped" data-order="${o.id}">Mark delivered</button>` : ''}
          ${['pending', 'paid'].includes(o.status) ? `<button class="btn ghost" data-status="cancelled" data-order="${o.id}">Cancel</button>` : ''}
        </div>
      </article>`;
  }

  $('order-filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    orderFilter = b.dataset.filter;
    drawOrders();
  });

  $('order-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    const st = b.dataset.status;
    const ask = { paid: 'Mark this order as paid? Its items come out of stock.', shipped: 'Mark this order as delivered?', cancelled: 'Cancel this order?' }[st];
    if (!confirm(ask)) return;
    b.disabled = true;
    try {
      await api('/admin/orders/' + b.dataset.order, { method: 'PATCH', body: { status: st } });
      await loadOrders();
      if (st === 'paid') loadProducts();
    } catch (err) {
      alert(err.message);
      b.disabled = false;
    }
  });

  /* ----- products ----- */
  let images = [];
  let editingId = null;
  const form = $('product-form');

  function openForm() {
    $('product-box').classList.remove('hidden');
    $('product-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function drawImages() {
    $('image-list').innerHTML = images.map((url, i) => `
      <div class="item">${art({ name: '', images: [url] })}
        ${i === 0 ? '<span class="first">Cover</span>' : ''}
        <button type="button" data-remove-image="${i}" aria-label="Remove photo">&times;</button>
      </div>`).join('');
  }

  $('image-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove-image]');
    if (!b) return;
    images.splice(Number(b.dataset.removeImage), 1);
    drawImages();
  });

  $('image-input').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    $('save-product').disabled = true;
    try {
      for (const f of files) {
        if (images.length >= 8) break;
        images.push(await uploadFile(f, 'products', $('image-progress')));
        drawImages();
      }
    } catch (err) {
      showError($('product-error'), err);
    } finally {
      $('save-product').disabled = false;
    }
  });

  async function loadProducts() {
    products = await api('/admin/products');
    drawProductTable();
    $('cat-list').innerHTML = [...new Set(products.map((p) => p.category))].map((c) => `<option value="${esc(c)}">`).join('');
    const options = '<option value="">None</option>' + products.filter((p) => p.active).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    document.querySelectorAll('[data-product-select]').forEach((s) => { const keep = s.value; s.innerHTML = options; s.value = keep; });
  }

  function drawProductTable() {
    const q = $('product-search').value.trim().toLowerCase();
    const list = products.filter((p) => !q || `${p.name} ${p.category}`.toLowerCase().includes(q));
    $('product-table').innerHTML = `<tr><th></th><th>Piece</th><th>Price</th><th>Stock</th><th>Sizes</th><th></th></tr>` +
      (list.map((p) => `
        <tr>
          <td><div class="thumb" style="--tint:${tint(p.id)}">${art(p)}</div></td>
          <td><b style="font-weight:600">${esc(p.name)}</b><span class="small muted">${esc(p.category)}${p.active ? '' : ' · hidden'}</span></td>
          <td style="white-space:nowrap">${money(p.price_cents)}${p.compare_cents ? `<span class="small muted" style="text-decoration:line-through">${money(p.compare_cents)}</span>` : ''}</td>
          <td>${p.stock <= 3 ? `<span class="pill pending">${p.stock}</span>` : p.stock}</td>
          <td class="small">${esc(p.sizes.replaceAll(',', ', ')) || 'One size'}</td>
          <td style="white-space:nowrap;text-align:right">
            <button class="btn ghost sm" data-edit="${p.id}">Edit</button>
            <button class="btn danger sm" data-delete="${p.id}">Delete</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No products found.</td></tr>');
  }
  $('product-search').addEventListener('input', drawProductTable);

  function resetForm() {
    form.reset();
    editingId = null;
    images = [];
    drawImages();
    $('product-form-title').textContent = 'Add a product';
    $('product-error').classList.add('hidden');
  }
  $('cancel-edit').addEventListener('click', () => { resetForm(); $('product-box').classList.add('hidden'); });

  function editProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    editingId = p.id;
    const f = form.elements;
    f.name.value = p.name;
    f.category.value = p.category;
    f.price.value = p.price_cents / 100;
    f.compare_price.value = p.compare_cents ? p.compare_cents / 100 : '';
    f.stock.value = p.stock;
    f.sizes.value = p.sizes.replaceAll(',', ', ');
    f.description.value = p.description;
    f.details.value = p.details;
    f.color.value = p.color;
    f.active.checked = p.active;
    images = [...p.images];
    drawImages();
    $('product-form-title').textContent = `Editing: ${p.name}`;
    $('product-error').classList.add('hidden');
    openForm();
  }

  $('product-table').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-delete]');
    if (edit) editProduct(Number(edit.dataset.edit));
    if (del) {
      const p = products.find((x) => x.id === Number(del.dataset.delete));
      if (!confirm(`Delete "${p.name}"? Past orders keep their record, but the piece leaves the shop for good.`)) return;
      await api('/admin/products/' + p.id, { method: 'DELETE' });
      loadProducts();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const body = {
      name: f.name.value, category: f.category.value, price: f.price.value, compare_price: f.compare_price.value, stock: f.stock.value,
      sizes: f.sizes.value, description: f.description.value, details: f.details.value, color: f.color.value, active: f.active.checked, images,
    };
    $('save-product').disabled = true;
    $('product-error').classList.add('hidden');
    try {
      await api(editingId ? `/admin/products/${editingId}` : '/admin/products', { method: editingId ? 'PUT' : 'POST', body });
      resetForm();
      $('product-box').classList.add('hidden');
      loadProducts();
    } catch (err) {
      showError($('product-error'), err);
    } finally {
      $('save-product').disabled = false;
    }
  });

  /* ----- films ----- */
  async function addFilm({ file, title, description = '', productId = '' }, bar) {
    const url = await uploadFile(file, 'videos', bar);
    return api('/admin/videos', { method: 'POST', body: { file: url, title, description, product_id: productId } });
  }

  async function loadFilms() {
    const videos = await api('/admin/videos');
    $('admin-films').innerHTML = videos.map((v) => `
      <div>
        <video src="${esc(v.file)}" controls playsinline preload="metadata"></video>
        <h3>${esc(v.title)}</h3>
        <div class="small muted">${v.product_name ? `Linked to ${esc(v.product_name)}` : 'Not linked to a product'}</div>
        <button class="btn danger sm" style="margin-top:10px" data-delete-video="${v.id}">Delete</button>
      </div>`).join('') || '<p class="muted">No films yet.</p>';
  }

  $('admin-films').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-delete-video]');
    if (!b || !confirm('Delete this film?')) return;
    await api('/admin/videos/' + b.dataset.deleteVideo, { method: 'DELETE' });
    loadFilms();
  });

  const videoForm = $('video-form');
  videoForm.elements.file.addEventListener('change', (e) => {
    $('video-file-name').textContent = e.target.files[0]?.name || 'Choose a video (MP4, MOV or WebM)';
  });
  videoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = videoForm.elements;
    const btn = videoForm.querySelector('button.btn');
    $('video-error').classList.add('hidden');
    if (!f.file.files[0]) return showError($('video-error'), 'Choose a video file first.');
    btn.disabled = true;
    try {
      await addFilm({ file: f.file.files[0], title: f.title.value, description: f.description.value, productId: f.product_id.value }, $('video-progress'));
      videoForm.reset();
      $('video-file-name').textContent = 'Choose a video (MP4, MOV or WebM)';
      loadFilms();
    } catch (err) {
      showError($('video-error'), err);
    } finally {
      btn.disabled = false;
    }
  });

  /* ----- settings ----- */
  let hero = { url: '', type: '' };
  let splash = '';

  function drawSplash() {
    $('splash-preview').innerHTML = splash
      ? `<img src="${esc(splash)}" alt="" style="width:100%;border-radius:14px"><button type="button" class="link" id="splash-remove" style="margin-top:8px">Remove</button>`
      : '';
    $('splash-remove')?.addEventListener('click', () => { splash = ''; drawSplash(); });
  }
  const sform = $('settings-form');
  let settingsLoading = null;

  function drawHero() {
    $('hero-preview').innerHTML = hero.url
      ? `${hero.type === 'video' ? `<video src="${esc(hero.url)}" muted loop autoplay playsinline style="width:100%;border-radius:14px"></video>` : `<img src="${esc(hero.url)}" alt="" style="width:100%;border-radius:14px">`}
         <button type="button" class="link" id="hero-remove" style="margin-top:8px">Remove</button>`
      : '';
    $('hero-remove')?.addEventListener('click', () => { hero = { url: '', type: '' }; drawHero(); });
  }

  function loadSettings() {
    settingsLoading = (async () => {
      const s = (await api('/config')).settings;
      for (const el of sform.elements) if (el.name && el.name in s) el.value = s[el.name];
      hero = { url: s.hero_media, type: s.hero_media_type };
      drawHero();
      splash = s.splash_media || '';
      drawSplash();
    })();
    return settingsLoading;
  }

  $('hero-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      await settingsLoading; // don't let the saved settings overwrite this new upload
      const isVideo = file.type.startsWith('video');
      hero = { url: await uploadFile(file, isVideo ? 'videos' : 'products', $('hero-progress')), type: isVideo ? 'video' : 'image' };
      drawHero();
    } catch (err) {
      const msg = $('settings-msg');
      msg.className = 'note err';
      msg.textContent = err.message;
    }
  });

  $('splash-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      await settingsLoading;
      splash = await uploadFile(file, 'products', $('splash-progress'));
      drawSplash();
    } catch (err) {
      const msg = $('settings-msg');
      msg.className = 'note err';
      msg.textContent = err.message;
    }
  });

  sform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries([...sform.elements].filter((el) => el.name).map((el) => [el.name, el.value]));
    body.hero_media = hero.url;
    body.hero_media_type = hero.type;
    body.splash_media = splash;
    const msg = $('settings-msg');
    try {
      const saved = await api('/admin/settings', { method: 'PUT', body });
      cfg.settings = saved;
      msg.className = 'note ok';
      msg.textContent = 'Saved. The shop is updated.';
    } catch (err) {
      msg.className = 'note err';
      msg.textContent = err.message;
    }
  });

  start();
  return { addFilm, get products() { return products; } };
})();
