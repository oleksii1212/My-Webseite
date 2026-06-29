// GOLDBET — Dice: a single-player, instant, provably-fair game. The player
// picks a target and whether the roll must land under or over it; the payout
// multiplier is the fair odds minus the house edge.
import { config } from './config.js';
import { adjustBalance } from './users.js';
import { newSeed, makeRng } from './fair.js';
import { makeBalanceEmitter, recordRound, parseBet } from './games-common.js';

const RTP = 1 - config.games.houseEdge;
const MAX_BET = config.games.maxBet;
const MIN_TARGET = 2;
const MAX_TARGET = 98;

// Win chance (%) for the chosen target/direction, and the matching multiplier.
function odds(target, direction) {
  const chance = direction === 'over' ? 100 - target : target;
  return { chance, multiplier: Math.floor((RTP * 100 * 100) / chance) / 100 };
}

export function initDice(io) {
  const emitBalance = makeBalanceEmitter(io, 'dice:balance');

  function roll(socket, payload = {}) {
    const user = socket.data.user;
    if (!user) return socket.emit('dice:error', { message: 'Log in to play.' });

    const target = Math.floor(Number(payload.target));
    const direction = payload.direction === 'over' ? 'over' : 'under';
    if (!Number.isFinite(target) || target < MIN_TARGET || target > MAX_TARGET) {
      return socket.emit('dice:error', { message: `Target must be ${MIN_TARGET}–${MAX_TARGET}.` });
    }

    let bet;
    try {
      bet = parseBet(payload.amount, MAX_BET);
      adjustBalance(user.id, -bet, 'dice_bet');
    } catch (err) {
      return socket.emit('dice:error', { message: err.message || 'Invalid bet.' });
    }

    const { serverSeed, hash } = newSeed();
    const rng = makeRng(serverSeed);
    const value = Math.floor(rng.float() * 10001) / 100; // 0.00 – 100.00
    const { chance, multiplier } = odds(target, direction);
    const win = direction === 'over' ? value > target : value < target;
    const payout = win ? Math.floor(bet * multiplier) : 0;
    if (payout > 0) adjustBalance(user.id, payout, 'dice_win');

    recordRound({
      userId: user.id,
      game: 'dice',
      bet,
      payout,
      result: { value, target, direction, win, multiplier },
      serverSeed,
      hash,
    });
    emitBalance(user.id);
    socket.emit('dice:result', {
      value,
      target,
      direction,
      win,
      multiplier,
      chance,
      bet,
      payout,
      hash,
      serverSeed,
    });
  }

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) socket.join(`user:${user.id}`);
    socket.on('dice:roll', (payload) => roll(socket, payload || {}));
  });
}
