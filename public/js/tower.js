// GOLDBET — Tower view. Climb row by row: one safe pick per row advances you up
// and raises the multiplier, a wrong pick ends the run. Cash out any time. The
// safe tiles are fixed server-side from a provably-fair seed.

const TEMPLATE = `
  <div class="game game--tower">
    <div class="game__main">
      <div class="tower__board" id="towerBoard"></div>
      <div class="betpanel">
        <div class="tower__diff" id="towerDiff">
          <button type="button" class="tower__diffbtn" data-diff="easy">Easy</button>
          <button type="button" class="tower__diffbtn is-active" data-diff="medium">Medium</button>
          <button type="button" class="tower__diffbtn" data-diff="hard">Hard</button>
        </div>
        <label class="betpanel__field">
          <span>Bet amount</span>
          <div class="betpanel__amount">
            <input id="betAmount" type="number" min="1" step="1" value="10" />
            <button type="button" class="chip" data-mult="0.5">½</button>
            <button type="button" class="chip" data-mult="2">2×</button>
            <button type="button" class="chip" data-max>Max</button>
          </div>
        </label>
        <button class="btn btn--primary betpanel__action" id="actionBtn">Start game</button>
        <p class="betpanel__hint" id="hint"></p>
      </div>
    </div>

    <aside class="game__side">
      <div class="game__side-head"><span class="game__side-title">Round</span></div>
      <div class="game__stat"><span>Status</span><span id="towerStatus">Set your bet</span></div>
      <div class="game__stat"><span>Current multiplier</span><span id="towerMult">—</span></div>
      <div class="game__stat"><span>Cash out</span><span id="towerPayout">—</span></div>
    </aside>
  </div>
`;

export function mountTower(container, deps) {
  const { socket, getUser, formatCoins, openModal } = deps;
  container.innerHTML = TEMPLATE;

  const els = {
    board: container.querySelector('#towerBoard'),
    betAmount: container.querySelector('#betAmount'),
    action: container.querySelector('#actionBtn'),
    hint: container.querySelector('#hint'),
    status: container.querySelector('#towerStatus'),
    mult: container.querySelector('#towerMult'),
    payout: container.querySelector('#towerPayout'),
    diffBtns: [...container.querySelectorAll('.tower__diffbtn')],
  };

  const game = { active: false, bet: 0, rows: 0, cols: 0, row: 0, multipliers: [], multiplier: 0 };
  let difficulty = 'medium';

  function currentAmount() {
    return Math.max(1, Math.floor(Number(els.betAmount.value) || 0));
  }

  function showError(msg) {
    els.hint.textContent = msg;
    els.hint.classList.add('is-error');
    setTimeout(() => els.hint.classList.remove('is-error'), 2500);
  }

  // Render the tower top-down (highest row first), highlighting the active row.
  function renderBoard() {
    let html = '';
    for (let r = game.rows - 1; r >= 0; r -= 1) {
      const stateCls = r < game.row ? 'is-cleared' : r === game.row && game.active ? 'is-active' : '';
      let cells = '';
      for (let c = 0; c < game.cols; c += 1) {
        cells += `<button class="tower__tile" data-row="${r}" data-col="${c}"></button>`;
      }
      html += `<div class="tower__row ${stateCls}" data-row="${r}">
        <span class="tower__mult">${game.multipliers[r] ? game.multipliers[r].toFixed(2) + '×' : ''}</span>
        <div class="tower__tiles">${cells}</div>
      </div>`;
    }
    els.board.innerHTML = html;
  }

  function renderAction() {
    if (game.active) {
      const payout = Math.floor(game.bet * game.multiplier);
      els.action.textContent = game.multiplier > 0 ? `Cash out  ${formatCoins(payout)}` : 'Pick a tile';
      els.action.className = 'btn betpanel__action ' + (game.multiplier > 0 ? 'btn--gold' : 'btn--ghost');
      els.action.disabled = game.multiplier <= 0;
    } else {
      els.action.textContent = 'Start game';
      els.action.className = 'btn btn--primary betpanel__action';
      els.action.disabled = false;
    }
  }

  function setControls(active) {
    game.active = active;
    els.betAmount.disabled = active;
    els.diffBtns.forEach((b) => (b.disabled = active));
  }

  const handlers = {
    'tower:started': (s) => {
      game.bet = s.bet;
      game.rows = s.rows;
      game.cols = s.cols;
      game.row = 0;
      game.multiplier = 0;
      game.multipliers = s.multipliers;
      setControls(true);
      renderBoard();
      els.status.textContent = 'Climbing — pick a tile';
      els.mult.textContent = '1.00×';
      els.payout.textContent = '—';
      renderAction();
    },
    'tower:advance': (s) => {
      const row = els.board.querySelector(`.tower__row[data-row="${s.row}"]`);
      if (row) {
        const tile = row.querySelector(`.tower__tile[data-col="${s.col}"]`);
        if (tile) tile.classList.add('is-safe');
      }
      game.row = s.nextRow;
      game.multiplier = s.multiplier;
      els.mult.textContent = `${s.multiplier.toFixed(2)}×`;
      els.payout.textContent = formatCoins(Math.floor(game.bet * s.multiplier));
      renderBoard();
      // Re-mark cleared safe tiles after re-render.
      renderAction();
    },
    'tower:over': (s) => {
      setControls(false);
      // Reveal the full board layout.
      els.board.querySelectorAll('.tower__row').forEach((rowEl) => {
        const r = Number(rowEl.dataset.row);
        const bad = new Set(s.board[r] || []);
        rowEl.querySelectorAll('.tower__tile').forEach((tile) => {
          const c = Number(tile.dataset.col);
          tile.classList.add(bad.has(c) ? 'is-bad' : 'is-good');
        });
      });
      if (s.busted) {
        const rowEl = els.board.querySelector(`.tower__row[data-row="${s.bustRow}"]`);
        if (rowEl && s.hitCol !== null) {
          const tile = rowEl.querySelector(`.tower__tile[data-col="${s.hitCol}"]`);
          if (tile) tile.classList.add('is-hit');
        }
        els.status.textContent = 'Wrong tile — run over.';
        els.payout.textContent = `−${formatCoins(game.bet)}`;
      } else {
        els.status.textContent = `Cashed out @ ${s.multiplier.toFixed(2)}×`;
        els.payout.textContent = `+${formatCoins(s.payout)}`;
      }
      renderAction();
    },
    'tower:error': (e) => showError(e.message || 'Something went wrong.'),
  };
  Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));

  // ---------- interactions ----------
  els.diffBtns.forEach((b) =>
    b.addEventListener('click', () => {
      difficulty = b.dataset.diff;
      els.diffBtns.forEach((x) => x.classList.toggle('is-active', x === b));
    }),
  );

  container.querySelectorAll('[data-mult]').forEach((b) =>
    b.addEventListener('click', () => {
      els.betAmount.value = String(Math.max(1, Math.floor(currentAmount() * Number(b.dataset.mult))));
    }),
  );
  container.querySelector('[data-max]').addEventListener('click', () => {
    const user = getUser();
    if (user) els.betAmount.value = String(Math.floor(user.balance));
  });

  els.board.addEventListener('click', (e) => {
    const tile = e.target.closest('.tower__tile');
    if (!tile || !game.active) return;
    if (Number(tile.dataset.row) !== game.row) return;
    socket.emit('tower:pick', { col: Number(tile.dataset.col) });
  });

  els.action.addEventListener('click', () => {
    const user = getUser();
    if (!user) return openModal('login');
    if (game.active) {
      if (game.multiplier > 0) socket.emit('tower:cashout');
    } else {
      socket.emit('tower:start', { amount: currentAmount(), difficulty });
    }
  });

  renderAction();

  return function unmount() {
    Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
    if (game.active) socket.emit('tower:cashout');
  };
}
