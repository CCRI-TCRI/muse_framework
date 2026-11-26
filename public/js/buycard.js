// The buy card: an iOS-style card that springs up from the bottom of the
// screen (like the Apple Pay sheet or the card that appears when you pair
// AirPods). It holds size, colour, quantity, the total and the Checkout button.
// Swipe it down, tap the cross or tap outside to close it.
const BuyCard = (() => {
  const { esc, money, art } = Store;
  let el, scrim, p, size, colour, qty, closeTimer;

  function build() {
    if (el) return;
    scrim = document.createElement('div');
    scrim.className = 'bc-scrim';
    el = document.createElement('section');
    el.className = 'buycard';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <button class="bc-close" aria-label="Close">&times;</button>
      <div class="bc-body">
        <div class="bc-photo" id="bc-photo"></div>
        <h2 class="bc-name" id="bc-name"></h2>
        <div class="bc-price" id="bc-price"></div>
        <div class="bc-group">
          <div class="bc-row" id="bc-size-row"><span class="bc-label">Size</span><div class="bc-opts" id="bc-sizes"></div></div>
          <div class="bc-row" id="bc-colour-row"><span class="bc-label">Colour</span><div class="bc-opts" id="bc-colours"></div></div>
          <div class="bc-row"><span class="bc-label">Quantity</span>
            <div class="stepper"><button data-q="-1" aria-label="One fewer">&minus;</button><span id="bc-qty">1</span><button data-q="1" aria-label="One more">+</button></div>
          </div>
          <div class="bc-row bc-total"><span>Total</span><b id="bc-total"></b></div>
        </div>
      </div>
      <div class="bc-foot">
        <div class="bc-note" id="bc-note" aria-live="polite"></div>
        <button class="btn block bc-main" id="bc-checkout">Checkout</button>
        <button class="bc-secondary" id="bc-add">Add to bag</button>
      </div>
      <div class="bc-done" id="bc-done" aria-live="polite">
        <svg viewBox="0 0 52 52" class="bc-tick" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27.5l7.5 7.5L38 19"/></svg>
        <h2>Added to bag</h2>
        <div class="muted" id="bc-done-sub"></div>
      </div>`;
    document.body.append(scrim, el);

    const body = el.querySelector('.bc-body');
    const edge = () => el.classList.toggle('more-below', body.scrollHeight - body.scrollTop - body.clientHeight > 2);
    body.addEventListener('scroll', edge, { passive: true });
    addEventListener('resize', edge);
    el._edge = edge;

    scrim.addEventListener('click', close);
    el.querySelector('.bc-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('bc-open')) close(); });

    el.querySelector('#bc-sizes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      size = b.dataset.v;
      draw();
    });
    el.querySelector('#bc-colours').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      colour = b.dataset.v;
      draw();
    });
    el.querySelector('.stepper').addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]');
      if (!b) return;
      qty = Math.max(1, Math.min(20, qty + Number(b.dataset.q)));
      draw();
    });
    el.querySelector('#bc-checkout').addEventListener('click', () => { if (commit()) location.href = '/checkout'; });
    el.querySelector('#bc-add').addEventListener('click', () => {
      if (!commit()) return;
      el.querySelector('#bc-done-sub').textContent = [qty > 1 ? `${qty} × ${p.name}` : p.name, Store.variant({ size, colour })].filter(Boolean).join(' · ');
      el.classList.add('is-done');
      clearTimeout(closeTimer);
      closeTimer = setTimeout(close, 1500);
    });

    // Swipe down to dismiss.
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, a, input, select, .bc-opts')) return;
      const scroller = el.querySelector('.bc-body');
      if (scroller.scrollTop > 0 && e.target.closest('.bc-body')) return; // let the content scroll
      e.preventDefault(); // otherwise the browser starts dragging the product photo
      drag = { y0: e.clientY, dy: 0, t: performance.now(), id: e.pointerId };
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y0;
      drag.dy = dy;
      // A gentle pull upwards, a free pull downwards, like iOS.
      el.style.setProperty('--drag', `${dy > 0 ? dy : dy * 0.18}px`);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const speed = drag.dy / Math.max(1, performance.now() - drag.t);
      const far = drag.dy > 110 || (drag.dy > 30 && speed > 0.6);
      drag = null;
      el.classList.remove('dragging');
      el.style.setProperty('--drag', '0px');
      if (far) close();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function chips(list, current) {
    return list.map((v) => `<button class="bc-opt ${v === current ? 'on' : ''}" data-v="${esc(v)}">${list === p.colours ? Store.swatch(v) : ''}${esc(v)}</button>`).join('');
  }

  function draw() {
    const needSize = p.sizes.length > 1;
    const needColour = p.colours.length > 1;
    el.querySelector('#bc-size-row').classList.toggle('hidden', !p.sizes.length);
    el.querySelector('#bc-colour-row').classList.toggle('hidden', !p.colours.length);
    el.querySelector('#bc-sizes').innerHTML = chips(p.sizes, size);
    el.querySelector('#bc-colours').innerHTML = chips(p.colours, colour);
    el.querySelector('#bc-qty').textContent = qty;
    el.querySelector('#bc-total').textContent = money(p.price_cents * qty);
    el.querySelector('#bc-note').textContent = '';
    el.querySelector('#bc-checkout').disabled = !p.in_stock;
    el.querySelector('#bc-add').disabled = !p.in_stock;
    el.querySelector('#bc-checkout').textContent = p.in_stock ? `Checkout · ${money(p.price_cents * qty)}` : 'Sold out';
    return { needSize, needColour };
  }

  function nudge(rowId, text) {
    const row = el.querySelector(rowId);
    row.classList.remove('shake');
    void row.offsetWidth; // restart the animation
    row.classList.add('shake');
    el.querySelector('#bc-note').textContent = text;
  }

  function commit() {
    if (p.sizes.length > 1 && !size) { nudge('#bc-size-row', 'Choose a size first.'); return false; }
    if (p.colours.length > 1 && !colour) { nudge('#bc-colour-row', 'Choose a colour first.'); return false; }
    Store.addToBag(p, size || p.sizes[0] || '', qty, colour || p.colours[0] || '');
    return true;
  }

  function open(product, start = {}) {
    build();
    p = { ...product, colours: product.colours || [] };
    size = start.size || (p.sizes.length === 1 ? p.sizes[0] : '');
    colour = start.colour || (p.colours.length === 1 ? p.colours[0] : '');
    qty = start.qty || 1;
    el.classList.remove('is-done');
    clearTimeout(closeTimer);
    el.setAttribute('aria-label', `Buy ${p.name}`);
    el.querySelector('#bc-photo').innerHTML = art(p);
    el.querySelector('#bc-photo').style.setProperty('--tint', Store.tint(p.id));
    el.querySelector('#bc-name').textContent = p.name;
    el.querySelector('#bc-price').innerHTML = Store.priceHtml(p);
    draw();
    el.querySelector('.bc-body').scrollTop = 0;
    requestAnimationFrame(() => {
      el._edge();
      document.body.classList.add('bc-open');
      el.querySelector('.bc-close').focus({ preventScroll: true });
      window.Glass && window.Glass.refresh();
    });
  }

  function close() {
    clearTimeout(closeTimer);
    document.body.classList.remove('bc-open');
  }

  return { open, close };
})();
