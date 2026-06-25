// GOLDBET — Blackjack game view. One shared, server-authoritative table with
// seats players can sit at. This module renders the dealer, the seats and the
// contextual controls, and talks to the server over Socket.IO. Mirrors the
// structure of public/js/crash.js and public/js/roulette.js.

const TEMPLATE = `
  <div class="bj">
    <div class="bj__main">
      <div class="bj__history" id="bjHistory"></div>

      <div class="bj__table">
        <div class="bj__dealer" id="bjDealer"></div>
        <div class="bj__status">
          <span class="bj__phase" id="bjPhase">Connecting…</span>
          <span class="bj__fair" id="bjFair"></span>
        </div>
        <div class="bj__seats" id="bjSeats"></div>
      </div>

      <div class="betpanel bj__controls">
        <div class="betpanel__grid">
          <label class="betpanel__field">
            <span>Chip / bet amount</span>
            <div class="betpanel__amount">
              <input id="bjAmount" type="number" min="1" step="1" value="10" />
              <button type="button" class="chip" data-mult="0.5">½</button>
              <button type="button" class="chip" data-mult="2">2×</button>
              <button type="button" class="chip" data-max>Max</button>
            </div>
          </label>
        </div>
        <div class="bj__actions" id="bjActions"></div>
        <p class="betpanel__hint" id="bjHint"></p>
      </div>
    </div>

    <aside class="crash__side">
      <div class="crash__side-head">
        <span class="crash__side-title">🃏 Blackjack Table</span>
        <span class="crash__count" id="bjCount">0/7</span>
      </div>
      <div class="crash__totals">
        <span>Total staked</span>
        <span id="bjTotal">0.00</span>
      </div>
      <div class="roul__thead">
        <span>Player</span>
        <span>Bet</span>
        <span>Result</span>
      </div>
      <div class="crash__players" id="bjList"></div>
    </aside>
  </div>
`;

function cardHtml(c, extra = '') {
  if (!c) return '<div class="card card--back"></div>';
  const red = c.suit === '\u2665' || c.suit === '\u2666';
  return `<div class="card${red ? ' card--red' : ''}${extra}">
    <span class="card__rank">${c.rank}</span><span class="card__suit">${c.suit}</span>
  </div>`;
}

export function mountBlackjack(container, deps) {
  const { socket, getUser, formatCoins, openModal } = deps;
  container.innerHTML = TEMPLATE;

  const els = {
    root: container.querySelector('.bj'),
    history: container.querySelector('#bjHistory'),
    dealer: container.querySelector('#bjDealer'),
    phase: container.querySelector('#bjPhase'),
    fair: container.querySelector('#bjFair'),
    seats: container.querySelector('#bjSeats'),
    amount: container.querySelector('#bjAmount'),
    actions: container.querySelector('#bjActions'),
    hint: container.querySelector('#bjHint'),
    count: container.querySelector('#bjCount'),
    total: container.querySelector('#bjTotal'),
    list: container.querySelector('#bjList'),
  };

  const view = {
    s: null, // latest snapshot
    countdownTimer: 0,
    phaseEndsAt: 0,
    turnEndsAt: 0,
    phaseChangedAt: 0, // when the phase last changed (for the click guard)
    wasMyTurn: false, // whether it was already our turn on the previous state
    lastDealerHtml: '', // cached markup so cards don't re-animate on no-op updates
    lastSeatsHtml: '',
  };

  function mySeatIndex() {
    const user = getUser();
    if (!user || !view.s) return -1;
    return view.s.seats.findIndex((s) => s.occupied && s.username === user.username);
  }

  function currentAmount() {
    return Math.max(1, Math.floor(Number(els.amount.value) || 0));
  }

  function flashHint(msg) {
    els.hint.textContent = msg;
    els.hint.classList.add('is-error');
    setTimeout(() => els.hint.classList.remove('is-error'), 2500);
  }

  // ---------- rendering ----------
  function renderHistory() {
    const h = view.s.history || [];
    els.history.classList.toggle('is-empty', h.length === 0);
    if (h.length === 0) {
      els.history.innerHTML = '';
      return;
    }
    const chips = h
      .map((r) => {
        const cls = r.blackjack ? 'is-green' : r.bust ? 'is-red' : 'is-black';
        const label = r.blackjack ? 'BJ' : r.bust ? 'X' : r.dealer;
        return `<span class="rhist ${cls}" title="Dealer ${r.dealer}${r.bust ? ' (bust)' : ''}">${label}</span>`;
      })
      .join('');
    els.history.innerHTML = `<span class="bj__history-label">Recent</span>${chips}`;
  }

  function renderDealer() {
    const d = view.s.dealer;
    const cards = (d.cards || []).map((c) => cardHtml(c)).join('');
    let badge = '';
    if (d.cards && d.cards.length) {
      const txt = d.hideHole ? `${d.value}+` : d.blackjack ? 'BLACKJACK' : d.value;
      const cls = !d.hideHole && d.value > 21 ? ' is-bust' : d.blackjack ? ' is-bj' : '';
      badge = `<span class="bj__value${cls}">${txt}</span>`;
    }
    const html = `
      <div class="bj__dealer-label">Dealer ${badge}</div>
      <div class="bj__cards">${cards || '<div class="card card--ghost"></div><div class="card card--ghost"></div>'}</div>
    `;
    if (html === view.lastDealerHtml) return;
    view.lastDealerHtml = html;
    els.dealer.innerHTML = html;
  }

  function handStatusBadge(h) {
    if (h.result) {
      const o = h.result.outcome;
      if (o === 'blackjack') return `<span class="bj__chip is-win">BJ +${formatCoins(h.result.net)}</span>`;
      if (o === 'win') return `<span class="bj__chip is-win">+${formatCoins(h.result.net)}</span>`;
      if (o === 'push') return '<span class="bj__chip is-push">PUSH</span>';
      return `<span class="bj__chip is-lose">−${formatCoins(-h.result.net)}</span>`;
    }
    if (h.status === 'bust') return '<span class="bj__chip is-lose">BUST</span>';
    if (h.status === 'blackjack') return '<span class="bj__chip is-win">BLACKJACK</span>';
    const soft = h.soft && h.total < 21 ? ' soft' : '';
    return `<span class="bj__value">${h.total}${soft}</span>`;
  }

  function handHtml(seat, h, handIdx, active) {
    const isActive = active && view.s.activeHand === handIdx;
    const cards = h.cards.map((c) => cardHtml(c)).join('');
    return `
      <div class="bj__hand${isActive ? ' is-active' : ''}">
        <div class="bj__cards">${cards}</div>
        <div class="bj__handfoot">
          ${handStatusBadge(h)}
          <span class="bj__bet">💰 ${formatCoins(h.bet)}</span>
        </div>
      </div>`;
  }

  function seatHtml(seat) {
    const user = getUser();
    if (!seat.occupied) {
      const canSit =
        user && mySeatIndex() === -1 && (view.s.phase === 'betting' || view.s.phase === 'result');
      return `
        <div class="bj__seat is-empty" data-seat="${seat.index}">
          <div class="bj__seat-label">Seat ${seat.index + 1}</div>
          ${
            canSit
              ? `<button class="btn btn--ghost bj__sit" data-sit="${seat.index}">Sit here</button>`
              : '<div class="bj__seat-open">Open</div>'
          }
        </div>`;
    }

    const mine = user && seat.username === user.username;
    const active = view.s.phase === 'playing' && view.s.activeSeat === seat.index;
    const isTurn = active;
    let body;
    if (seat.hands && seat.hands.length) {
      body = seat.hands.map((h, i) => handHtml(seat, h, i, active)).join('');
    } else if (seat.baseBet > 0) {
      body = `<div class="bj__hand"><div class="bj__cards"></div><div class="bj__handfoot"><span class="bj__chip is-push">Ready</span><span class="bj__bet">💰 ${formatCoins(seat.baseBet)}</span></div></div>`;
    } else {
      body = '<div class="bj__seat-open">Waiting…</div>';
    }

    return `
      <div class="bj__seat${mine ? ' is-mine' : ''}${isTurn ? ' is-turn' : ''}" data-seat="${seat.index}">
        <div class="bj__seat-head">
          <span class="bj__seat-name">${escapeHtml(seat.username)}</span>
          ${isTurn ? '<span class="bj__seat-timer" id="bjTurnTimer">15</span>' : `<span class="bj__seat-tag">Seat ${seat.index + 1}</span>`}
        </div>
        ${body}
      </div>`;
  }

  function renderSeats() {
    const html = view.s.seats.map(seatHtml).join('');
    if (html === view.lastSeatsHtml) return;
    view.lastSeatsHtml = html;
    els.seats.innerHTML = html;
  }

  function renderSide() {
    const seated = view.s.seats.filter((s) => s.occupied);
    els.count.textContent = `${seated.length}/${view.s.seatCount}`;
    const total = seated.reduce((sum, s) => {
      const handsBet = (s.hands || []).reduce((a, h) => a + h.bet, 0);
      return sum + (handsBet || s.baseBet || 0);
    }, 0);
    els.total.textContent = formatCoins(total);

    const user = getUser();
    if (seated.length === 0) {
      els.list.innerHTML = '<div class="crash__empty">No players seated — sit down to play!</div>';
      return;
    }
    els.list.innerHTML = seated
      .map((s) => {
        const mine = user && s.username === user.username ? ' is-mine' : '';
        const bet = (s.hands || []).reduce((a, h) => a + h.bet, 0) || s.baseBet || 0;
        let cls = 'is-in';
        let result = bet > 0 ? `${(s.hands && s.hands.length) || ''}` : 'sitting out';
        const net = (s.hands || []).reduce((a, h) => a + (h.result ? h.result.net : 0), 0);
        const settled = (s.hands || []).some((h) => h.result);
        if (settled) {
          if (net > 0) {
            cls = 'is-won';
            result = `+${formatCoins(net)}`;
          } else if (net < 0) {
            cls = 'is-lost';
            result = `−${formatCoins(-net)}`;
          } else {
            result = '±0.00';
          }
        } else if (bet > 0) {
          result = 'in play';
        }
        return `
          <div class="rprow ${cls}${mine}">
            <span class="prow__name">${escapeHtml(s.username)}</span>
            <span>${formatCoins(bet)}</span>
            <span class="prow__cash">${result}</span>
          </div>`;
      })
      .join('');
  }

  function renderActions() {
    const user = getUser();
    els.actions.innerHTML = '';
    if (!user) {
      els.actions.innerHTML = '<button class="btn btn--ghost" id="bjLogin">Log in to play</button>';
      container.querySelector('#bjLogin').addEventListener('click', () => openModal('login'));
      els.hint.textContent = 'Log in, take a seat and beat the dealer to 21.';
      return;
    }

    const idx = mySeatIndex();
    const phase = view.s.phase;

    if (idx === -1) {
      els.hint.textContent =
        phase === 'betting' || phase === 'result'
          ? 'Click an empty seat to join the table.'
          : 'Round in progress — sit down between rounds.';
      return;
    }

    const seat = view.s.seats[idx];

    if (phase === 'betting') {
      const buttons = [
        '<button class="btn btn--primary" data-act="bet">Place bet</button>',
      ];
      if (seat.baseBet > 0) {
        buttons.push('<button class="btn btn--ghost" data-act="clear">Clear</button>');
      }
      buttons.push('<button class="btn btn--ghost" data-act="leave">Leave seat</button>');
      els.actions.innerHTML = buttons.join('');
      els.hint.textContent =
        seat.baseBet > 0
          ? `Your bet: ${formatCoins(seat.baseBet)} coins. Add more or wait for the deal.`
          : 'Place a bet to join this round.';
    } else if (phase === 'playing') {
      const myTurn = view.s.activeSeat === idx;
      const hand = myTurn ? seat.hands[view.s.activeHand] : null;
      if (myTurn && hand && hand.status === 'playing') {
        const canDouble = hand.cards.length === 2 && !hand.doubled;
        const canSplit =
          hand.cards.length === 2 &&
          seat.hands.length < 4 &&
          rankVal(hand.cards[0].rank) === rankVal(hand.cards[1].rank);
        const b = [
          '<button class="btn btn--primary" data-act="hit">Hit</button>',
          '<button class="btn btn--gold" data-act="stand">Stand</button>',
        ];
        if (canDouble) b.push('<button class="btn btn--ghost" data-act="double">Double</button>');
        if (canSplit) b.push('<button class="btn btn--ghost" data-act="split">Split</button>');
        els.actions.innerHTML = b.join('');
        els.hint.textContent = 'Your turn — hit, stand, double or split.';
      } else {
        els.hint.textContent = myTurn ? 'Resolving…' : 'Waiting for other players…';
      }
    } else if (phase === 'dealer') {
      els.hint.textContent = 'Dealer is drawing…';
    } else {
      // result / idle. Keep a disabled button in the primary slot so "Leave
      // seat" never lands where "Place bet"/"Hit" sat a moment ago.
      const net = (seat.hands || []).reduce((a, h) => a + (h.result ? h.result.net : 0), 0);
      const settled = (seat.hands || []).some((h) => h.result);
      els.actions.innerHTML =
        '<button class="btn btn--primary" disabled>Next round…</button>' +
        '<button class="btn btn--ghost bj__leave" data-act="leave">Leave seat</button>';
      els.hint.textContent = settled
        ? net > 0
          ? `You won ${formatCoins(net)} coins! 🎉`
          : net < 0
            ? `You lost ${formatCoins(-net)} coins. Next round coming up.`
            : 'Push — your bet is returned.'
        : 'Next round starting soon.';
    }
  }

  function setPhaseText() {
    const s = view.s;
    const map = {
      betting: ['is-betting', 'Place your bets'],
      playing: ['is-playing', 'Round in play'],
      dealer: ['is-dealer', 'Dealer drawing'],
      result: ['is-result', 'Round over'],
      idle: ['', 'Waiting…'],
    };
    const [cls] = map[s.phase] || ['', ''];
    els.phase.className = 'bj__phase' + (cls ? ' ' + cls : '');
    els.fair.textContent = s.serverSeed
      ? `seed: ${s.serverSeed.slice(0, 10)}…`
      : s.hash
        ? `fair: ${s.hash.slice(0, 10)}…`
        : '';
    updateCountdownText();
  }

  // ---------- countdown ----------
  function updateCountdownText() {
    const s = view.s;
    if (!s) return;
    if (s.phase === 'betting') {
      const secs = Math.max(0, (view.phaseEndsAt - Date.now()) / 1000);
      els.phase.textContent = `Place your bets · ${secs.toFixed(0)}s`;
    } else if (s.phase === 'playing') {
      const seat = s.seats[s.activeSeat];
      const name = seat ? seat.username : 'Player';
      const secs = Math.max(0, (view.turnEndsAt - Date.now()) / 1000);
      els.phase.textContent = `${name}'s turn · ${secs.toFixed(0)}s`;
      const timerEl = container.querySelector('#bjTurnTimer');
      if (timerEl) timerEl.textContent = String(Math.ceil(secs));
    } else if (s.phase === 'dealer') {
      els.phase.textContent = 'Dealer drawing…';
    } else if (s.phase === 'result') {
      els.phase.textContent = 'Round over';
    } else {
      els.phase.textContent = 'Waiting…';
    }
  }

  function startCountdown() {
    clearInterval(view.countdownTimer);
    view.countdownTimer = setInterval(updateCountdownText, 250);
  }

  // ---------- socket events ----------
  function applyState(s) {
    const prevPhase = view.s ? view.s.phase : null;
    view.s = s;
    view.phaseEndsAt = Date.now() + (s.phaseRemainingMs || 0);
    view.turnEndsAt = Date.now() + (s.turnRemainingMs || 0);
    if (prevPhase !== s.phase) view.phaseChangedAt = Date.now();
    const canBet = mySeatIndex() !== -1 && s.phase === 'betting';
    els.root.dataset.canbet = canBet ? '1' : '0';
    renderHistory();
    renderDealer();
    renderSeats();
    renderSide();
    renderActions();
    setPhaseText();
    maybeScrollToTurn();
  }

  // When it first becomes our turn, bring the action buttons into view so a
  // player scrolled up at the table doesn't miss their turn.
  function maybeScrollToTurn() {
    const idx = mySeatIndex();
    const myTurn = idx !== -1 && view.s.phase === 'playing' && view.s.activeSeat === idx;
    if (myTurn && !view.wasMyTurn) {
      els.actions.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    view.wasMyTurn = myTurn;
  }

  const handlers = {
    'blackjack:state': applyState,
    'blackjack:error': (e) => flashHint(e.message || 'Something went wrong.'),
  };
  Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
  socket.emit('blackjack:sync');

  // ---------- interactions ----------
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

  // Seat sitting (event delegation).
  els.seats.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sit]');
    if (!btn) return;
    const user = getUser();
    if (!user) return openModal('login');
    socket.emit('blackjack:sit', { seat: Number(btn.dataset.sit) });
  });

  // Contextual action buttons (event delegation).
  els.actions.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    // The phase (and therefore the buttons) may have just swapped under the
    // cursor. Ignore a click that lands right after a change so a tap meant for
    // "Hit"/"Place bet" can't accidentally bet again or leave the seat.
    if (Date.now() - view.phaseChangedAt < 600) {
      flashHint('Round just changed — tap again.');
      return;
    }
    const act = btn.dataset.act;
    if (act === 'bet') socket.emit('blackjack:bet', { amount: currentAmount() });
    else if (act === 'clear') socket.emit('blackjack:clear');
    else if (act === 'leave') socket.emit('blackjack:leave');
    else if (act === 'hit') socket.emit('blackjack:hit');
    else if (act === 'stand') socket.emit('blackjack:stand');
    else if (act === 'double') socket.emit('blackjack:double');
    else if (act === 'split') socket.emit('blackjack:split');
  });

  startCountdown();

  // ---------- cleanup ----------
  return function unmount() {
    Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
    clearInterval(view.countdownTimer);
  };
}

function rankVal(rank) {
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
  return Number(rank);
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
