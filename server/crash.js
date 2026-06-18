import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { adjustBalance, getUserById } from './users.js';

const C = config.crash;

// ---------- Provably-fair crash point ----------
// Each round we pick a random server seed and hash it. The crash point is
// derived from the hash, so it is fixed before the round starts and can be
// verified afterwards. ~1% of rounds bust instantly at 1.00x (the house edge).
function crashPointFromHash(hash) {
  const h = parseInt(hash.slice(0, 13), 16); // 52 bits of entropy
  const e = 2 ** 52;
  if (h % 101 === 0) return 1.0; // instant bust
  const point = Math.floor((100 * e - h) / (e - h)) / 100;
  return Math.max(1.0, point);
}

function generateRound() {
  const serverSeed = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
  return { serverSeed, hash, crashPoint: crashPointFromHash(hash) };
}

// Multiplier as a function of elapsed running time (must match the client).
function multiplierAt(elapsedMs) {
  return Math.floor(100 * Math.exp(C.growthRatePerMs * elapsedMs)) / 100;
}

// ---------- Shared, single-round game state ----------
const state = {
  phase: 'idle', // 'betting' | 'running' | 'crashed'
  roundId: 0,
  crashPoint: 0,
  serverSeed: '',
  hash: '',
  startTime: 0, // ms timestamp when the running phase began
  phaseEndsAt: 0, // ms timestamp the current betting phase ends
  multiplier: 1.0,
  bets: new Map(), // userId -> bet
  history: [], // recent crash points, newest first
};

let io = null;
let tickTimer = null;

function userRoom(userId) {
  return `user:${userId}`;
}

function emitBalance(userId) {
  const user = getUserById(userId);
  if (user) io.to(userRoom(userId)).emit('crash:balance', { balance: user.balance });
}

function playersPayload() {
  const players = [...state.bets.values()]
    .map((b) => ({
      username: b.username,
      amount: b.amount,
      autoCashout: b.autoCashout,
      cashedOutAt: b.cashedOutAt,
      payout: b.payout,
      status: b.status,
    }))
    .sort((a, b) => b.amount - a.amount);
  const totalBet = players.reduce((sum, p) => sum + p.amount, 0);
  return { players, totalBet, count: players.length };
}

function broadcastPlayers() {
  io.emit('crash:players', playersPayload());
}

function snapshot() {
  const now = Date.now();
  return {
    phase: state.phase,
    roundId: state.roundId,
    multiplier: state.multiplier,
    history: state.history,
    bettingMs: C.bettingMs,
    phaseRemainingMs: state.phase === 'betting' ? Math.max(0, state.phaseEndsAt - now) : 0,
    elapsedMs: state.phase === 'running' ? now - state.startTime : 0,
    crashPoint: state.phase === 'crashed' ? state.crashPoint : null,
    hash: state.phase === 'crashed' ? state.hash : null,
    serverSeed: state.phase === 'crashed' ? state.serverSeed : null,
    ...playersPayload(),
  };
}

// ---------- Phase transitions ----------
function startBetting() {
  const round = generateRound();
  state.phase = 'betting';
  state.roundId += 1;
  state.crashPoint = round.crashPoint;
  state.serverSeed = round.serverSeed;
  state.hash = round.hash;
  state.multiplier = 1.0;
  state.startTime = 0;
  state.phaseEndsAt = Date.now() + C.bettingMs;
  state.bets.clear();

  io.emit('crash:betting', {
    roundId: state.roundId,
    durationMs: C.bettingMs,
    phaseRemainingMs: C.bettingMs,
    history: state.history,
  });
  broadcastPlayers();

  setTimeout(startRunning, C.bettingMs);
}

function startRunning() {
  state.phase = 'running';
  state.startTime = Date.now();
  state.multiplier = 1.0;
  io.emit('crash:running', { roundId: state.roundId, durationMs: C.tickMs });
  tickTimer = setInterval(tick, C.tickMs);
}

function tick() {
  const elapsed = Date.now() - state.startTime;
  const m = multiplierAt(elapsed);

  if (m >= state.crashPoint) {
    crashRound();
    return;
  }

  state.multiplier = m;
  // Trigger any auto cash-outs whose target has been reached.
  for (const bet of state.bets.values()) {
    if (bet.status === 'in' && bet.autoCashout && m >= bet.autoCashout) {
      settleWin(bet, bet.autoCashout);
    }
  }
  io.emit('crash:tick', { multiplier: m });
}

function crashRound() {
  clearInterval(tickTimer);
  tickTimer = null;
  state.phase = 'crashed';
  state.multiplier = state.crashPoint;

  // Honour auto cash-outs whose target was below the crash point but a coarse
  // tick may have skipped over, then settle everyone else as a loss.
  for (const bet of state.bets.values()) {
    if (bet.status !== 'in') continue;
    if (bet.autoCashout && bet.autoCashout <= state.crashPoint) {
      settleWin(bet, bet.autoCashout);
    } else {
      bet.status = 'lost';
      bet.payout = 0;
      emitBalance(bet.userId);
    }
  }

  db.prepare('INSERT INTO crash_rounds (crash_point, server_seed, hash) VALUES (?, ?, ?)').run(
    state.crashPoint,
    state.serverSeed,
    state.hash,
  );
  state.history.unshift(state.crashPoint);
  if (state.history.length > C.historySize) state.history.length = C.historySize;

  io.emit('crash:crashed', {
    roundId: state.roundId,
    crashPoint: state.crashPoint,
    hash: state.hash,
    serverSeed: state.serverSeed,
  });
  broadcastPlayers();

  setTimeout(startBetting, C.crashedPauseMs);
}

// ---------- Bet / cash-out actions ----------
function settleWin(bet, multiplier) {
  const payout = Math.floor(bet.amount * multiplier);
  bet.cashedOutAt = multiplier;
  bet.payout = payout;
  bet.status = 'won';
  adjustBalance(bet.userId, payout, 'crash_win');
  emitBalance(bet.userId);
  broadcastPlayers();
}

function placeBet(socket, { amount, autoCashout } = {}) {
  const user = socket.data.user;
  if (!user) return socket.emit('crash:error', { message: 'Log in to place a bet.' });
  if (state.phase !== 'betting') {
    return socket.emit('crash:error', { message: 'Betting is closed for this round.' });
  }
  if (state.bets.has(user.id)) {
    return socket.emit('crash:error', { message: 'You already placed a bet this round.' });
  }

  const bet = Math.floor(Number(amount));
  if (!Number.isFinite(bet) || bet < 1 || bet > C.maxBet) {
    return socket.emit('crash:error', { message: `Bet must be between 1 and ${C.maxBet} coins.` });
  }

  let auto = null;
  if (autoCashout !== null && autoCashout !== undefined && autoCashout !== '') {
    auto = Math.floor(Number(autoCashout) * 100) / 100;
    if (!Number.isFinite(auto) || auto < 1.01) {
      return socket.emit('crash:error', { message: 'Auto cash-out must be at least 1.01x.' });
    }
  }

  try {
    adjustBalance(user.id, -bet, 'crash_bet');
  } catch {
    return socket.emit('crash:error', { message: 'Insufficient balance.' });
  }

  state.bets.set(user.id, {
    userId: user.id,
    username: user.username,
    amount: bet,
    autoCashout: auto,
    cashedOutAt: null,
    payout: null,
    status: 'in',
  });
  emitBalance(user.id);
  broadcastPlayers();
}

function cancelBet(socket) {
  const user = socket.data.user;
  if (!user) return;
  if (state.phase !== 'betting') {
    return socket.emit('crash:error', { message: 'Too late to cancel.' });
  }
  const bet = state.bets.get(user.id);
  if (!bet) return;
  adjustBalance(user.id, bet.amount, 'crash_cancel');
  state.bets.delete(user.id);
  emitBalance(user.id);
  broadcastPlayers();
}

function cashOut(socket) {
  const user = socket.data.user;
  if (!user) return;
  if (state.phase !== 'running') {
    return socket.emit('crash:error', { message: 'Nothing to cash out right now.' });
  }
  const bet = state.bets.get(user.id);
  if (!bet || bet.status !== 'in') return;
  settleWin(bet, state.multiplier);
}

// ---------- Wiring ----------
export function initCrash(socketServer) {
  io = socketServer;

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) socket.join(userRoom(user.id));

    socket.emit('crash:state', snapshot());

    // A client view that mounts after connection can request a fresh snapshot.
    socket.on('crash:sync', () => socket.emit('crash:state', snapshot()));
    socket.on('crash:bet', (payload) => placeBet(socket, payload || {}));
    socket.on('crash:cancel', () => cancelBet(socket));
    socket.on('crash:cashout', () => cashOut(socket));
  });

  startBetting();
}
