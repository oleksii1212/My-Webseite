// GOLDBET — Wheel view. Spin a ring of equally-likely segments; the winning
// segment is decided server-side (provably fair). This view draws the wheel and
// animates it to rest on the chosen segment.

const TEMPLATE = `
  <div class="game game--wheel">
    <div class="game__main">
      <div class="wheel__stage">
        <div class="wheel__pointer"></div>
        <canvas id="wheelCanvas"></canvas>
        <div class="wheel__center" id="wheelCenter">—</div>
      </div>
      <div class="betpanel">
        <div class="betpanel__grid">
          <label class="betpanel__field">
            <span>Bet amount</span>
            <div class="betpanel__amount">
              <input id="betAmount" type="number" min="1" step="1" value="10" />
              <button type="button" class="chip" data-mult="0.5">½</button>
              <button type="button" class="chip" data-mult="2">2×</button>
              <button type="button" class="chip" data-max>Max</button>
            </div>
          </label>
          <label class="betpanel__field">
            <span>Risk</span>
            <select id="wheelRisk">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <button class="btn btn--primary betpanel__action" id="spinBtn">Spin wheel</button>
        <p class="betpanel__hint" id="hint"></p>
      </div>
    </div>

    <aside class="game__side">
      <div class="game__side-head"><span class="game__side-title">Last spins</span></div>
      <div class="game__history" id="wheelHistory"></div>
      <div class="game__stat"><span>Last payout</span><span id="wheelPayout">—</span></div>
    </aside>
  </div>
`;

const TAU = Math.PI * 2;

export function mountWheel(container, deps) {
  const { socket, getUser, formatCoins, openModal } = deps;
  container.innerHTML = TEMPLATE;

  const els = {
    stage: container.querySelector('.wheel__stage'),
    canvas: container.querySelector('#wheelCanvas'),
    center: container.querySelector('#wheelCenter'),
    betAmount: container.querySelector('#betAmount'),
    risk: container.querySelector('#wheelRisk'),
    spin: container.querySelector('#spinBtn'),
    hint: container.querySelector('#hint'),
    history: container.querySelector('#wheelHistory'),
    payout: container.querySelector('#wheelPayout'),
  };
  const ctx = els.canvas.getContext('2d');

  let rings = null;
  let rotation = 0;
  let anim = 0;
  const history = [];

  function ring() {
    return rings ? rings[els.risk.value] : [];
  }

  function segColor(m) {
    if (m <= 0) return '#2a3346';
    if (m >= 10) return '#f5b301';
    if (m >= 2) return '#00e08a';
    return '#0bbf78';
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(els.stage.clientWidth, els.stage.clientHeight);
    els.canvas.width = Math.max(1, Math.floor(size * dpr));
    els.canvas.height = Math.max(1, Math.floor(size * dpr));
    els.canvas.style.width = `${size}px`;
    els.canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    const seg = ring();
    const size = els.canvas.clientWidth;
    if (!size) return;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 4;
    ctx.clearRect(0, 0, size, size);
    if (!seg.length) return;
    const a = TAU / seg.length;
    for (let i = 0; i < seg.length; i += 1) {
      const start = rotation + i * a;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + a);
      ctx.closePath();
      ctx.fillStyle = segColor(seg[i]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // hub
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.34, 0, TAU);
    ctx.fillStyle = '#121826';
    ctx.fill();
    ctx.strokeStyle = '#232c40';
    ctx.stroke();
  }

  // Rotate so segment `index` rests under the top pointer.
  function spinTo(index, multiplier, payout, bet) {
    const seg = ring();
    const a = TAU / seg.length;
    const pointer = -Math.PI / 2;
    const target = pointer - (index + 0.5) * a;
    const base = rotation % TAU;
    let dest = target;
    while (dest < base) dest += TAU;
    dest += TAU * 5; // a few full spins for flair
    const from = rotation;
    const span = dest - from;
    const dur = 3600;
    let startT = 0;

    function frame(t) {
      if (!startT) startT = t;
      const p = Math.min(1, (t - startT) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      rotation = from + span * ease;
      draw();
      if (p < 1) {
        anim = requestAnimationFrame(frame);
      } else {
        els.spin.disabled = false;
        els.center.textContent = `${multiplier.toFixed(2)}×`;
        els.center.className = 'wheel__center ' + (payout > 0 ? 'is-win' : 'is-lose');
        els.payout.textContent =
          payout >= bet ? `+${formatCoins(payout)}` : `−${formatCoins(bet - payout)}`;
        history.unshift(multiplier);
        if (history.length > 14) history.pop();
        els.history.innerHTML = history
          .map((m) => `<span class="hist" style="color:${segColor(m)}">${m.toFixed(2)}×</span>`)
          .join('');
      }
    }
    cancelAnimationFrame(anim);
    anim = requestAnimationFrame(frame);
  }

  function currentAmount() {
    return Math.max(1, Math.floor(Number(els.betAmount.value) || 0));
  }

  function showError(msg) {
    els.spin.disabled = false;
    els.hint.textContent = msg;
    els.hint.classList.add('is-error');
    setTimeout(() => els.hint.classList.remove('is-error'), 2500);
  }

  const handlers = {
    'wheel:rings': (r) => {
      rings = r;
      resize();
    },
    'wheel:result': (r) => spinTo(r.index, r.multiplier, r.payout, r.bet),
    'wheel:error': (e) => showError(e.message || 'Something went wrong.'),
  };
  Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));

  // ---------- interactions ----------
  container.querySelectorAll('[data-mult]').forEach((b) =>
    b.addEventListener('click', () => {
      els.betAmount.value = String(Math.max(1, Math.floor(currentAmount() * Number(b.dataset.mult))));
    }),
  );
  container.querySelector('[data-max]').addEventListener('click', () => {
    const user = getUser();
    if (user) els.betAmount.value = String(Math.floor(user.balance));
  });
  els.risk.addEventListener('change', draw);

  els.spin.addEventListener('click', () => {
    const user = getUser();
    if (!user) return openModal('login');
    els.spin.disabled = true;
    socket.emit('wheel:spin', { amount: currentAmount(), risk: els.risk.value });
  });

  const onResize = () => resize();
  window.addEventListener('resize', onResize);
  resize();
  socket.emit('wheel:sync'); // rings are emitted on connect; re-request on mount

  return function unmount() {
    Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
    window.removeEventListener('resize', onResize);
    cancelAnimationFrame(anim);
  };
}
