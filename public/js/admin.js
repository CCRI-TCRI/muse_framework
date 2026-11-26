const Admin = (() => {
  const $ = (id) => document.getElementById(id);
  const { api, esc, money, art } = Store;
  let cfg;
  let products = [];

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
    cfg = await Store.chrome('');
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
  }

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
    ({ overview: loadOverview, products: loadProducts, films: loadFilms, orders: loadOrders, homepage: loadSettings })[b.dataset.tab]?.();
  });

  /* ----- overview ----- */
  async function loadOverview() {
    const s = await api('/admin/summary');
    $('stats').innerHTML = `
      <div class="stat"><div class="eyebrow">Sales</div><div class="n">${money(s.revenue)}</div></div>
      <div class="stat"><div class="eyebrow">Paid orders</div><div class="n">${s.orders}</div></div>
      <div class="stat"><div class="eyebrow">To ship</div><div class="n">${s.toShip}</div></div>
      <div class="stat"><div class="eyebrow">Low stock</div><div class="n">${s.lowStock}</div></div>`;
    const tips = [];
    if (s.demoMode) tips.push(`<p><strong>Payments are in test mode.</strong> Checkout works end to end but no cards are charged.
      To take real payments, add your Stripe secret key as <code>STRIPE_SECRET_KEY</code> and redeploy. The README has the steps.</p>`);
    if (s.uploadMode === 'local') tips.push(`<p><strong>Photos and films are saved on this computer</strong> in the <code>uploads</code> folder.
      On Vercel, connect a Blob store to the project so they're kept safely.</p>`);
    $('setup').innerHTML = tips.length ? `<h2>Before you open</h2>${tips.join('')}` : '<h2>All set</h2><p>Payments are live and uploads are stored safely.</p>';
  }

  /* ----- products ----- */
  let images = [];
  let editingId = null;
  const form = $('product-form');

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
    $('product-table').innerHTML = `<tr><th></th><th>Piece</th><th>Price</th><th>Stock</th><th>Sizes</th><th></th></tr>` +
      (products.map((p) => `
        <tr>
          <td><div class="thumb">${art(p)}</div></td>
          <td>${esc(p.name)}<div class="small muted">${esc(p.category)}${p.active ? '' : ', hidden'}</div></td>
          <td>${money(p.price_cents)}</td>
          <td>${p.stock <= 3 ? `<strong style="color:var(--red)">${p.stock}</strong>` : p.stock}</td>
          <td class="small">${esc(p.sizes.replaceAll(',', ', ')) || 'One size'}</td>
          <td style="white-space:nowrap;text-align:right">
            <button class="btn ghost sm" data-edit="${p.id}">Edit</button>
            <button class="btn danger sm" data-delete="${p.id}">Delete</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No products yet.</td></tr>');

    $('cat-list').innerHTML = [...new Set(products.map((p) => p.category))].map((c) => `<option value="${esc(c)}">`).join('');
    const options = '<option value="">None</option>' + products.filter((p) => p.active).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    document.querySelectorAll('[data-product-select]').forEach((s) => { const keep = s.value; s.innerHTML = options; s.value = keep; });
  }

  function resetForm() {
    form.reset();
    editingId = null;
    images = [];
    drawImages();
    $('product-form-title').textContent = 'Add a product';
    $('cancel-edit').classList.add('hidden');
    $('product-error').classList.add('hidden');
  }
  $('cancel-edit').addEventListener('click', resetForm);

  $('product-table').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-delete]');
    if (edit) {
      const p = products.find((x) => x.id === Number(edit.dataset.edit));
      editingId = p.id;
      const f = form.elements;
      f.name.value = p.name;
      f.category.value = p.category;
      f.price.value = (p.price_cents / 100).toFixed(2);
      f.stock.value = p.stock;
      f.sizes.value = p.sizes.replaceAll(',', ', ');
      f.description.value = p.description;
      f.details.value = p.details;
      f.color.value = p.color;
      f.active.checked = p.active;
      images = [...p.images];
      drawImages();
      $('product-form-title').textContent = `Editing: ${p.name}`;
      $('cancel-edit').classList.remove('hidden');
      form.scrollIntoView({ behavior: 'smooth' });
    }
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
      name: f.name.value, category: f.category.value, price: f.price.value, stock: f.stock.value, sizes: f.sizes.value,
      description: f.description.value, details: f.details.value, color: f.color.value, active: f.active.checked, images,
    };
    $('save-product').disabled = true;
    $('product-error').classList.add('hidden');
    try {
      await api(editingId ? `/admin/products/${editingId}` : '/admin/products', { method: editingId ? 'PUT' : 'POST', body });
      resetForm();
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

  $('video-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const btn = f.querySelector('button');
    btn.disabled = true;
    $('video-error').classList.add('hidden');
    try {
      await addFilm({ file: f.elements.file.files[0], title: f.elements.title.value, description: f.elements.description.value, productId: f.elements.product_id.value }, $('video-progress'));
      f.reset();
      loadFilms();
    } catch (err) {
      showError($('video-error'), err);
    } finally {
      btn.disabled = false;
    }
  });

  /* ----- orders ----- */
  async function loadOrders() {
    const orders = await api('/admin/orders');
    $('order-table').innerHTML = `<tr><th>No.</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr>` +
      (orders.map((o) => `
        <tr>
          <td>${o.id}</td>
          <td class="small">${new Date(o.created_at).toLocaleString()}</td>
          <td class="small">${esc(o.customer_name || '')}${o.email ? `<br>${esc(o.email)}` : ''}
            ${o.shipping_address ? `<div class="muted" style="white-space:pre-line;margin-top:6px">${esc(o.shipping_address)}</div>` : ''}</td>
          <td class="small">${o.items.map((i) => `${i.quantity} &times; ${esc(i.name)}${i.size ? `, ${esc(i.size)}` : ''}`).join('<br>')}</td>
          <td>${money(o.total_cents)}${o.demo ? '<div class="small muted">test</div>' : ''}</td>
          <td><span class="pill ${o.status}">${o.status === 'pending' ? 'unpaid' : o.status}</span>
            ${o.status === 'paid' ? `<div style="margin-top:8px"><button class="btn sm" data-ship="${o.id}">Mark shipped</button></div>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No orders yet.</td></tr>');
  }

  $('order-table').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ship]');
    if (!b) return;
    await api('/admin/orders/' + b.dataset.ship, { method: 'PATCH', body: { status: 'shipped' } });
    loadOrders();
  });

  /* ----- homepage ----- */
  let hero = { url: '', type: '' };
  const sform = $('settings-form');

  function drawHero() {
    $('hero-preview').innerHTML = hero.url
      ? `${hero.type === 'video' ? `<video src="${esc(hero.url)}" muted loop autoplay playsinline style="width:100%"></video>` : `<img src="${esc(hero.url)}" alt="" style="width:100%">`}
         <button type="button" class="text-btn" id="hero-remove" style="margin-top:8px">Remove</button>`
      : '';
    $('hero-remove')?.addEventListener('click', () => { hero = { url: '', type: '' }; drawHero(); });
  }

  let settingsLoading = null;
  function loadSettings() {
    settingsLoading = (async () => {
    const s = (await Store.api('/config')).settings;
    for (const el of sform.elements) if (el.name && el.name in s) el.value = s[el.name];
    hero = { url: s.hero_media, type: s.hero_media_type };
    drawHero();
    })();
    return settingsLoading;
  }

  $('hero-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      await settingsLoading; // don't let the saved settings overwrite this new upload
      hero = { url: await uploadFile(file, file.type.startsWith('video') ? 'videos' : 'products', $('hero-progress')), type: file.type.startsWith('video') ? 'video' : 'image' };
      drawHero();
    } catch (err) {
      showError($('settings-msg'), err);
    }
  });

  sform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries([...sform.elements].filter((el) => el.name).map((el) => [el.name, el.value]));
    body.hero_media = hero.url;
    body.hero_media_type = hero.type;
    const msg = $('settings-msg');
    try {
      await api('/admin/settings', { method: 'PUT', body });
      msg.className = 'note ok';
      msg.textContent = 'Saved. The homepage is updated.';
    } catch (err) {
      msg.className = 'note err';
      msg.textContent = err.message;
    }
  });

  start();
  return { addFilm, get products() { return products; } };
})();
