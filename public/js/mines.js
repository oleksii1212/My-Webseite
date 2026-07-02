// GOLDBET — Mines view. Reveal safe tiles on a 5×5 grid to grow the multiplier;
// hit a mine and you lose. Cash out any time. The board is fixed server-side
// from a provably-fair seed before the first reveal.

const TILES = 25;

const TEMPLATE = `
  <div class="game game--mines">
    <div class="game__main">
      <div class="mines__grid" id="minesGrid"></div>
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
            <span>Mines</span>
            <input id="minesCount" type="number" min="1" max="24" step="1" value="3" />
          </label>
        </div>
        <button class="btn btn--primary betpanel__action" id="actionBtn">Start game</button>
        <p class="betpanel__hint" id="hint"></p>
      </div>
    </div>

    <aside class="game__side">
      <div class="game__side-head"><span class="game__side-title">Round</span></div>
      <div class="game__stat"><span>Status</span><span id="minesStatus">Set your bet</span></div>
      <div class="game__stat"><span>Current multiplier</span><span id="minesMult">—</span></div>
      <div class="game__stat"><span>Next tile</span><span id="minesNext">—</span></div>
      <div class="game__stat"><span>Cash out</span><span id="minesPayout">—</span></div>
    </aside>
  </div>
`;

export function mountMines(container, deps) {
  const { socket, getUser, formatCoins, openModal } = deps;
  container.innerHTML = TEMPLATE;

  const els = {
    grid: container.querySelector('#minesGrid'),
    betAmount: container.querySelector('#betAmount'),
    minesCount: container.querySelector('#minesCount'),
    action: container.querySelector('#actionBtn'),
    hint: container.querySelector('#hint'),
    status: container.querySelector('#minesStatus'),
    mult: container.querySelector('#minesMult'),
    next: container.querySelector('#minesNext'),
    payout: container.querySelector('#minesPayout'),
  };

  const game = { active: false, bet: 0, multiplier: 0 };

  // Build the grid once.
  for (let i = 0; i < TILES; i += 1) {
    const tile = document.createElement('button');
    tile.className = 'mines__tile';
    tile.dataset.tile = String(i);
    tile.disabled = true;
    els.grid.appendChild(tile);
  }
  const tiles = [...els.grid.children];

  function currentAmount() {
    return Math.max(1, Math.floor(Number(els.betAmount.value) || 0));
  }

  function showError(msg) {
    els.hint.textContent = msg;
    els.hint.classList.add('is-error');
    setTimeout(() => els.hint.classList.remove('is-error'), 2500);
  }

  function resetTiles() {
    tiles.forEach((t) => {
      t.className = 'mines__tile';
      t.disabled = true;
      t.innerHTML = '';
    });
  }

  function setControls(active) {
    game.active = active;
    els.betAmount.disabled = active;
    els.minesCount.disabled = active;
    tiles.forEach((t) => {
      t.disabled = !active || t.classList.contains('is-safe');
    });
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

  function gem(svgColor) {
    return `<svg viewBox="0 0 24 24" fill="${svgColor}"><path d="M6 3h12l4 6-10 12L2 9z"></path></svg>`;
  }
  function bomb() {
    return '<svg viewBox="0 0 24 24" fill="#ff5c5c"><circle cx="11" cy="14" r="7"></circle><path d="M16 8l3-3M18 4h3v3" stroke="#ff5c5c" stroke-width="2" fill="none"></path></svg>';
  }

  const handlers = {
    'mines:started': (s) => {
      game.bet = s.bet;
      game.multiplier = 0;
      resetTiles();
      setControls(true);
      els.status.textContent = `${s.mines} mines hidden`;
      els.mult.textContent = '1.00×';
      els.next.textContent = `${s.nextMultiplier.toFixed(2)}×`;
      els.payout.textContent = '—';
      renderAction();
    },
    'mines:safe': (s) => {
      const tile = tiles[s.tile];
      tile.classList.add('is-safe');
      tile.disabled = true;
      tile.innerHTML = gem('#00e08a');
      game.multiplier = s.multiplier;
      els.mult.textContent = `${s.multiplier.toFixed(2)}×`;
      els.next.textContent = `${s.nextMultiplier.toFixed(2)}×`;
      els.payout.textContent = formatCoins(Math.floor(game.bet * s.multiplier));
      renderAction();
    },
    'mines:over': (s) => {
      setControls(false);
      s.mineTiles.forEach((i) => {
        if (!tiles[i].classList.contains('is-safe')) {
          tiles[i].classList.add('is-mine');
          tiles[i].innerHTML = bomb();
        }
      });
      if (s.busted) {
        if (s.hitTile !== null) tiles[s.hitTile].classList.add('is-hit');
        els.status.textContent = 'Boom! You hit a mine.';
        els.payout.textContent = `−${formatCoins(game.bet)}`;
      } else {
        els.status.textContent = `Cashed out @ ${s.multiplier.toFixed(2)}×`;
        els.payout.textContent = `+${formatCoins(s.payout)}`;
      }
      renderAction();
    },
    'mines:error': (e) => showError(e.message || 'Something went wrong.'),
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

  els.grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.mines__tile');
    if (!tile || !game.active || tile.disabled) return;
    socket.emit('mines:reveal', { tile: Number(tile.dataset.tile) });
  });

  els.action.addEventListener('click', () => {
    const user = getUser();
    if (!user) return openModal('login');
    if (game.active) {
      if (game.multiplier > 0) socket.emit('mines:cashout');
    } else {
      socket.emit('mines:start', {
        amount: currentAmount(),
        mines: Math.max(1, Math.min(24, Math.floor(Number(els.minesCount.value) || 3))),
      });
    }
  });

  renderAction();

  return function unmount() {
    Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
    if (game.active) socket.emit('mines:cashout');
  };
}
