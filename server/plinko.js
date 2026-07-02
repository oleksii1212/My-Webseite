// GOLDBET — Plinko: a single-player, instant, provably-fair game. A ball drops
// through `rows` of pegs, bouncing left/right at each one, and lands in a
// bucket whose multiplier pays out. Bucket multipliers are derived from the
// binomial landing probabilities so the table returns the configured RTP.
import { config } from './config.js';
import { adjustBalance } from './users.js';
import { newSeed, makeRng } from './fair.js';
import { makeBalanceEmitter, recordRound, parseBet } from './games-common.js';

const RTP = 1 - config.games.houseEdge;
const MAX_BET = config.games.maxBet;
const ROW_OPTIONS = [8, 12, 16];
const RISK_BASE = { low: 1.25, medium: 1.6, high: 2.1 };

function binomial(n, k) {
  let c = 1;
  for (let i = 0; i < k; i += 1) c = (c * (n - i)) / (i + 1);
  return c;
}

// Multipliers for an (rows, risk) board: a U-shaped curve (big at the edges,
// small in the middle) normalized so the expected return equals the RTP.
function buildTable(rows, risk) {
  const base = RISK_BASE[risk];
  const probs = [];
  const weights = [];
  for (let k = 0; k <= rows; k += 1) {
    probs.push(binomial(rows, k) / 2 ** rows);
    weights.push(base ** Math.abs(k - rows / 2));
  }
  const expected = probs.reduce((s, p, k) => s + p * weights[k], 0);
  const scale = RTP / expected;
  return weights.map((w) => Math.round(w * scale * 100) / 100);
}

const TABLES = {};
ROW_OPTIONS.forEach((rows) => {
  TABLES[rows] = {};
  Object.keys(RISK_BASE).forEach((risk) => {
    TABLES[rows][risk] = buildTable(rows, risk);
  });
});

export function initPlinko(io) {
  const emitBalance = makeBalanceEmitter(io, 'plinko:balance');

  function drop(socket, payload = {}) {
    const user = socket.data.user;
    if (!user) return socket.emit('plinko:error', { message: 'Log in to play.' });

    const rows = ROW_OPTIONS.includes(Number(payload.rows)) ? Number(payload.rows) : 12;
    const risk = RISK_BASE[payload.risk] ? payload.risk : 'medium';

    let bet;
    try {
      bet = parseBet(payload.amount, MAX_BET);
      adjustBalance(user.id, -bet, 'plinko_bet');
    } catch (err) {
      return socket.emit('plinko:error', { message: err.message || 'Invalid bet.' });
    }

    const { serverSeed, hash } = newSeed();
    const rng = makeRng(serverSeed);
    const path = [];
    let bucket = 0;
    for (let i = 0; i < rows; i += 1) {
      const right = rng.int(2);
      path.push(right);
      bucket += right;
    }

    const multiplier = TABLES[rows][risk][bucket];
    const payout = Math.floor(bet * multiplier);
    if (payout > 0) adjustBalance(user.id, payout, 'plinko_win');

    recordRound({
      userId: user.id,
      game: 'plinko',
      bet,
      payout,
      result: { rows, risk, bucket, multiplier },
      serverSeed,
      hash,
    });
    emitBalance(user.id);
    socket.emit('plinko:result', {
      rows,
      risk,
      path,
      bucket,
      multiplier,
      multipliers: TABLES[rows][risk],
      bet,
      payout,
      hash,
      serverSeed,
    });
  }

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) socket.join(`user:${user.id}`);
    socket.emit('plinko:tables', TABLES);
    socket.on('plinko:sync', () => socket.emit('plinko:tables', TABLES));
    socket.on('plinko:drop', (payload) => drop(socket, payload || {}));
  });
}
