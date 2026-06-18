// GOLDBET — Crash game view. One shared, server-authoritative round; this
// module renders the multiplier graph, the bet panel and the Live Players list,
// and talks to the server over Socket.IO.

// Must match config.crash.growthRatePerMs on the server so the local animation
// tracks the authoritative multiplier between ticks.
const GROWTH_RATE_PER_MS = 0.00012;

const TEMPLATE = `
  <div class="crash">
    <div class="crash__main">
      <div class="crash__history" id="crashHistory"></div>
      <div class="crash__graph" id="crashGraph">
        <canvas id="crashCanvas"></canvas>
        <div class="crash__overlay">
          <div class="crash__multiplier" id="crashMultiplier">1.00x</div>
          <div class="crash__phase" id="crashPhase">Connecting…</div>
        </div>
      </div>
      <div class="betpanel" id="betPanel">
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
            <span>Auto cash out</span>
            <input id="autoCashout" type="number" step="0.1" min="1.01" placeholder="off" />
          </label>
        </div>
        <button class="btn betpanel__action" id="betAction">Place bet</button>
        <p class="betpanel__hint" id="betHint"></p>
      </div>
    </div>

    <aside class="crash__side">
      <div class="crash__side-head">
        <span class="crash__side-title">👥 Live Players</span>
        <span class="crash__count" id="crashCount">0</span>
      </div>
      <div class="crash__totals">
        <span>Total bet</span>
        <span id="crashTotal">0.00</span>
      </div>
      <div class="crash__thead">
        <span>Player</span>
        <span>Bet</span>
        <span>Mult.</span>
        <span>Cash out</span>
      </div>
      <div class="crash__players" id="crashPlayers"></div>
    </aside>
  </div>
`;

export function mountCrash(container, deps) {
  const { socket, getUser, formatCoins, openModal } = deps;
  container.innerHTML = TEMPLATE;

  const els = {
    history: container.querySelector('#crashHistory'),
    graph: container.querySelector('#crashGraph'),
    canvas: container.querySelector('#crashCanvas'),
    multiplier: container.querySelector('#crashMultiplier'),
    phase: container.querySelector('#crashPhase'),
    panel: container.querySelector('#betPanel'),
    betAmount: container.querySelector('#betAmount'),
    autoCashout: container.querySelector('#autoCashout'),
    action: container.querySelector('#betAction'),
    hint: container.querySelector('#betHint'),
    count: container.querySelector('#crashCount'),
    total: container.querySelector('#crashTotal'),
    players: container.querySelector('#crashPlayers'),
  };
  const ctx = els.canvas.getContext('2d');

  // ---------- local view state ----------
  const view = {
    phase: 'idle',
    multiplier: 1.0,
    crashPoint: null,
    players: [],
    history: [],
    runStart: 0, // performance.now() reference for the running curve
    raf: 0,
    countdownTimer: 0,
    phaseRemainingMs: 0,
  };

  function myBet() {
    const user = getUser();
    if (!user) return null;
    return view.players.find((p) => p.username === user.username) || null;
  }

  // ---------- rendering helpers ----------
  function historyClass(point) {
    if (point < 1.5) return 'is-low';
    if (point < 2) return 'is-mid';
    if (point >= 10) return 'is-huge';
    return 'is-high';
  }

  function renderHistory() {
    els.history.innerHTML = view.history
      .map((p) => `<span class="hist ${historyClass(p)}">${p.toFixed(2)}×</span>`)
      .join('');
  }

  function renderPlayers() {
    const user = getUser();
    els.count.textContent = String(view.players.length);
    const total = view.players.reduce((s, p) => s + p.amount, 0);
    els.total.textContent = formatCoins(total);

    if (view.players.length === 0) {
      els.players.innerHTML = '<div class="crash__empty">No bets yet — be the first!</div>';
      return;
    }
    els.players.innerHTML = view.players
      .map((p) => {
        const mine = user && p.username === user.username ? ' is-mine' : '';
        let statusClass = 'is-in';
        let cashCell = '—';
        let multCell = '—';
        if (p.status === 'won') {
          statusClass = 'is-won';
          multCell = `${p.cashedOutAt.toFixed(2)}×`;
          cashCell = `+${formatCoins(p.payout)}`;
        } else if (p.status === 'lost') {
          statusClass = 'is-lost';
          cashCell = `−${formatCoins(p.amount)}`;
        }
        return `
          <div class="prow ${statusClass}${mine}">
            <span class="prow__name">${escapeHtml(p.username)}</span>
            <span class="prow__bet">${formatCoins(p.amount)}</span>
            <span class="prow__mult">${multCell}</span>
            <span class="prow__cash">${cashCell}</span>
          </div>`;
      })
      .join('');
  }

  function setPhaseText(text, cls) {
    els.phase.textContent = text;
    els.phase.className = 'crash__phase' + (cls ? ' ' + cls : '');
  }

  function renderMultiplier() {
    els.multiplier.textContent = `${view.multiplier.toFixed(2)}×`;
  }

  function renderAction() {
    const user = getUser();
    const btn = els.action;
    btn.disabled = false;
    btn.className = 'btn betpanel__action';
    els.hint.textContent = '';

    if (!user) {
      btn.textContent = 'Log in to play';
      btn.classList.add('btn--ghost');
      return;
    }

    const bet = myBet();
    if (view.phase === 'betting') {
      if (bet) {
        btn.textContent = 'Cancel bet';
        btn.classList.add('btn--danger');
      } else {
        btn.textContent = 'Place bet';
        btn.classList.add('btn--primary');
      }
    } else if (view.phase === 'running') {
      if (bet && bet.status === 'in') {
        const potential = Math.floor(bet.amount * view.multiplier);
        btn.textContent = `Cash out  ${formatCoins(potential)}`;
        btn.classList.add('btn--gold');
      } else if (bet && bet.status === 'won') {
        btn.textContent = `Cashed out @ ${bet.cashedOutAt.toFixed(2)}×`;
        btn.classList.add('btn--ghost');
        btn.disabled = true;
      } else {
        btn.textContent = 'Round in progress';
        btn.classList.add('btn--ghost');
        btn.disabled = true;
      }
    } else {
      // crashed / idle
      btn.textContent = 'Waiting for next round';
      btn.classList.add('btn--ghost');
      btn.disabled = true;
    }
  }

  // ---------- canvas graph ----------
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = els.graph.clientWidth;
    const h = els.graph.clientHeight;
    els.canvas.width = Math.max(1, Math.floor(w * dpr));
    els.canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGraph();
  }

  function drawGraph() {
    const w = els.graph.clientWidth;
    const h = els.graph.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const crashed = view.phase === 'crashed';
    const stroke = crashed ? '#ff5c5c' : '#00e08a';

    // dynamic scale
    const elapsed =
      view.phase === 'running' ? performance.now() - view.runStart : crashed ? lastElapsed : 0;
    const elapsedSec = Math.max(0.0001, elapsed / 1000);
    const m = view.multiplier;
    const yMax = Math.max(2, m * 1.25);
    const xMax = Math.max(6, elapsedSec * 1.15);

    const padL = 6;
    const padB = 6;
    const plotW = w - padL;
    const plotH = h - padB;
    const xOf = (sec) => padL + (sec / xMax) * plotW;
    const yOf = (mult) => h - padB - ((mult - 1) / (yMax - 1)) * plotH;

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const gy = (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    if (view.phase === 'running' || crashed) {
      // build curve points
      const pts = [];
      const steps = 60;
      for (let i = 0; i <= steps; i++) {
        const sec = (elapsedSec * i) / steps;
        const mult = Math.exp(GROWTH_RATE_PER_MS * sec * 1000);
        pts.push([xOf(sec), yOf(Math.min(mult, m))]);
      }

      // filled area
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, crashed ? 'rgba(255,92,92,0.30)' : 'rgba(0,224,138,0.30)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.moveTo(pts[0][0], h - padB);
      pts.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(pts[pts.length - 1][0], h - padB);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // line
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // glowing tip
      const tip = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(tip[0], tip[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = stroke;
      ctx.shadowColor = stroke;
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  let lastElapsed = 0;

  function loop() {
    if (view.phase === 'running') {
      const elapsed = performance.now() - view.runStart;
      lastElapsed = elapsed;
      view.multiplier = Math.floor(100 * Math.exp(GROWTH_RATE_PER_MS * elapsed)) / 100;
      renderMultiplier();
      // refresh cash-out potential live
      const bet = myBet();
      if (bet && bet.status === 'in') renderAction();
      drawGraph();
      view.raf = requestAnimationFrame(loop);
    }
  }

  function startLoop() {
    cancelAnimationFrame(view.raf);
    view.raf = requestAnimationFrame(loop);
  }

  function syncRunStart(serverMultiplier) {
    const elapsedMs = Math.log(Math.max(1, serverMultiplier)) / GROWTH_RATE_PER_MS;
    view.runStart = performance.now() - elapsedMs;
  }

  // ---------- countdown during betting ----------
  function startCountdown(remainingMs) {
    clearInterval(view.countdownTimer);
    view.phaseRemainingMs = remainingMs;
    const tick = () => {
      const secs = Math.max(0, view.phaseRemainingMs / 1000);
      setPhaseText(`Starting in ${secs.toFixed(1)}s`, 'is-betting');
      view.phaseRemainingMs -= 100;
      if (view.phaseRemainingMs < -200) clearInterval(view.countdownTimer);
    };
    tick();
    view.countdownTimer = setInterval(tick, 100);
  }

  // ---------- socket events ----------
  function applyState(s) {
    view.phase = s.phase;
    view.players = s.players || [];
    view.history = s.history || [];
    view.multiplier = s.multiplier || 1.0;
    renderHistory();
    renderPlayers();
    renderMultiplier();

    if (s.phase === 'betting') {
      startCountdown(s.phaseRemainingMs ?? s.bettingMs ?? 0);
      drawGraph();
    } else if (s.phase === 'running') {
      clearInterval(view.countdownTimer);
      setPhaseText('Round live', 'is-running');
      view.runStart = performance.now() - (s.elapsedMs || 0);
      startLoop();
    } else if (s.phase === 'crashed') {
      clearInterval(view.countdownTimer);
      cancelAnimationFrame(view.raf);
      view.crashPoint = s.crashPoint;
      if (s.crashPoint) view.multiplier = s.crashPoint;
      renderMultiplier();
      setPhaseText(`Crashed @ ${(s.crashPoint || 0).toFixed(2)}×`, 'is-crashed');
      drawGraph();
    }
    renderAction();
  }

  const handlers = {
    'crash:state': applyState,
    'crash:betting': (b) => {
      view.phase = 'betting';
      view.players = [];
      view.history = b.history || view.history;
      view.multiplier = 1.0;
      view.crashPoint = null;
      cancelAnimationFrame(view.raf);
      renderHistory();
      renderPlayers();
      renderMultiplier();
      startCountdown(b.phaseRemainingMs ?? b.durationMs ?? 0);
      drawGraph();
      renderAction();
    },
    'crash:running': () => {
      view.phase = 'running';
      clearInterval(view.countdownTimer);
      view.runStart = performance.now();
      view.multiplier = 1.0;
      setPhaseText('Round live', 'is-running');
      startLoop();
      renderAction();
    },
    'crash:tick': (t) => {
      view.multiplier = t.multiplier;
      syncRunStart(t.multiplier);
    },
    'crash:crashed': (c) => {
      view.phase = 'crashed';
      view.crashPoint = c.crashPoint;
      view.multiplier = c.crashPoint;
      cancelAnimationFrame(view.raf);
      renderMultiplier();
      setPhaseText(`Crashed @ ${c.crashPoint.toFixed(2)}×`, 'is-crashed');
      drawGraph();
      renderAction();
    },
    'crash:players': (p) => {
      view.players = p.players || [];
      renderPlayers();
      renderAction();
    },
    'crash:error': (e) => {
      els.hint.textContent = e.message || 'Something went wrong.';
      els.hint.classList.add('is-error');
      setTimeout(() => els.hint.classList.remove('is-error'), 2500);
    },
  };

  Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
  // We likely mounted after the socket connected, so request a fresh snapshot.
  socket.emit('crash:sync');

  // ---------- user interactions ----------
  function currentAmount() {
    return Math.max(1, Math.floor(Number(els.betAmount.value) || 0));
  }

  els.panel.querySelectorAll('[data-mult]').forEach((b) =>
    b.addEventListener('click', () => {
      const f = Number(b.dataset.mult);
      els.betAmount.value = String(Math.max(1, Math.floor(currentAmount() * f)));
    }),
  );
  els.panel.querySelector('[data-max]').addEventListener('click', () => {
    const user = getUser();
    if (user) els.betAmount.value = String(Math.floor(user.balance));
  });

  els.action.addEventListener('click', () => {
    const user = getUser();
    if (!user) return openModal('login');
    const bet = myBet();
    if (view.phase === 'betting') {
      if (bet) socket.emit('crash:cancel');
      else
        socket.emit('crash:bet', {
          amount: currentAmount(),
          autoCashout: els.autoCashout.value.trim() || null,
        });
    } else if (view.phase === 'running' && bet && bet.status === 'in') {
      socket.emit('crash:cashout');
    }
  });

  const onResize = () => resizeCanvas();
  window.addEventListener('resize', onResize);
  resizeCanvas();
  renderAction();

  // ---------- cleanup ----------
  return function unmount() {
    Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
    window.removeEventListener('resize', onResize);
    cancelAnimationFrame(view.raf);
    clearInterval(view.countdownTimer);
  };
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
