// GOLDBET — Blackjack engine. One shared, server-authoritative table with a
// fixed number of seats (default 7). Any logged-in player can sit at a free
// seat and play. A round runs through phases broadcast to every client:
// betting -> playing (turn by turn) -> dealer -> result. Mirrors the structure
// of server/crash.js and server/roulette.js.

import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { adjustBalance, getUserById } from './users.js';

const B = config.blackjack;

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663']; // ♠ ♥ ♦ ♣

function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
  return Number(rank);
}

// Best hand total, treating aces as 11 then demoting to 1 to avoid busting.
function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c.rank);
    if (c.rank === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

// ---------- Provably-fair shoe ----------
// The shoe is shuffled deterministically from a per-round server seed. The hash
// is published before any card is dealt; the seed is revealed at the result, so
// anyone can re-run the shuffle and verify the deal was fixed in advance.
function buildShoe(decks) {
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ rank, suit });
    }
  }
  return cards;
}

function shuffle(cards, serverSeed) {
  let counter = 0;
  let pool = Buffer.alloc(0);
  let pos = 0;
  const nextByte = () => {
    if (pos >= pool.length) {
      pool = crypto.createHash('sha256').update(`${serverSeed}:${counter}`).digest();
      counter += 1;
      pos = 0;
    }
    return pool[pos++];
  };
  // Uniform integer in [0, n) using rejection sampling over 4 bytes.
  const randInt = (n) => {
    const limit = Math.floor(0x100000000 / n) * n;
    let x;
    do {
      x = (nextByte() << 24) | (nextByte() << 16) | (nextByte() << 8) | nextByte();
      x >>>= 0;
    } while (x >= limit);
    return x % n;
  };
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function generateShoe() {
  const serverSeed = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
  const shoe = shuffle(buildShoe(B.decks), serverSeed);
  return { serverSeed, hash, shoe };
}

// ---------- Shared table state ----------
function emptyDealer() {
  return { cards: [], hideHole: true };
}

const state = {
  phase: 'idle', // 'betting' | 'playing' | 'dealer' | 'result'
  roundId: 0,
  seats: new Array(B.seatCount).fill(null),
  dealer: emptyDealer(),
  shoe: [],
  serverSeed: '',
  hash: '',
  activeSeat: null,
  activeHand: 0,
  phaseEndsAt: 0,
  turnEndsAt: 0,
  turnSeq: 0, // guards stale turn-timeout callbacks
  history: [], // recent dealer results, newest first
};

let io = null;
let phaseTimer = null;
let turnTimer = null;

// Track how many live sockets each user has, so a seat is only freed once the
// player has truly left (and not on a transient reconnect or a second tab).
const connections = new Map(); // userId -> open socket count
const abandonTimers = new Map(); // userId -> pending seat-removal timeout
const ABANDON_GRACE_MS = 6000; // wait this long for a reconnect before freeing

function userRoom(userId) {
  return `user:${userId}`;
}

// Free a seat after its player has been gone for the grace period. Mid-round we
// let their hands finish and drop them at the next deal instead.
function scheduleSeatRemoval(userId) {
  clearTimeout(abandonTimers.get(userId));
  const timer = setTimeout(() => {
    abandonTimers.delete(userId);
    if (connections.get(userId)) return; // reconnected in time
    const idx = seatOfUser(userId);
    if (idx === -1) return;
    const seat = state.seats[idx];
    if (state.phase === 'betting') {
      if (seat.baseBet > 0) {
        adjustBalance(userId, seat.baseBet, 'blackjack_leave_refund');
        emitBalance(userId);
      }
      state.seats[idx] = null;
      broadcast();
    } else if (state.phase === 'result' || state.phase === 'idle') {
      state.seats[idx] = null;
      broadcast();
    } else {
      // playing/dealer: keep their hands in the round, remove at next deal.
      seat.abandoned = true;
    }
  }, ABANDON_GRACE_MS);
  abandonTimers.set(userId, timer);
}

function emitBalance(userId) {
  const user = getUserById(userId);
  if (user) io.to(userRoom(userId)).emit('blackjack:balance', { balance: user.balance });
}

function seatOfUser(userId) {
  return state.seats.findIndex((s) => s && s.userId === userId);
}

function draw() {
  if (state.shoe.length === 0) {
    // Defensive: refill from a fresh shuffled shoe mid-round if ever exhausted.
    state.shoe = generateShoe().shoe;
  }
  return state.shoe.pop();
}

function makeHand(bet) {
  return { cards: [], bet, status: 'playing', doubled: false, result: null };
}

// ---------- Payload shaping ----------
function dealerPayload() {
  const hide = state.dealer.hideHole;
  const cards = state.dealer.cards.map((c, i) => (hide && i === 1 ? null : c));
  const visible = hide ? state.dealer.cards.slice(0, 1) : state.dealer.cards;
  return {
    cards,
    value: state.dealer.cards.length ? handValue(visible).total : 0,
    hideHole: hide,
    blackjack: !hide && isBlackjack(state.dealer.cards),
  };
}

function handPayload(h) {
  const { total, soft } = handValue(h.cards);
  return {
    cards: h.cards,
    bet: h.bet,
    total,
    soft,
    status: h.status,
    doubled: h.doubled,
    result: h.result,
  };
}

function seatPayload(seat, index) {
  if (!seat) return { index, occupied: false };
  return {
    index,
    occupied: true,
    username: seat.username,
    baseBet: seat.baseBet,
    sittingOut: seat.sittingOut,
    hands: seat.hands.map(handPayload),
  };
}

function snapshot() {
  const now = Date.now();
  return {
    phase: state.phase,
    roundId: state.roundId,
    seatCount: B.seatCount,
    seats: state.seats.map(seatPayload),
    dealer: dealerPayload(),
    activeSeat: state.activeSeat,
    activeHand: state.activeHand,
    phaseRemainingMs: Math.max(0, state.phaseEndsAt - now),
    turnRemainingMs: state.phase === 'playing' ? Math.max(0, state.turnEndsAt - now) : 0,
    history: state.history,
    hash: state.hash,
    serverSeed: state.phase === 'result' ? state.serverSeed : null,
    maxBet: B.maxBet,
  };
}

function broadcast() {
  io.emit('blackjack:state', snapshot());
}

// ---------- Phase transitions ----------
function startBetting() {
  clearTimeout(phaseTimer);
  clearTimeout(turnTimer);
  const round = generateShoe();
  state.phase = 'betting';
  state.roundId += 1;
  state.serverSeed = round.serverSeed;
  state.hash = round.hash;
  state.shoe = round.shoe;
  state.dealer = emptyDealer();
  state.activeSeat = null;
  state.activeHand = 0;

  // Drop players who disconnected mid-round, then keep the rest and reset their
  // per-round hands/bets.
  for (let i = 0; i < state.seats.length; i++) {
    if (state.seats[i] && state.seats[i].abandoned) state.seats[i] = null;
  }
  for (const seat of state.seats) {
    if (!seat) continue;
    seat.baseBet = 0;
    seat.hands = [];
    seat.sittingOut = true;
  }

  state.phaseEndsAt = Date.now() + B.bettingMs;
  broadcast();
  phaseTimer = setTimeout(endBetting, B.bettingMs);
}

function endBetting() {
  const active = state.seats.filter((s) => s && s.baseBet > 0);
  if (active.length === 0) {
    // Nobody bet — idle briefly, then open betting again.
    state.phase = 'result';
    state.phaseEndsAt = Date.now() + B.idleMs;
    broadcast();
    phaseTimer = setTimeout(startBetting, B.idleMs);
    return;
  }
  dealRound(active);
}

function dealRound(activeSeats) {
  state.phase = 'playing';

  // Initial hand for each active seat.
  for (const seat of activeSeats) {
    seat.sittingOut = false;
    seat.hands = [makeHand(seat.baseBet)];
  }
  state.dealer = { cards: [], hideHole: true };

  // Two-pass deal: a card to each player, then the dealer, twice.
  for (let pass = 0; pass < 2; pass++) {
    for (const seat of activeSeats) seat.hands[0].cards.push(draw());
    state.dealer.cards.push(draw());
  }

  // Natural blackjacks stand immediately.
  for (const seat of activeSeats) {
    const h = seat.hands[0];
    if (isBlackjack(h.cards)) h.status = 'blackjack';
  }

  // Dealer peek: if the upcard can make blackjack and the hole confirms it,
  // the round ends right away without any player turns.
  const up = state.dealer.cards[0];
  const peeks = up.rank === 'A' || cardValue(up.rank) === 10;
  if (peeks && isBlackjack(state.dealer.cards)) {
    state.dealer.hideHole = false;
    return settleRound();
  }

  advanceTurn(true);
}

// Find the next hand that still needs to act, starting from the current
// pointer. `fresh` starts the search from the very first seat/hand.
function advanceTurn(fresh) {
  let seatIdx = fresh ? 0 : state.activeSeat;
  let handIdx = fresh ? 0 : state.activeHand + 1;

  for (; seatIdx < state.seats.length; seatIdx++, handIdx = 0) {
    const seat = state.seats[seatIdx];
    if (!seat || !seat.hands.length) continue;
    for (; handIdx < seat.hands.length; handIdx++) {
      if (seat.hands[handIdx].status === 'playing') {
        setActiveHand(seatIdx, handIdx);
        return;
      }
    }
  }
  startDealer();
}

function setActiveHand(seatIdx, handIdx) {
  clearTimeout(turnTimer);
  state.activeSeat = seatIdx;
  state.activeHand = handIdx;
  state.turnEndsAt = Date.now() + B.turnMs;
  state.turnSeq += 1;
  const seq = state.turnSeq;
  broadcast();
  turnTimer = setTimeout(() => {
    if (seq !== state.turnSeq || state.phase !== 'playing') return;
    // Auto-stand on timeout.
    const seat = state.seats[seatIdx];
    if (seat && seat.hands[handIdx] && seat.hands[handIdx].status === 'playing') {
      seat.hands[handIdx].status = 'stand';
    }
    advanceTurn(false);
  }, B.turnMs);
}

function startDealer() {
  clearTimeout(turnTimer);
  state.phase = 'dealer';
  state.activeSeat = null;
  state.dealer.hideHole = false;

  // Dealer only draws if at least one standing hand can still win.
  const someoneStanding = state.seats.some(
    (s) => s && s.hands.some((h) => h.status === 'stand'),
  );
  broadcast();

  if (!someoneStanding) {
    phaseTimer = setTimeout(settleRound, B.dealerStepMs);
    return;
  }
  phaseTimer = setTimeout(dealerStep, B.dealerStepMs);
}

function dealerStep() {
  const { total } = handValue(state.dealer.cards);
  if (total < 17) {
    state.dealer.cards.push(draw());
    broadcast();
    phaseTimer = setTimeout(dealerStep, B.dealerStepMs);
  } else {
    phaseTimer = setTimeout(settleRound, B.dealerStepMs);
  }
}

function settleRound() {
  clearTimeout(turnTimer);
  state.phase = 'result';
  state.dealer.hideHole = false;

  const dealer = handValue(state.dealer.cards);
  const dealerBust = dealer.total > 21;
  const dealerBJ = isBlackjack(state.dealer.cards);

  for (const seat of state.seats) {
    if (!seat || !seat.hands.length) continue;
    for (const h of seat.hands) {
      const hv = handValue(h.cards);
      let outcome;
      let payout = 0; // total credited back (stake + winnings)
      if (h.status === 'blackjack') {
        if (dealerBJ) {
          outcome = 'push';
          payout = h.bet;
        } else {
          outcome = 'blackjack';
          payout = Math.floor(h.bet * 2.5); // 3:2
        }
      } else if (h.status === 'bust' || hv.total > 21) {
        outcome = 'lose';
      } else if (dealerBJ) {
        outcome = 'lose';
      } else if (dealerBust || hv.total > dealer.total) {
        outcome = 'win';
        payout = h.bet * 2;
      } else if (hv.total === dealer.total) {
        outcome = 'push';
        payout = h.bet;
      } else {
        outcome = 'lose';
      }

      h.result = { outcome, net: payout - h.bet };
      if (payout > 0) {
        adjustBalance(seat.userId, payout, `blackjack_${outcome}`);
        emitBalance(seat.userId);
      }
    }
  }

  db.prepare(
    'INSERT INTO blackjack_rounds (dealer_value, server_seed, hash) VALUES (?, ?, ?)',
  ).run(dealer.total, state.serverSeed, state.hash);
  state.history.unshift({ dealer: dealer.total, bust: dealerBust, blackjack: dealerBJ });
  if (state.history.length > B.historySize) state.history.length = B.historySize;

  state.phaseEndsAt = Date.now() + B.resultMs;
  broadcast();
  phaseTimer = setTimeout(startBetting, B.resultMs);
}

// ---------- Player actions ----------
function sit(socket, { seat: seatIdx } = {}) {
  const user = socket.data.user;
  if (!user) return socket.emit('blackjack:error', { message: 'Log in to take a seat.' });
  if (state.phase !== 'betting' && state.phase !== 'result') {
    return socket.emit('blackjack:error', { message: 'Wait for the next round to sit down.' });
  }
  const idx = Math.floor(Number(seatIdx));
  if (!Number.isInteger(idx) || idx < 0 || idx >= state.seats.length) {
    return socket.emit('blackjack:error', { message: 'Invalid seat.' });
  }
  if (seatOfUser(user.id) !== -1) {
    return socket.emit('blackjack:error', { message: 'You are already seated.' });
  }
  if (state.seats[idx]) {
    return socket.emit('blackjack:error', { message: 'That seat is taken.' });
  }
  state.seats[idx] = {
    userId: user.id,
    username: user.username,
    baseBet: 0,
    hands: [],
    sittingOut: true,
  };
  broadcast();
}

function leave(socket) {
  const user = socket.data.user;
  if (!user) return;
  const idx = seatOfUser(user.id);
  if (idx === -1) return;
  if (state.phase !== 'betting' && state.phase !== 'result') {
    return socket.emit('blackjack:error', { message: 'You can leave between rounds only.' });
  }
  const seat = state.seats[idx];
  // Refund any bet placed during the current betting phase.
  if (state.phase === 'betting' && seat.baseBet > 0) {
    adjustBalance(user.id, seat.baseBet, 'blackjack_leave_refund');
    emitBalance(user.id);
  }
  state.seats[idx] = null;
  broadcast();
}

function placeBet(socket, { amount } = {}) {
  const user = socket.data.user;
  if (!user) return socket.emit('blackjack:error', { message: 'Log in to bet.' });
  if (state.phase !== 'betting') {
    return socket.emit('blackjack:error', { message: 'Betting is closed for this round.' });
  }
  const idx = seatOfUser(user.id);
  if (idx === -1) {
    return socket.emit('blackjack:error', { message: 'Take a seat before betting.' });
  }
  const seat = state.seats[idx];
  const stake = Math.floor(Number(amount));
  if (!Number.isFinite(stake) || stake < 1) {
    return socket.emit('blackjack:error', { message: 'Enter a bet of at least 1 coin.' });
  }
  if (seat.baseBet + stake > B.maxBet) {
    return socket.emit('blackjack:error', { message: `Max bet is ${B.maxBet} coins.` });
  }
  try {
    adjustBalance(user.id, -stake, 'blackjack_bet');
  } catch {
    return socket.emit('blackjack:error', { message: 'Insufficient balance.' });
  }
  seat.baseBet += stake;
  seat.sittingOut = false;
  emitBalance(user.id);
  broadcast();
}

function clearBet(socket) {
  const user = socket.data.user;
  if (!user) return;
  if (state.phase !== 'betting') return;
  const idx = seatOfUser(user.id);
  if (idx === -1) return;
  const seat = state.seats[idx];
  if (seat.baseBet <= 0) return;
  adjustBalance(user.id, seat.baseBet, 'blackjack_clear');
  seat.baseBet = 0;
  seat.sittingOut = true;
  emitBalance(user.id);
  broadcast();
}

// Returns the active hand if it belongs to the requesting user, else null
// (and emits an error explaining why the action was rejected).
function activeHandFor(socket) {
  const user = socket.data.user;
  if (!user) return null;
  if (state.phase !== 'playing') {
    socket.emit('blackjack:error', { message: 'Not your turn right now.' });
    return null;
  }
  const seat = state.seats[state.activeSeat];
  if (!seat || seat.userId !== user.id) {
    socket.emit('blackjack:error', { message: "It's not your turn." });
    return null;
  }
  const hand = seat.hands[state.activeHand];
  if (!hand || hand.status !== 'playing') return null;
  return { seat, hand, user };
}

function hit(socket) {
  const ctx = activeHandFor(socket);
  if (!ctx) return;
  const { hand } = ctx;
  hand.cards.push(draw());
  const { total } = handValue(hand.cards);
  if (total > 21) {
    hand.status = 'bust';
    advanceTurn(false);
  } else if (total === 21) {
    hand.status = 'stand';
    advanceTurn(false);
  } else {
    // Same turn continues; refresh the timer.
    setActiveHand(state.activeSeat, state.activeHand);
  }
}

function stand(socket) {
  const ctx = activeHandFor(socket);
  if (!ctx) return;
  ctx.hand.status = 'stand';
  advanceTurn(false);
}

function double(socket) {
  const ctx = activeHandFor(socket);
  if (!ctx) return;
  const { hand, user } = ctx;
  if (hand.cards.length !== 2 || hand.doubled) {
    return socket.emit('blackjack:error', { message: 'You can only double on your first two cards.' });
  }
  try {
    adjustBalance(user.id, -hand.bet, 'blackjack_double');
  } catch {
    return socket.emit('blackjack:error', { message: 'Insufficient balance to double.' });
  }
  hand.bet *= 2;
  hand.doubled = true;
  emitBalance(user.id);
  hand.cards.push(draw());
  hand.status = handValue(hand.cards).total > 21 ? 'bust' : 'stand';
  advanceTurn(false);
}

function split(socket) {
  const ctx = activeHandFor(socket);
  if (!ctx) return;
  const { seat, hand, user } = ctx;
  if (hand.cards.length !== 2 || cardValue(hand.cards[0].rank) !== cardValue(hand.cards[1].rank)) {
    return socket.emit('blackjack:error', { message: 'You can only split a matching pair.' });
  }
  if (seat.hands.length >= B.maxHands) {
    return socket.emit('blackjack:error', { message: 'You cannot split any further.' });
  }
  try {
    adjustBalance(user.id, -hand.bet, 'blackjack_split');
  } catch {
    return socket.emit('blackjack:error', { message: 'Insufficient balance to split.' });
  }
  emitBalance(user.id);

  const isAces = hand.cards[0].rank === 'A';
  const moved = hand.cards.pop();
  const newHand = makeHand(hand.bet);
  newHand.cards.push(moved);

  // Each split hand draws one card to replace the moved one.
  hand.cards.push(draw());
  newHand.cards.push(draw());

  // Split aces receive a single card each and stand automatically.
  if (isAces) {
    hand.status = 'stand';
    newHand.status = 'stand';
  } else {
    if (handValue(hand.cards).total === 21) hand.status = 'stand';
    if (handValue(newHand.cards).total === 21) newHand.status = 'stand';
  }

  seat.hands.splice(state.activeHand + 1, 0, newHand);
  // Keep acting on the current (first) split hand if it can still play,
  // otherwise move on (which lands on the freshly inserted second hand).
  if (hand.status === 'playing') setActiveHand(state.activeSeat, state.activeHand);
  else advanceTurn(false);
}

// ---------- Wiring ----------
export function initBlackjack(socketServer) {
  io = socketServer;

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) {
      socket.join(userRoom(user.id));
      connections.set(user.id, (connections.get(user.id) || 0) + 1);
      // They're back — cancel any pending seat removal.
      clearTimeout(abandonTimers.get(user.id));
      abandonTimers.delete(user.id);
      const idx = seatOfUser(user.id);
      if (idx !== -1) state.seats[idx].abandoned = false;
    }

    socket.emit('blackjack:state', snapshot());

    socket.on('blackjack:sync', () => socket.emit('blackjack:state', snapshot()));
    socket.on('blackjack:sit', (p) => sit(socket, p || {}));
    socket.on('blackjack:leave', () => leave(socket));
    socket.on('blackjack:bet', (p) => placeBet(socket, p || {}));
    socket.on('blackjack:clear', () => clearBet(socket));
    socket.on('blackjack:hit', () => hit(socket));
    socket.on('blackjack:stand', () => stand(socket));
    socket.on('blackjack:double', () => double(socket));
    socket.on('blackjack:split', () => split(socket));

    socket.on('disconnect', () => {
      if (!user) return;
      const remaining = (connections.get(user.id) || 1) - 1;
      if (remaining <= 0) {
        connections.delete(user.id);
        if (seatOfUser(user.id) !== -1) scheduleSeatRemoval(user.id);
      } else {
        connections.set(user.id, remaining);
      }
    });
  });

  startBetting();
}
