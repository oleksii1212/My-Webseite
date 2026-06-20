// GOLDBET — Roulette game view. One shared, server-authoritative round; this
// module renders the spinning reel, the betting board and the Live Players
// list, and talks to the server over Socket.IO. Mirrors public/js/crash.js.

const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);
const TILE_W = 72; // px per reel tile, including the gap
const REEL_REPEATS = 8; // copies of the wheel laid end-to-end on the track
const LANDING_REPEAT = 6; // which copy we animate the winning tile into

function colorOf(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

// Outside bets shown on the board, in display order.
const OUTSIDE = [
  { type: 'low', label: '1-18' },
  { type: 'even', label: 'EVEN' },
  { type: 'red', label: 'RED', swatch: 'red' },
  { type: 'black', label: 'BLACK', swatch: 'black' },
  { type: 'odd', label: 'ODD' },
  { type: 'high', label: '19-36' },
];

function betKey(type, value) {
  return value === null || value === undefined ? type : `${type}:${value}`;
}

function buildBoard() {
  // 12 columns, top row 3/6/9..., middle 2/5/8..., bottom 1/4/7...
  let cells = '';
  for (let row = 0; row < 3; row++) {
    const offset = 3 - row; // row 0 -> +3 (top), row 2 -> +1 (bottom)
    let rowHtml = '';
    for (let col = 1; col <= 12; col++) {
      const n = (col - 1) * 3 + offset;
      rowHtml += `<button class="rcell is-${colorOf(n)}" data-type="straight" data-value="${n}" data-key="${betKey('straight', n)}">
        ${n}<span class="rcell__chip" hidden></span>
      </button>`;
    }
    cells += `<div class="rboard__row">${rowHtml}</div>`;
  }

  const zero = `<button class="rcell rcell--zero is-green" data-type="straight" data-value="0" data-key="${betKey('straight', 0)}">
    0<span class="rcell__chip" hidden></span>
  </button>`;

  const dozens = [1, 2, 3]
    .map(
      (d) =>
        `<button class="rcell rcell--wide" data-type="dozen" data-value="${d}" data-key="${betKey('dozen', d)}">
          ${d === 1 ? '1st 12' : d === 2 ? '2nd 12' : '3rd 12'}<span class="rcell__chip" hidden></span>
        </button>`,
    )
    .join('');

  const outside = OUTSIDE.map(
    (o) =>
      `<button class="rcell rcell--wide${o.swatch ? ' is-' + o.swatch : ''}" data-type="${o.type}" data-key="${betKey(o.type, null)}">
        ${o.label}<span class="rcell__chip" hidden></span>
      </button>`,
  ).join('');

  return `
    <div class="rboard">
      <div class="rboard__numbers">
        <div class="rboard__zero">${zero}</div>
        <div class="rboard__grid">${cells}</div>
      </div>
      <div class="rboard__row rboard__dozens">${dozens}</div>
      <div class="rboard__row rboard__outside">${outside}</div>
    </div>
  `;
}

const TEMPLATE = `
  <div class="roul">
    <div class="roul__main">
      <div class="roul__history" id="roulHistory"></div>

      <div class="roul__reel" id="roulReel">
        <div class="roul__pointer"></div>
        <div class="roul__track" id="roulTrack"></div>
        <div class="roul__result" id="roulResult"></div>
      </div>

      <div class="roul__status">
        <span class="roul__phase" id="roulPhase">Connecting…</span>
        <span class="roul__fair" id="roulFair"></span>
      </div>

      ${buildBoard()}

      <div class="betpanel">
        <div class="betpanel__grid">
          <label class="betpanel__field">
            <span>Chip / bet amount</span>
            <div class="betpanel__amount">
              <input id="roulAmount" type="number" min="1" step="1" value="10" />
              <button type="button" class="chip" data-mult="0.5">½</button>
              <button type="button" class="chip" data-mult="2">2×</button>
              <button type="button" class="chip" data-max>Max</button>
            </div>
          </label>
          <label class="betpanel__field">
            <span>Total staked</span>
            <input id="roulStaked" type="text" value="0.00" readonly />
          </label>
        </div>
        <button class="btn btn--ghost betpanel__action" id="roulClear">Clear bets</button>
        <p class="betpanel__hint" id="roulHint">Click a number or an outside bet to place a chip.</p>
      </div>
    </div>

    <aside class="crash__side">
      <div class="crash__side-head">
        <span class="crash__side-title">👥 Live Players</span>
        <span class="crash__count" id="roulCount">0</span>
      </div>
      <div class="crash__totals">
        <span>Total staked</span>
        <span id="roulTotal">0.00</span>
      </div>
      <div class="roul__thead">
        <span>Player</span>
        <span>Staked</span>
        <span>Result</span>
      </div>
      <div class="crash__players" id="roulPlayers"></div>
    </aside>
  </div>
`;

export function mountRoulette(container, deps) {
  const { socket, getUser, formatCoins, openModal } = deps;
  container.innerHTML = TEMPLATE;

  const els = {
    history: container.querySelector('#roulHistory'),
    reel: container.querySelector('#roulReel'),
    track: container.querySelector('#roulTrack'),
    result: container.querySelector('#roulResult'),
    phase: container.querySelector('#roulPhase'),
    fair: container.querySelector('#roulFair'),
    amount: container.querySelector('#roulAmount'),
    staked: container.querySelector('#roulStaked'),
    clear: container.querySelector('#roulClear'),
    hint: container.querySelector('#roulHint'),
    count: container.querySelector('#roulCount'),
    total: container.querySelector('#roulTotal'),
    players: container.querySelector('#roulPlayers'),
    board: container.querySelector('.rboard'),
    cells: [...container.querySelectorAll('.rcell')],
  };

  const view = {
    phase: 'idle',
    history: [],
    players: [],
    myBets: [],
    myStaked: 0,
    countdownTimer: 0,
    phaseRemainingMs: 0,
  };

  // ---------- reel ----------
  function buildTrack() {
    let html = '';
    for (let r = 0; r < REEL_REPEATS; r++) {
      for (const n of WHEEL_ORDER) {
        html += `<div class="rt is-${colorOf(n)}">${n}</div>`;
      }
    }
    els.track.innerHTML = html;
  }

  function trackTo(number, animate, durationMs) {
    const idxInWheel = WHEEL_ORDER.indexOf(number);
    const tileIndex = LANDING_REPEAT * WHEEL_ORDER.length + idxInWheel;
    const center = els.reel.clientWidth / 2;
    const jitter = animate ? (Math.random() - 0.5) * (TILE_W * 0.55) : 0;
    const x = center - (tileIndex * TILE_W + TILE_W / 2) + jitter;
    els.track.style.transition = animate
      ? `transform ${durationMs}ms cubic-bezier(0.08, 0.62, 0.12, 1)`
      : 'none';
    els.track.style.transform = `translateX(${x}px)`;
  }

  function resetReel() {
    // Snap (no animation) to an early copy so the next spin animates forward.
    const center = els.reel.clientWidth / 2;
    const x = center - (1 * WHEEL_ORDER.length * TILE_W + TILE_W / 2);
    els.track.style.transition = 'none';
    els.track.style.transform = `translateX(${x}px)`;
  }

  // ---------- rendering ----------
  function historyClass(n) {
    return `is-${colorOf(n)}`;
  }

  function renderHistory() {
    els.history.innerHTML = view.history
      .map((n) => `<span class="rhist ${historyClass(n)}">${n}</span>`)
      .join('');
  }

  function renderPlayers() {
    const user = getUser();
    els.count.textContent = String(view.players.length);
    const total = view.players.reduce((s, p) => s + p.staked, 0);
    els.total.textContent = formatCoins(total);

    if (view.players.length === 0) {
      els.players.innerHTML = '<div class="crash__empty">No bets yet — be the first!</div>';
      return;
    }
    els.players.innerHTML = view.players
      .map((p) => {
        const mine = user && p.username === user.username ? ' is-mine' : '';
        let cls = 'is-in';
        let resultCell = `${p.betCount} bet${p.betCount === 1 ? '' : 's'}`;
        if (p.settled) {
          if (p.net > 0) {
            cls = 'is-won';
            resultCell = `+${formatCoins(p.net)}`;
          } else if (p.net < 0) {
            cls = 'is-lost';
            resultCell = `−${formatCoins(-p.net)}`;
          } else {
            resultCell = '±0.00';
          }
        }
        return `
          <div class="rprow ${cls}${mine}">
            <span class="prow__name">${escapeHtml(p.username)}</span>
            <span>${formatCoins(p.staked)}</span>
            <span class="prow__cash">${resultCell}</span>
          </div>`;
      })
      .join('');
  }

  function renderMyBets() {
    const byKey = new Map();
    for (const b of view.myBets) byKey.set(betKey(b.type, b.value), b.amount);
    for (const cell of els.cells) {
      const chip = cell.querySelector('.rcell__chip');
      const amt = byKey.get(cell.dataset.key);
      if (amt) {
        chip.textContent = amt >= 1000 ? `${Math.round(amt / 100) / 10}k` : amt;
        chip.hidden = false;
      } else {
        chip.hidden = true;
      }
    }
    els.staked.value = formatCoins(view.myStaked);
    els.clear.disabled = view.phase !== 'betting' || view.myStaked === 0;
  }

  function setPhase(text, cls) {
    els.phase.textContent = text;
    els.phase.className = 'roul__phase' + (cls ? ' ' + cls : '');
  }

  function setBoardLocked(locked) {
    els.board.classList.toggle('is-locked', locked);
  }

  function highlightWinner(number) {
    els.cells.forEach((c) => c.classList.remove('is-winner'));
    if (number === null || number === undefined) return;
    const cell = els.cells.find(
      (c) => c.dataset.type === 'straight' && Number(c.dataset.value) === number,
    );
    if (cell) cell.classList.add('is-winner');
  }

  function showResult(number) {
    const c = colorOf(number);
    els.result.textContent = number;
    els.result.className = `roul__result is-show is-${c}`;
  }
  function hideResult() {
    els.result.className = 'roul__result';
  }

  // ---------- countdown ----------
  function startCountdown(remainingMs) {
    clearInterval(view.countdownTimer);
    view.phaseRemainingMs = remainingMs;
    const tick = () => {
      const secs = Math.max(0, view.phaseRemainingMs / 1000);
      setPhase(`Place your bets · ${secs.toFixed(1)}s`, 'is-betting');
      view.phaseRemainingMs -= 100;
      if (view.phaseRemainingMs < -200) clearInterval(view.countdownTimer);
    };
    tick();
    view.countdownTimer = setInterval(tick, 100);
  }

  function shortHash(h) {
    return h ? `fair: ${h.slice(0, 10)}…` : '';
  }

  // ---------- socket events ----------
  function applyState(s) {
    view.phase = s.phase;
    view.players = s.players || [];
    view.history = s.history || [];
    renderHistory();
    renderPlayers();

    if (s.phase === 'betting') {
      setBoardLocked(false);
      hideResult();
      highlightWinner(null);
      resetReel();
      startCountdown(s.phaseRemainingMs ?? 0);
      els.fair.textContent = shortHash(s.hash);
    } else if (s.phase === 'spinning') {
      clearInterval(view.countdownTimer);
      setBoardLocked(true);
      setPhase('Spinning…', 'is-spinning');
      hideResult();
      // Land near the end of the remaining spin window.
      trackTo(s.winningNumber, true, Math.max(800, s.phaseRemainingMs ?? 1500));
    } else if (s.phase === 'result') {
      clearInterval(view.countdownTimer);
      setBoardLocked(true);
      trackTo(s.winningNumber, false, 0);
      showResult(s.winningNumber);
      highlightWinner(s.winningNumber);
      setPhase(`Result: ${s.winningNumber} ${colorOf(s.winningNumber)}`, `is-${colorOf(s.winningNumber)}`);
      els.fair.textContent = s.serverSeed ? `seed: ${s.serverSeed.slice(0, 10)}…` : '';
    }
    renderMyBets();
  }

  const handlers = {
    'roulette:state': applyState,
    'roulette:betting': (b) => {
      view.phase = 'betting';
      view.players = [];
      view.myBets = [];
      view.myStaked = 0;
      view.history = b.history || view.history;
      setBoardLocked(false);
      hideResult();
      highlightWinner(null);
      resetReel();
      renderHistory();
      renderPlayers();
      renderMyBets();
      startCountdown(b.phaseRemainingMs ?? b.durationMs ?? 0);
      els.fair.textContent = shortHash(b.hash);
    },
    'roulette:spinning': (s) => {
      view.phase = 'spinning';
      clearInterval(view.countdownTimer);
      setBoardLocked(true);
      setPhase('Spinning…', 'is-spinning');
      hideResult();
      trackTo(s.winningNumber, true, s.durationMs);
    },
    'roulette:result': (r) => {
      view.phase = 'result';
      setBoardLocked(true);
      showResult(r.winningNumber);
      highlightWinner(r.winningNumber);
      setPhase(`Result: ${r.winningNumber} ${r.color}`, `is-${r.color}`);
      els.fair.textContent = r.serverSeed ? `seed: ${r.serverSeed.slice(0, 10)}…` : '';
      view.history = [r.winningNumber, ...view.history].slice(0, 18);
      renderHistory();
    },
    'roulette:players': (p) => {
      view.players = p.players || [];
      renderPlayers();
    },
    'roulette:mybets': (m) => {
      view.myBets = m.bets || [];
      view.myStaked = m.staked || 0;
      renderMyBets();
    },
    'roulette:error': (e) => {
      els.hint.textContent = e.message || 'Something went wrong.';
      els.hint.classList.add('is-error');
      setTimeout(() => els.hint.classList.remove('is-error'), 2500);
    },
  };

  Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
  socket.emit('roulette:sync');

  // ---------- interactions ----------
  function currentAmount() {
    return Math.max(1, Math.floor(Number(els.amount.value) || 0));
  }

  container.querySelectorAll('[data-mult]').forEach((b) =>
    b.addEventListener('click', () => {
      const f = Number(b.dataset.mult);
      els.amount.value = String(Math.max(1, Math.floor(currentAmount() * f)));
    }),
  );
  container.querySelector('[data-max]').addEventListener('click', () => {
    const user = getUser();
    if (user) els.amount.value = String(Math.floor(user.balance));
  });

  els.cells.forEach((cell) =>
    cell.addEventListener('click', () => {
      const user = getUser();
      if (!user) return openModal('login');
      if (view.phase !== 'betting') {
        els.hint.textContent = 'Betting is closed — wait for the next round.';
        els.hint.classList.add('is-error');
        setTimeout(() => els.hint.classList.remove('is-error'), 2000);
        return;
      }
      const payload = { type: cell.dataset.type, amount: currentAmount() };
      if (cell.dataset.value !== undefined) payload.value = Number(cell.dataset.value);
      socket.emit('roulette:bet', payload);
    }),
  );

  els.clear.addEventListener('click', () => socket.emit('roulette:clear'));

  const onResize = () => {
    if (view.phase === 'result') trackTo(view.history[0] ?? 0, false, 0);
    else resetReel();
  };
  window.addEventListener('resize', onResize);

  buildTrack();
  resetReel();
  renderMyBets();

  // ---------- cleanup ----------
  return function unmount() {
    Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
    window.removeEventListener('resize', onResize);
    clearInterval(view.countdownTimer);
  };
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
