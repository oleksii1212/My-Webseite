// GOLDBET — Dice view. Pick a target and roll under/over it; the server decides
// the provably-fair roll and pays the fair odds minus the house edge.

const RTP = 0.99;

const TEMPLATE = `
  <div class="game game--dice">
    <div class="game__main">
      <div class="dice__result" id="diceResult">
        <span class="dice__value" id="diceValue">—</span>
        <span class="dice__verdict" id="diceVerdict">Set your target and roll</span>
      </div>
      <div class="dice__track" id="diceTrack">
        <div class="dice__fill" id="diceFill"></div>
        <div class="dice__marker" id="diceMarker"></div>
        <div class="dice__ball" id="diceBall" hidden></div>
        <span class="dice__tick" style="left:0">0</span>
        <span class="dice__tick" style="left:25%">25</span>
        <span class="dice__tick" style="left:50%">50</span>
        <span class="dice__tick" style="left:75%">75</span>
        <span class="dice__tick" style="left:100%">100</span>
      </div>

      <div class="betpanel">
        <div class="dice__dir">
          <button type="button" class="dice__dirbtn is-active" data-dir="under">Roll Under</button>
          <button type="button" class="dice__dirbtn" data-dir="over">Roll Over</button>
        </div>
        <label class="betpanel__field">
          <span>Target <strong id="diceTargetLabel">50</strong></span>
          <input id="diceTarget" type="range" min="2" max="98" value="50" />
        </label>
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
            <span>Multiplier</span>
            <input id="diceMult" type="text" value="—" readonly />
          </label>
        </div>
        <button class="btn btn--primary betpanel__action" id="rollBtn">Roll dice</button>
        <p class="betpanel__hint" id="hint"></p>
      </div>
    </div>

    <aside class="game__side">
      <div class="game__side-head"><span class="game__side-title">How to play</span></div>
      <p class="game__help">Pick a target and a direction. The server rolls a number from
        <strong>0.00</strong> to <strong>100.00</strong>. Win if it lands on your side. The smaller
        your win chance, the bigger the payout.</p>
      <div class="game__stat"><span>Win chance</span><span id="diceChance">50.00%</span></div>
      <div class="game__stat"><span>Last payout</span><span id="dicePayout">—</span></div>
      <div class="game__history" id="diceHistory"></div>
    </aside>
  </div>
`;

export function mountDice(container, deps) {
  const { socket, getUser, formatCoins, openModal } = deps;
  container.innerHTML = TEMPLATE;

  const els = {
    value: container.querySelector('#diceValue'),
    verdict: container.querySelector('#diceVerdict'),
    result: container.querySelector('#diceResult'),
    fill: container.querySelector('#diceFill'),
    marker: container.querySelector('#diceMarker'),
    ball: container.querySelector('#diceBall'),
    target: container.querySelector('#diceTarget'),
    targetLabel: container.querySelector('#diceTargetLabel'),
    betAmount: container.querySelector('#betAmount'),
    mult: container.querySelector('#diceMult'),
    chance: container.querySelector('#diceChance'),
    payout: container.querySelector('#dicePayout'),
    roll: container.querySelector('#rollBtn'),
    hint: container.querySelector('#hint'),
    history: container.querySelector('#diceHistory'),
    dirBtns: [...container.querySelectorAll('.dice__dirbtn')],
  };

  let direction = 'under';
  const history = [];

  function currentTarget() {
    return Number(els.target.value);
  }

  function odds() {
    const target = currentTarget();
    const chance = direction === 'over' ? 100 - target : target;
    return { chance, multiplier: Math.floor((RTP * 10000) / chance) / 100 };
  }

  function renderOdds() {
    const target = currentTarget();
    const { chance, multiplier } = odds();
    els.targetLabel.textContent = String(target);
    els.mult.value = `${multiplier.toFixed(2)}×`;
    els.chance.textContent = `${chance.toFixed(2)}%`;
    // The winning side is shaded on the track.
    if (direction === 'under') {
      els.fill.style.left = '0';
      els.fill.style.width = `${target}%`;
    } else {
      els.fill.style.left = `${target}%`;
      els.fill.style.width = `${100 - target}%`;
    }
    els.marker.style.left = `${target}%`;
  }

  function currentAmount() {
    return Math.max(1, Math.floor(Number(els.betAmount.value) || 0));
  }

  function showError(msg) {
    els.hint.textContent = msg;
    els.hint.classList.add('is-error');
    setTimeout(() => els.hint.classList.remove('is-error'), 2500);
  }

  function onResult(r) {
    els.roll.disabled = false;
    els.value.textContent = r.value.toFixed(2);
    els.result.classList.toggle('is-win', r.win);
    els.result.classList.toggle('is-lose', !r.win);
    els.verdict.textContent = r.win
      ? `Win!  +${formatCoins(r.payout)}`
      : `Lost  −${formatCoins(r.bet)}`;
    els.payout.textContent = r.win ? `+${formatCoins(r.payout)}` : `−${formatCoins(r.bet)}`;
    els.ball.hidden = false;
    els.ball.style.left = `${r.value}%`;

    history.unshift(r);
    if (history.length > 12) history.pop();
    els.history.innerHTML = history
      .map((h) => `<span class="hist ${h.win ? 'is-win' : 'is-lose'}">${h.value.toFixed(2)}</span>`)
      .join('');
  }

  const handlers = {
    'dice:result': onResult,
    'dice:error': (e) => {
      els.roll.disabled = false;
      showError(e.message || 'Something went wrong.');
    },
  };
  Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));

  // ---------- interactions ----------
  els.dirBtns.forEach((b) =>
    b.addEventListener('click', () => {
      direction = b.dataset.dir;
      els.dirBtns.forEach((x) => x.classList.toggle('is-active', x === b));
      renderOdds();
    }),
  );
  els.target.addEventListener('input', renderOdds);

  container.querySelectorAll('[data-mult]').forEach((b) =>
    b.addEventListener('click', () => {
      els.betAmount.value = String(Math.max(1, Math.floor(currentAmount() * Number(b.dataset.mult))));
    }),
  );
  container.querySelector('[data-max]').addEventListener('click', () => {
    const user = getUser();
    if (user) els.betAmount.value = String(Math.floor(user.balance));
  });

  els.roll.addEventListener('click', () => {
    const user = getUser();
    if (!user) return openModal('login');
    els.roll.disabled = true;
    socket.emit('dice:roll', {
      amount: currentAmount(),
      target: currentTarget(),
      direction,
    });
  });

  renderOdds();

  return function unmount() {
    Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
  };
}
