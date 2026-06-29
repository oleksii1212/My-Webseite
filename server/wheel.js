// GOLDBET — Wheel: a single-player, instant, provably-fair game. The wheel is a
// ring of equally-likely segments; the ball lands on one and pays its
// multiplier. Each risk level has its own ring, scaled so the average return
// equals the configured RTP.
import { config } from './config.js';
import { adjustBalance } from './users.js';
import { newSeed, makeRng } from './fair.js';
import { makeBalanceEmitter, recordRound, parseBet } from './games-common.js';

const RTP = 1 - config.games.houseEdge;
const MAX_BET = config.games.maxBet;

// Raw segment specs per risk: { multiplier: count }. Values are scaled below so
// each ring's mean multiplier equals the RTP.
const SPECS = {
  low: [
    { value: 0, count: 4 },
    { value: 1.5, count: 12 },
    { value: 1.7, count: 6 },
    { value: 2, count: 2 },
  ],
  medium: [
    { value: 0, count: 10 },
    { value: 1.5, count: 10 },
    { value: 2, count: 6 },
    { value: 4, count: 3 },
    { value: 10, count: 1 },
  ],
  high: [
    { value: 0, count: 24 },
    { value: 2, count: 8 },
    { value: 5, count: 4 },
    { value: 20, count: 3 },
    { value: 50, count: 1 },
  ],
};

// Spread the values round-robin so colors alternate around the ring, then scale
// the non-zero multipliers so the ring's mean equals the RTP.
function buildRing(spec) {
  const queues = spec.map((s) => Array(s.count).fill(s.value));
  const ring = [];
  let remaining = spec.reduce((n, s) => n + s.count, 0);
  let i = 0;
  while (remaining > 0) {
    const q = queues[i % queues.length];
    if (q.length) {
      ring.push(q.shift());
      remaining -= 1;
    }
    i += 1;
  }
  const sum = ring.reduce((s, v) => s + v, 0);
  const scale = (RTP * ring.length) / sum;
  return ring.map((v) => Math.round(v * scale * 100) / 100);
}

const RINGS = Object.fromEntries(Object.keys(SPECS).map((risk) => [risk, buildRing(SPECS[risk])]));

export function initWheel(io) {
  const emitBalance = makeBalanceEmitter(io, 'wheel:balance');

  function spin(socket, payload = {}) {
    const user = socket.data.user;
    if (!user) return socket.emit('wheel:error', { message: 'Log in to play.' });

    const risk = RINGS[payload.risk] ? payload.risk : 'medium';

    let bet;
    try {
      bet = parseBet(payload.amount, MAX_BET);
      adjustBalance(user.id, -bet, 'wheel_bet');
    } catch (err) {
      return socket.emit('wheel:error', { message: err.message || 'Invalid bet.' });
    }

    const ring = RINGS[risk];
    const { serverSeed, hash } = newSeed();
    const rng = makeRng(serverSeed);
    const index = rng.int(ring.length);
    const multiplier = ring[index];
    const payout = Math.floor(bet * multiplier);
    if (payout > 0) adjustBalance(user.id, payout, 'wheel_win');

    recordRound({
      userId: user.id,
      game: 'wheel',
      bet,
      payout,
      result: { risk, index, multiplier },
      serverSeed,
      hash,
    });
    emitBalance(user.id);
    socket.emit('wheel:result', {
      risk,
      index,
      multiplier,
      ring,
      bet,
      payout,
      hash,
      serverSeed,
    });
  }

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) socket.join(`user:${user.id}`);
    socket.emit('wheel:rings', RINGS);
    socket.on('wheel:sync', () => socket.emit('wheel:rings', RINGS));
    socket.on('wheel:spin', (payload) => spin(socket, payload || {}));
  });
}
