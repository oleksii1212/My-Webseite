// GOLDBET — Poker view (Jacks-or-Better video poker). Deal five cards, hold the
// ones you want, then draw replacements. The deck is shuffled server-side from a
// provably-fair seed; the final hand is paid on the standard 9/6 table.

const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663']; // ♠ ♥ ♦ ♣
const RANKS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

const PAYTABLE = [
  ['royal', 'Royal Flush', 250],
  ['straightFlush', 'Straight Flush', 50],
  ['four', 'Four of a Kind', 25],
  ['fullHouse', 'Full House', 9],
  ['flush', 'Flush', 6],
  ['straight', 'Straight', 4],
  ['three', 'Three of a Kind', 3],
  ['twoPair', 'Two Pair', 2],
  ['jacks', 'Jacks or Better', 1],
];

const TEMPLATE = `
  <div class="game game--poker">
    <div class="game__main">
      <div class="poker__verdict" id="pokerVerdict">Place a bet and deal</div>
      <div class="poker__hand" id="pokerHand"></div>
      <div class="betpanel">
        <label class="betpanel__field">
          <span>Bet amount</span>
          <div class="betpanel__amount">
            <input id="betAmount" type="number" min="1" step="1" value="10" />
            <button type="button" class="chip" data-mult="0.5">½</button>
            <button type="button" class="chip" data-mult="2">2×</button>
            <button type="button" class="chip" data-max>Max</button>
          </div>
        </label>
        <button class="btn btn--primary betpanel__action" id="actionBtn">Deal</button>
        <p class="betpanel__hint" id="hint">Tip: click a card to hold it before drawing.</p>
      </div>
    </div>

    <aside class="game__side">
      <div class="game__side-head"><span class="game__side-title">Pay table (per 1 bet)</span></div>
      <div class="poker__paytable" id="pokerPaytable"></div>
    </aside>
  </div>
`;

export function mountPoker(container, deps) {
  const { socket, getUser, formatCoins, openModal } = deps;
  container.innerHTML = TEMPLATE;

  const els = {
    verdict: container.querySelector('#pokerVerdict'),
    hand: container.querySelector('#pokerHand'),
    betAmount: container.querySelector('#betAmount'),
    action: container.querySelector('#actionBtn'),
    hint: container.querySelector('#hint'),
    paytable: container.querySelector('#pokerPaytable'),
  };

  // phase: 'idle' (ready to deal) | 'draw' (cards dealt, choose holds)
  const game = { phase: 'idle', holds: [false, false, false, false, false] };

  els.paytable.innerHTML = PAYTABLE.map(
    ([key, label, mult]) => `<div class="poker__pay" data-rank="${key}"><span>${label}</span><span>${mult}×</span></div>`,
  ).join('');

  function cardHtml(card, i, faceDown = false) {
    if (faceDown || !card) {
      return `<button class="pcard is-down" data-i="${i}"></button>`;
    }
    const red = card.suit === 1 || card.suit === 2;
    const rank = RANKS[card.rank] || String(card.rank);
    const held = game.holds[i] ? ' is-held' : '';
    return `<button class="pcard${red ? ' is-red' : ''}${held}" data-i="${i}">
      <span class="pcard__rank">${rank}</span>
      <span class="pcard__suit">${SUITS[card.suit]}</span>
      <span class="pcard__hold">HOLD</span>
    </button>`;
  }

  function renderHand(cards, faceDown = false) {
    els.hand.innerHTML = cards.map((c, i) => cardHtml(c, i, faceDown)).join('');
  }

  function highlightPay(rank) {
    els.paytable.querySelectorAll('.poker__pay').forEach((row) => {
      row.classList.toggle('is-hit', row.dataset.rank === rank);
    });
  }

  function currentAmount() {
    return Math.max(1, Math.floor(Number(els.betAmount.value) || 0));
  }

  function showError(msg) {
    els.action.disabled = false;
    els.hint.textContent = msg;
    els.hint.classList.add('is-error');
    setTimeout(() => els.hint.classList.remove('is-error'), 2500);
  }

  const handlers = {
    'poker:dealt': (d) => {
      game.phase = 'draw';
      game.holds = [false, false, false, false, false];
      renderHand(d.hand);
      els.verdict.textContent = 'Hold cards, then draw';
      els.verdict.className = 'poker__verdict';
      highlightPay(null);
      els.action.textContent = 'Draw';
      els.action.className = 'btn btn--gold betpanel__action';
      els.action.disabled = false;
      els.betAmount.disabled = true;
      els.hint.textContent = 'Click a card to hold it before drawing.';
    },
    'poker:result': (r) => {
      game.phase = 'idle';
      renderHand(r.hand);
      const win = r.payout > 0;
      els.verdict.textContent = win ? `${r.rankLabel}  +${formatCoins(r.payout)}` : `${r.rankLabel}`;
      els.verdict.className = 'poker__verdict ' + (win ? 'is-win' : 'is-lose');
      highlightPay(win ? r.rank : null);
      els.action.textContent = 'Deal';
      els.action.className = 'btn btn--primary betpanel__action';
      els.action.disabled = false;
      els.betAmount.disabled = false;
    },
    'poker:error': (e) => showError(e.message || 'Something went wrong.'),
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

  els.hand.addEventListener('click', (e) => {
    const card = e.target.closest('.pcard');
    if (!card || game.phase !== 'draw') return;
    const i = Number(card.dataset.i);
    game.holds[i] = !game.holds[i];
    card.classList.toggle('is-held', game.holds[i]);
  });

  els.action.addEventListener('click', () => {
    const user = getUser();
    if (!user) return openModal('login');
    if (game.phase === 'idle') {
      els.action.disabled = true;
      socket.emit('poker:deal', { amount: currentAmount() });
    } else {
      els.action.disabled = true;
      socket.emit('poker:draw', { holds: game.holds });
    }
  });

  renderHand([null, null, null, null, null], true);

  return function unmount() {
    Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
  };
}
