// GOLDBET — Plinko view. Drop a ball through a peg pyramid; it bounces into a
// multiplier bucket. The path and bucket are decided server-side (provably
// fair); this view just animates the ball down the chosen path.

const TEMPLATE = `
  <div class="game game--plinko">
    <div class="game__main">
      <div class="plinko__board">
        <canvas id="plinkoCanvas"></canvas>
      </div>
      <div class="plinko__buckets" id="plinkoBuckets"></div>
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
            <select id="plinkoRisk">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label class="betpanel__field">
            <span>Rows</span>
            <select id="plinkoRows">
              <option value="8">8</option>
              <option value="12" selected>12</option>
              <option value="16">16</option>
            </select>
          </label>
        </div>
        <button class="btn btn--primary betpanel__action" id="dropBtn">Drop ball</button>
        <p class="betpanel__hint" id="hint"></p>
      </div>
    </div>

    <aside class="game__side">
      <div class="game__side-head"><span class="game__side-title">Last drops</span></div>
      <div class="game__history" id="plinkoHistory"></div>
      <div class="game__stat"><span>Last payout</span><span id="plinkoPayout">—</span></div>
    </aside>
  </div>
`;

export function mountPlinko(container, deps) {
  const { socket, getUser, formatCoins, openModal } = deps;
  container.innerHTML = TEMPLATE;

  const els = {
    board: container.querySelector('.plinko__board'),
    canvas: container.querySelector('#plinkoCanvas'),
    buckets: container.querySelector('#plinkoBuckets'),
    betAmount: container.querySelector('#betAmount'),
    risk: container.querySelector('#plinkoRisk'),
    rows: container.querySelector('#plinkoRows'),
    drop: container.querySelector('#dropBtn'),
    hint: container.querySelector('#hint'),
    history: container.querySelector('#plinkoHistory'),
    payout: container.querySelector('#plinkoPayout'),
  };
  const ctx = els.canvas.getContext('2d');

  let tables = null;
  const history = [];
  let anim = 0;

  function rows() {
    return Number(els.rows.value);
  }
  function risk() {
    return els.risk.value;
  }
  function multipliers() {
    return tables ? tables[rows()][risk()] : [];
  }

  function bucketClass(m) {
    if (m >= 10) return 'is-huge';
    if (m >= 2) return 'is-high';
    if (m >= 1) return 'is-mid';
    return 'is-low';
  }

  function renderBuckets(activeIndex = -1) {
    const mults = multipliers();
    els.buckets.style.gridTemplateColumns = `repeat(${mults.length}, 1fr)`;
    els.buckets.innerHTML = mults
      .map(
        (m, i) =>
          `<span class="plinko__bucket ${bucketClass(m)}${i === activeIndex ? ' is-active' : ''}">${m.toFixed(m >= 10 ? 0 : 1)}×</span>`,
      )
      .join('');
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = els.board.clientWidth;
    const h = els.board.clientHeight;
    els.canvas.width = Math.max(1, Math.floor(w * dpr));
    els.canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPegs();
  }

  function drawPegs(ball = null) {
    const R = rows();
    const w = els.board.clientWidth;
    const h = els.board.clientHeight;
    const cellW = w / (R + 1);
    const topPad = 14;
    const rowH = (h - topPad - 10) / R;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (let r = 0; r < R; r += 1) {
      const pegs = r + 2;
      const y = topPad + r * rowH;
      const startX = (w - (pegs - 1) * cellW) / 2;
      for (let p = 0; p < pegs; p += 1) {
        ctx.beginPath();
        ctx.arc(startX + p * cellW, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (ball) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#f5b301';
      ctx.shadowColor = '#f5b301';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function animateDrop(path, bucket, onDone) {
    const R = path.length;
    const w = els.board.clientWidth;
    const h = els.board.clientHeight;
    const cellW = w / (R + 1);
    const topPad = 14;
    const rowH = (h - topPad - 10) / R;

    // Ball x after k bounces: center + (2 * rightsSoFar − k) * cellW / 2.
    const xs = [w / 2];
    let rs = 0;
    for (let k = 1; k <= R; k += 1) {
      rs += path[k - 1];
      xs[k] = w / 2 + ((2 * rs - k) * cellW) / 2;
    }

    const stepMs = 90;
    let step = 0;
    let startT = 0;

    function frame(t) {
      if (!startT) startT = t;
      const elapsed = t - startT;
      const f = Math.min(1, elapsed / stepMs);
      const x = xs[step] + (xs[step + 1] - xs[step]) * f;
      const y = topPad + (step + f) * rowH;
      drawPegs({ x, y });
      if (f >= 1) {
        step += 1;
        startT = 0;
        if (step >= R) {
          drawPegs({ x: cellW * (bucket + 0.5), y: topPad + R * rowH });
          onDone();
          return;
        }
      }
      anim = requestAnimationFrame(frame);
    }
    cancelAnimationFrame(anim);
    anim = requestAnimationFrame(frame);
  }

  function currentAmount() {
    return Math.max(1, Math.floor(Number(els.betAmount.value) || 0));
  }

  function showError(msg) {
    els.hint.textContent = msg;
    els.hint.classList.add('is-error');
    setTimeout(() => els.hint.classList.remove('is-error'), 2500);
  }

  const handlers = {
    'plinko:tables': (t) => {
      tables = t;
      renderBuckets();
      resizeCanvas();
    },
    'plinko:result': (r) => {
      animateDrop(r.path, r.bucket, () => {
        els.drop.disabled = false;
        renderBuckets(r.bucket);
        els.payout.textContent =
          r.payout >= r.bet ? `+${formatCoins(r.payout)}` : `−${formatCoins(r.bet - r.payout)}`;
        history.unshift(r.multiplier);
        if (history.length > 14) history.pop();
        els.history.innerHTML = history
          .map((m) => `<span class="hist ${bucketClass(m)}">${m.toFixed(m >= 10 ? 0 : 1)}×</span>`)
          .join('');
      });
    },
    'plinko:error': (e) => {
      els.drop.disabled = false;
      showError(e.message || 'Something went wrong.');
    },
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

  els.rows.addEventListener('change', () => {
    renderBuckets();
    drawPegs();
  });
  els.risk.addEventListener('change', () => renderBuckets());

  els.drop.addEventListener('click', () => {
    const user = getUser();
    if (!user) return openModal('login');
    els.drop.disabled = true;
    socket.emit('plinko:drop', { amount: currentAmount(), rows: rows(), risk: risk() });
  });

  const onResize = () => resizeCanvas();
  window.addEventListener('resize', onResize);
  resizeCanvas();
  renderBuckets();
  socket.emit('plinko:sync'); // tables are emitted on connect; re-request on mount

  return function unmount() {
    Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
    window.removeEventListener('resize', onResize);
    cancelAnimationFrame(anim);
  };
}
