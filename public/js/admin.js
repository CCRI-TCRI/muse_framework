const Admin = (() => {
  const $ = (id) => document.getElementById(id);
  const { api, esc, money, picture } = Store;
  let products = [];

  /* ----- login ----- */
  async function start() {
    await Store.chrome('');
    const me = await api('/admin/me');
    if (me.loggedIn) return showAdmin();
    $('login-view').classList.remove('hidden');
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/admin/login', { method: 'POST', body: { password: $('password').value } });
      $('login-view').classList.add('hidden');
      showAdmin();
    } catch (err) {
      $('login-error').textContent = err.message;
      $('login-error').classList.remove('hidden');
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

  /* ----- tabs ----- */
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
    ({ overview: loadOverview, videos: loadVideos, orders: loadOrders, products: loadProducts })[b.dataset.tab]?.();
  });

  function showError(el, err) {
    el.textContent = err.message || err;
    el.classList.remove('hidden');
  }

  /* ----- overview ----- */
  async function loadOverview() {
    const s = await api('/admin/summary');
    $('stats').innerHTML = `
      <div class="stat"><div class="small muted">Sales</div><div class="n">${money(s.revenue)}</div></div>
      <div class="stat"><div class="small muted">Paid orders</div><div class="n">${s.orders}</div></div>
      <div class="stat"><div class="small muted">Waiting to ship</div><div class="n">${s.toShip}</div></div>
      <div class="stat"><div class="small muted">Low on stock</div><div class="n">${s.lowStock}</div></div>`;
    $('setup-tip').innerHTML = s.demoMode
      ? `<h2>Payments are in test mode</h2>
         <p>Checkout works so you can try the whole flow, but no cards are charged.
         To take real payments, make a free account at stripe.com, copy your secret key into <code>STRIPE_SECRET_KEY</code>
         in the <code>.env</code> file and restart the server. The README has the full steps.</p>`
      : `<h2>Taking real payments</h2><p>Stripe is connected. Payouts go to the bank account on your Stripe dashboard.</p>`;
  }

  /* ----- products ----- */
  async function loadProducts() {
    products = await api('/admin/products');
    const t = $('product-table');
    t.innerHTML = `<tr><th></th><th>Item</th><th>Price</th><th>Stock</th><th>Sizes</th><th></th></tr>` +
      (products.map((p) => `
        <tr>
          <td><div class="thumb">${picture(p)}</div></td>
          <td>${esc(p.name)}<div class="small muted">${esc(p.category)}${p.active ? '' : ' · hidden'}</div></td>
          <td>${money(p.price_cents)}</td>
          <td>${p.stock <= 5 ? `<strong style="color:var(--live)">${p.stock}</strong>` : p.stock}</td>
          <td class="small">${esc(p.sizes.replaceAll(',', ', ')) || 'One size'}</td>
          <td style="white-space:nowrap">
            <button class="btn ghost sm" data-edit="${p.id}">Edit</button>
            <button class="btn danger sm" data-delete="${p.id}">Delete</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No products yet. Add your first one above.</td></tr>');

    $('cat-list').innerHTML = [...new Set(products.map((p) => p.category))].map((c) => `<option value="${esc(c)}">`).join('');
    const options = '<option value="">None</option>' + products.filter((p) => p.active).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    document.querySelectorAll('[data-product-select]').forEach((s) => {
      const keep = s.value;
      s.innerHTML = options;
      s.value = keep;
    });
  }

  const form = $('product-form');

  function resetForm() {
    form.reset();
    form.id.value = '';
    $('product-form-title').textContent = 'Add a product';
    $('cancel-edit').classList.add('hidden');
    $('remove-image-wrap').classList.add('hidden');
    $('product-error').classList.add('hidden');
  }

  $('cancel-edit').addEventListener('click', resetForm);

  $('product-table').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-delete]');
    if (edit) {
      const p = products.find((x) => x.id === Number(edit.dataset.edit));
      form.id.value = p.id;
      form.name.value = p.name;
      form.category.value = p.category;
      form.price.value = (p.price_cents / 100).toFixed(2);
      form.stock.value = p.stock;
      form.sizes.value = p.sizes.replaceAll(',', ', ');
      form.description.value = p.description;
      form.color.value = p.color;
      form.active.checked = !!p.active;
      form.removeImage.checked = false;
      $('remove-image-wrap').classList.toggle('hidden', !p.image);
      $('product-form-title').textContent = `Editing ${p.name}`;
      $('cancel-edit').classList.remove('hidden');
      form.scrollIntoView({ behavior: 'smooth' });
    }
    if (del) {
      const p = products.find((x) => x.id === Number(del.dataset.delete));
      if (!confirm(`Delete "${p.name}"? Past orders keep their record, but the item leaves the shop for good.`)) return;
      await api('/admin/products/' + p.id, { method: 'DELETE' });
      loadProducts();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    fd.set('active', form.active.checked ? '1' : '0');
    fd.set('removeImage', form.removeImage.checked ? '1' : '0');
    if (!form.image.files.length) fd.delete('image');
    const id = form.id.value;
    const btn = form.querySelector('button.btn:not(.ghost)');
    btn.disabled = true;
    try {
      await api(id ? '/admin/products/' + id : '/admin/products', { method: id ? 'PUT' : 'POST', body: fd });
      resetForm();
      loadProducts();
    } catch (err) {
      showError($('product-error'), err);
    } finally {
      btn.disabled = false;
    }
  });

  /* ----- videos ----- */

  // XHR instead of fetch so we can show upload progress for big files.
  function uploadVideo(fd, bar) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/videos');
      bar.classList.remove('hidden');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) bar.firstElementChild.style.width = `${(e.loaded / e.total) * 100}%`; };
      xhr.onload = () => {
        bar.classList.add('hidden');
        bar.firstElementChild.style.width = '0';
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch {}
        xhr.status < 300 ? resolve(data) : reject(new Error(data.error || 'Upload failed.'));
      };
      xhr.onerror = () => { bar.classList.add('hidden'); reject(new Error('Upload failed. Check your connection and try again.')); };
      xhr.send(fd);
    });
  }

  async function loadVideos() {
    const videos = await api('/admin/videos');
    $('admin-videos').innerHTML = videos.map((v) => `
      <div class="video-card">
        <video src="${esc(v.file)}" controls playsinline preload="metadata"></video>
        <h3>${esc(v.title)}</h3>
        <div class="small muted">${v.product_name ? `Linked to ${esc(v.product_name)}` : 'Not linked to a product'}</div>
        <button class="btn danger sm" style="margin-top:8px" data-delete-video="${v.id}">Delete</button>
      </div>`).join('') || '<p class="muted">No videos yet.</p>';
  }

  $('admin-videos').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-delete-video]');
    if (!b || !confirm('Delete this video?')) return;
    await api('/admin/videos/' + b.dataset.deleteVideo, { method: 'DELETE' });
    loadVideos();
  });

  $('video-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const btn = f.querySelector('button');
    btn.disabled = true;
    $('video-error').classList.add('hidden');
    try {
      await uploadVideo(new FormData(f), $('video-progress'));
      f.reset();
      loadVideos();
    } catch (err) {
      showError($('video-error'), err);
    } finally {
      btn.disabled = false;
    }
  });

  /* ----- orders ----- */
  async function loadOrders() {
    const orders = await api('/admin/orders');
    $('order-table').innerHTML = `<tr><th>#</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr>` +
      (orders.map((o) => `
        <tr>
          <td>${o.id}</td>
          <td class="small">${new Date(o.created_at + 'Z').toLocaleString()}</td>
          <td class="small">${esc(o.customer_name || '')}${o.email ? `<br>${esc(o.email)}` : ''}
            ${o.shipping_address ? `<div class="muted" style="white-space:pre-line;margin-top:4px">${esc(o.shipping_address)}</div>` : ''}</td>
          <td class="small">${o.items.map((i) => `${i.quantity} × ${esc(i.name)}${i.size ? ` (${esc(i.size)})` : ''}`).join('<br>')}</td>
          <td>${money(o.total_cents)}${o.demo ? '<div class="small muted">test</div>' : ''}</td>
          <td>
            <span class="pill ${o.status}">${o.status === 'pending' ? 'not paid' : o.status}</span>
            ${o.status === 'paid' ? `<div style="margin-top:6px"><button class="btn sm" data-ship="${o.id}">Mark shipped</button></div>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">No orders yet.</td></tr>');
  }

  $('order-table').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ship]');
    if (!b) return;
    await api('/admin/orders/' + b.dataset.ship, { method: 'PATCH', body: { status: 'shipped' } });
    loadOrders();
  });

  start();
  return { uploadVideo, get products() { return products; } };
})();
