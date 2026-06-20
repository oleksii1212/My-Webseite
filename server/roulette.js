// GOLDBET — Roulette engine. One shared, server-authoritative round broadcast
// to every client: a betting phase, then the wheel spins to a winning number,
// then payouts are settled. Mirrors the structure of server/crash.js.

import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';
import { adjustBalance, getUserById } from './users.js';

const R = config.roulette;

// European single-zero roulette: numbers 0-36.
const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export function colorOf(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

// Profit-to-stake ratio for each bet type (winning bet returns stake * (ratio + 1)).
const PAYOUTS = {
  straight: 35,
  red: 1,
  black: 1,
  even: 1,
  odd: 1,
  low: 1,
  high: 1,
  dozen: 2,
};

// Does a given bet win for the winning number? `value` only matters for
// straight (the number, 0-36) and dozen (1 | 2 | 3).
function betWins(type, value, n) {
  if (n === 0) return type === 'straight' && value === 0;
  switch (type) {
    case 'straight':
      return value === n;
    case 'red':
      return colorOf(n) === 'red';
    case 'black':
      return colorOf(n) === 'black';
    case 'even':
      return n % 2 === 0;
    case 'odd':
      return n % 2 === 1;
    case 'low':
      return n >= 1 && n <= 18;
    case 'high':
      return n >= 19 && n <= 36;
    case 'dozen':
      return Math.ceil(n / 12) === value;
    default:
      return false;
  }
}

// ---------- Provably-fair winning number ----------
function generateRound() {
  const serverSeed = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
  const winningNumber = parseInt(hash.slice(0, 8), 16) % 37; // 0-36
  return { serverSeed, hash, winningNumber };
}

// ---------- Shared, single-round game state ----------
const state = {
  phase: 'idle', // 'betting' | 'spinning' | 'result'
  roundId: 0,
  winningNumber: null,
  serverSeed: '',
  hash: '',
  phaseEndsAt: 0,
  // userId -> { username, bets: [{ type, value, amount }], staked, payout, net }
  players: new Map(),
  history: [], // recent winning numbers, newest first
};

let io = null;

function userRoom(userId) {
  return `user:${userId}`;
}

function emitBalance(userId) {
  const user = getUserById(userId);
  if (user) io.to(userRoom(userId)).emit('roulette:balance', { balance: user.balance });
}

function playersPayload() {
  const players = [...state.players.values()]
    .map((p) => ({
      username: p.username,
      staked: p.staked,
      betCount: p.bets.length,
      payout: p.payout,
      net: p.net,
      settled: p.settled,
    }))
    .sort((a, b) => b.staked - a.staked);
  const totalBet = players.reduce((sum, p) => sum + p.staked, 0);
  return { players, totalBet, count: players.length };
}

function broadcastPlayers() {
  io.emit('roulette:players', playersPayload());
}

function myBetsPayload(userId) {
  const p = state.players.get(userId);
  return { bets: p ? p.bets : [], staked: p ? p.staked : 0 };
}

function emitMyBets(userId) {
  io.to(userRoom(userId)).emit('roulette:mybets', myBetsPayload(userId));
}

function snapshot() {
  const now = Date.now();
  return {
    phase: state.phase,
    roundId: state.roundId,
    history: state.history,
    hash: state.hash,
    phaseRemainingMs: Math.max(0, state.phaseEndsAt - now),
    // The number is public once the wheel is spinning (betting is closed by then).
    winningNumber: state.phase === 'betting' ? null : state.winningNumber,
    serverSeed: state.phase === 'result' ? state.serverSeed : null,
    ...playersPayload(),
  };
}

// ---------- Phase transitions ----------
function startBetting() {
  const round = generateRound();
  state.phase = 'betting';
  state.roundId += 1;
  state.winningNumber = round.winningNumber;
  state.serverSeed = round.serverSeed;
  state.hash = round.hash;
  state.phaseEndsAt = Date.now() + R.bettingMs;
  state.players.clear();

  io.emit('roulette:betting', {
    roundId: state.roundId,
    durationMs: R.bettingMs,
    phaseRemainingMs: R.bettingMs,
    hash: state.hash,
    history: state.history,
  });
  broadcastPlayers();

  setTimeout(startSpinning, R.bettingMs);
}

function startSpinning() {
  state.phase = 'spinning';
  state.phaseEndsAt = Date.now() + R.spinningMs;
  io.emit('roulette:spinning', {
    roundId: state.roundId,
    winningNumber: state.winningNumber,
    durationMs: R.spinningMs,
  });
  setTimeout(settleRound, R.spinningMs);
}

function settleRound() {
  state.phase = 'result';
  state.phaseEndsAt = Date.now() + R.resultMs;
  const n = state.winningNumber;

  for (const player of state.players.values()) {
    let payout = 0;
    for (const bet of player.bets) {
      if (betWins(bet.type, bet.value, n)) {
        payout += bet.amount * (PAYOUTS[bet.type] + 1);
      }
    }
    player.payout = payout;
    player.net = payout - player.staked;
    player.settled = true;
    if (payout > 0) {
      adjustBalance(player.userId, payout, 'roulette_win');
      emitBalance(player.userId);
    }
  }

  db.prepare(
    'INSERT INTO roulette_rounds (winning_number, server_seed, hash) VALUES (?, ?, ?)',
  ).run(n, state.serverSeed, state.hash);
  state.history.unshift(n);
  if (state.history.length > R.historySize) state.history.length = R.historySize;

  io.emit('roulette:result', {
    roundId: state.roundId,
    winningNumber: n,
    color: colorOf(n),
    serverSeed: state.serverSeed,
    hash: state.hash,
  });
  broadcastPlayers();

  setTimeout(startBetting, R.resultMs);
}

// ---------- Bet actions ----------
function placeBet(socket, { type, value, amount } = {}) {
  const user = socket.data.user;
  if (!user) return socket.emit('roulette:error', { message: 'Log in to place a bet.' });
  if (state.phase !== 'betting') {
    return socket.emit('roulette:error', { message: 'Betting is closed for this round.' });
  }
  if (!Object.prototype.hasOwnProperty.call(PAYOUTS, type)) {
    return socket.emit('roulette:error', { message: 'Unknown bet type.' });
  }

  let val = null;
  if (type === 'straight') {
    val = Math.floor(Number(value));
    if (!Number.isInteger(val) || val < 0 || val > 36) {
      return socket.emit('roulette:error', { message: 'Pick a number from 0 to 36.' });
    }
  } else if (type === 'dozen') {
    val = Math.floor(Number(value));
    if (![1, 2, 3].includes(val)) {
      return socket.emit('roulette:error', { message: 'Invalid dozen.' });
    }
  }

  const stake = Math.floor(Number(amount));
  if (!Number.isFinite(stake) || stake < 1 || stake > R.maxBet) {
    return socket.emit('roulette:error', { message: `Bet must be between 1 and ${R.maxBet} coins.` });
  }

  try {
    adjustBalance(user.id, -stake, 'roulette_bet');
  } catch {
    return socket.emit('roulette:error', { message: 'Insufficient balance.' });
  }

  let player = state.players.get(user.id);
  if (!player) {
    player = {
      userId: user.id,
      username: user.username,
      bets: [],
      staked: 0,
      payout: null,
      net: null,
      settled: false,
    };
    state.players.set(user.id, player);
  }

  // Merge with an existing identical bet to keep the list tidy.
  const existing = player.bets.find((b) => b.type === type && b.value === val);
  if (existing) existing.amount += stake;
  else player.bets.push({ type, value: val, amount: stake });
  player.staked += stake;

  emitBalance(user.id);
  emitMyBets(user.id);
  broadcastPlayers();
}

function clearBets(socket) {
  const user = socket.data.user;
  if (!user) return;
  if (state.phase !== 'betting') {
    return socket.emit('roulette:error', { message: 'Too late to clear bets.' });
  }
  const player = state.players.get(user.id);
  if (!player || player.staked === 0) return;
  adjustBalance(user.id, player.staked, 'roulette_clear');
  state.players.delete(user.id);
  emitBalance(user.id);
  emitMyBets(user.id);
  broadcastPlayers();
}

// ---------- Wiring ----------
export function initRoulette(socketServer) {
  io = socketServer;

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) socket.join(userRoom(user.id));

    socket.emit('roulette:state', snapshot());
    if (user) socket.emit('roulette:mybets', myBetsPayload(user.id));

    socket.on('roulette:sync', () => {
      socket.emit('roulette:state', snapshot());
      const u = socket.data.user;
      if (u) socket.emit('roulette:mybets', myBetsPayload(u.id));
    });
    socket.on('roulette:bet', (payload) => placeBet(socket, payload || {}));
    socket.on('roulette:clear', () => clearBets(socket));
  });

  startBetting();
}
