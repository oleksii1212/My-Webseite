// Helpers shared by the single-player games: per-user balance push and a
// verifiable round-history record in the shared ledger.
import { db } from './db.js';
import { getUserById } from './users.js';

export function userRoom(userId) {
  return `user:${userId}`;
}

// Returns a function that pushes the authoritative balance to one user over the
// given socket event (e.g. 'dice:balance'), so the topbar stays in sync.
export function makeBalanceEmitter(io, event) {
  return function emitBalance(userId) {
    const user = getUserById(userId);
    if (user) io.to(userRoom(userId)).emit(event, { balance: user.balance });
  };
}

const insertRound = db.prepare(
  `INSERT INTO game_rounds (user_id, game, bet, payout, result, server_seed, hash)
   VALUES (@userId, @game, @bet, @payout, @result, @serverSeed, @hash)`,
);

export function recordRound({ userId, game, bet, payout, result, serverSeed, hash }) {
  insertRound.run({
    userId,
    game,
    bet,
    payout,
    result: JSON.stringify(result),
    serverSeed,
    hash,
  });
}

// Validate a coin bet against the shared limits. Returns the integer amount or
// throws an Error with a user-facing message.
export function parseBet(amount, maxBet) {
  const bet = Math.floor(Number(amount));
  if (!Number.isFinite(bet) || bet < 1 || bet > maxBet) {
    throw new Error(`Bet must be between 1 and ${maxBet} coins.`);
  }
  return bet;
}
