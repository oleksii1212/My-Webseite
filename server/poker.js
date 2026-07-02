// GOLDBET — Poker: single-player Jacks-or-Better video poker, provably fair.
// The deck is shuffled from a server seed (hash shown first); the player is
// dealt 5 cards, holds any of them, and draws replacements. The final hand is
// paid per the standard 9/6 pay table.
import { config } from './config.js';
import { adjustBalance } from './users.js';
import { newSeed, makeRng, shuffle } from './fair.js';
import { makeBalanceEmitter, recordRound, parseBet } from './games-common.js';

const MAX_BET = config.games.maxBet;

// Pay table as total return per 1 coin staked (a "push" returns the stake).
const PAYOUTS = {
  royal: 250,
  straightFlush: 50,
  four: 25,
  fullHouse: 9,
  flush: 6,
  straight: 4,
  three: 3,
  twoPair: 2,
  jacks: 1,
  none: 0,
};

const RANK_LABELS = {
  royal: 'Royal Flush',
  straightFlush: 'Straight Flush',
  four: 'Four of a Kind',
  fullHouse: 'Full House',
  flush: 'Flush',
  straight: 'Straight',
  three: 'Three of a Kind',
  twoPair: 'Two Pair',
  jacks: 'Jacks or Better',
  none: 'No win',
};

function freshDeck() {
  const deck = [];
  for (let suit = 0; suit < 4; suit += 1) {
    for (let rank = 2; rank <= 14; rank += 1) deck.push({ rank, suit });
  }
  return deck;
}

function evaluate(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  const flush = cards.every((c) => c.suit === cards[0].suit);

  const counts = {};
  ranks.forEach((r) => {
    counts[r] = (counts[r] || 0) + 1;
  });
  const countVals = Object.values(counts).sort((a, b) => b - a);

  const wheel = ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 4 && ranks[3] === 5 && ranks[4] === 14;
  const runStraight = ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);
  const straight = runStraight || wheel;

  if (straight && flush) return ranks[0] === 10 ? 'royal' : 'straightFlush';
  if (countVals[0] === 4) return 'four';
  if (countVals[0] === 3 && countVals[1] === 2) return 'fullHouse';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (countVals[0] === 3) return 'three';
  if (countVals[0] === 2 && countVals[1] === 2) return 'twoPair';
  if (countVals[0] === 2) {
    const pairRank = Number(Object.keys(counts).find((r) => counts[r] === 2));
    return pairRank >= 11 || pairRank === 14 ? 'jacks' : 'none';
  }
  return 'none';
}

export function initPoker(io) {
  const emitBalance = makeBalanceEmitter(io, 'poker:balance');
  const games = new Map(); // userId -> dealt hand awaiting a draw

  function deal(socket, payload = {}) {
    const user = socket.data.user;
    if (!user) return socket.emit('poker:error', { message: 'Log in to play.' });
    if (games.has(user.id)) {
      return socket.emit('poker:error', { message: 'Finish your current hand first.' });
    }

    let bet;
    try {
      bet = parseBet(payload.amount, MAX_BET);
      adjustBalance(user.id, -bet, 'poker_bet');
    } catch (err) {
      return socket.emit('poker:error', { message: err.message || 'Invalid bet.' });
    }

    const { serverSeed, hash } = newSeed();
    const deck = shuffle(freshDeck(), makeRng(serverSeed));
    const hand = deck.slice(0, 5);

    games.set(user.id, { bet, deck, hand, serverSeed, hash, next: 5 });
    emitBalance(user.id);
    socket.emit('poker:dealt', { bet, hand, hash, payouts: PAYOUTS });
  }

  function draw(socket, payload = {}) {
    const user = socket.data.user;
    if (!user) return;
    const game = games.get(user.id);
    if (!game) return socket.emit('poker:error', { message: 'Deal a hand first.' });

    const holds = Array.isArray(payload.holds) ? payload.holds : [];
    const finalHand = game.hand.map((card, i) => {
      if (holds[i]) return card;
      const replacement = game.deck[game.next];
      game.next += 1;
      return replacement;
    });

    const rank = evaluate(finalHand);
    const multiplier = PAYOUTS[rank];
    const payout = Math.floor(game.bet * multiplier);
    if (payout > 0) adjustBalance(user.id, payout, 'poker_win');

    recordRound({
      userId: user.id,
      game: 'poker',
      bet: game.bet,
      payout,
      result: { rank, multiplier, hand: finalHand },
      serverSeed: game.serverSeed,
      hash: game.hash,
    });
    games.delete(user.id);
    emitBalance(user.id);
    socket.emit('poker:result', {
      hand: finalHand,
      rank,
      rankLabel: RANK_LABELS[rank],
      multiplier,
      payout,
      serverSeed: game.serverSeed,
      hash: game.hash,
    });
  }

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) socket.join(`user:${user.id}`);
    socket.on('poker:deal', (payload) => deal(socket, payload || {}));
    socket.on('poker:draw', (payload) => draw(socket, payload || {}));
  });
}
