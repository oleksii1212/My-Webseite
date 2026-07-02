// GOLDBET — Mines: a single-player, stateful, provably-fair game. The player
// reveals tiles on a 5×5 grid; each safe tile raises the multiplier, hitting a
// mine loses the bet. Cash out any time to bank the current multiplier.
import { config } from './config.js';
import { adjustBalance } from './users.js';
import { newSeed, makeRng, shuffle } from './fair.js';
import { makeBalanceEmitter, recordRound, parseBet } from './games-common.js';

const RTP = 1 - config.games.houseEdge;
const MAX_BET = config.games.maxBet;
const TILES = 25;

// Fair multiplier after revealing `picks` safe tiles with `mines` mines on the
// board: the product of (remaining tiles / remaining safe tiles) per pick.
function multiplierFor(mines, picks) {
  let m = RTP;
  for (let i = 0; i < picks; i += 1) m *= (TILES - i) / (TILES - mines - i);
  return Math.floor(m * 100) / 100;
}

export function initMines(io) {
  const emitBalance = makeBalanceEmitter(io, 'mines:balance');
  const games = new Map(); // userId -> active game

  function start(socket, payload = {}) {
    const user = socket.data.user;
    if (!user) return socket.emit('mines:error', { message: 'Log in to play.' });
    if (games.has(user.id)) {
      return socket.emit('mines:error', { message: 'Finish your current game first.' });
    }

    const mines = Math.floor(Number(payload.mines));
    if (!Number.isFinite(mines) || mines < 1 || mines > TILES - 1) {
      return socket.emit('mines:error', { message: 'Mines must be between 1 and 24.' });
    }

    let bet;
    try {
      bet = parseBet(payload.amount, MAX_BET);
      adjustBalance(user.id, -bet, 'mines_bet');
    } catch (err) {
      return socket.emit('mines:error', { message: err.message || 'Invalid bet.' });
    }

    const { serverSeed, hash } = newSeed();
    const rng = makeRng(serverSeed);
    const tiles = shuffle([...Array(TILES).keys()], rng);
    const mineSet = new Set(tiles.slice(0, mines));

    games.set(user.id, { bet, mines, mineSet, revealed: new Set(), serverSeed, hash });
    emitBalance(user.id);
    socket.emit('mines:started', {
      mines,
      bet,
      tiles: TILES,
      hash,
      nextMultiplier: multiplierFor(mines, 1),
    });
  }

  function finish(socket, game, { tile = null } = {}) {
    const user = socket.data.user;
    const picks = game.revealed.size;
    const busted = tile !== null;
    const multiplier = busted ? 0 : multiplierFor(game.mines, picks);
    const payout = busted ? 0 : Math.floor(game.bet * multiplier);
    if (payout > 0) adjustBalance(user.id, payout, 'mines_win');

    recordRound({
      userId: user.id,
      game: 'mines',
      bet: game.bet,
      payout,
      result: { mines: game.mines, picks, busted, multiplier },
      serverSeed: game.serverSeed,
      hash: game.hash,
    });
    games.delete(user.id);
    emitBalance(user.id);
    socket.emit('mines:over', {
      busted,
      hitTile: tile,
      multiplier,
      payout,
      mineTiles: [...game.mineSet],
      revealed: [...game.revealed],
      serverSeed: game.serverSeed,
      hash: game.hash,
    });
  }

  function reveal(socket, payload = {}) {
    const user = socket.data.user;
    if (!user) return;
    const game = games.get(user.id);
    if (!game) return socket.emit('mines:error', { message: 'No active game.' });

    const tile = Math.floor(Number(payload.tile));
    if (!Number.isFinite(tile) || tile < 0 || tile >= TILES || game.revealed.has(tile)) {
      return socket.emit('mines:error', { message: 'Invalid tile.' });
    }

    if (game.mineSet.has(tile)) return finish(socket, game, { tile });

    game.revealed.add(tile);
    const picks = game.revealed.size;
    const safeTiles = TILES - game.mines;
    if (picks >= safeTiles) return finish(socket, game); // cleared the board

    socket.emit('mines:safe', {
      tile,
      picks,
      multiplier: multiplierFor(game.mines, picks),
      nextMultiplier: multiplierFor(game.mines, picks + 1),
    });
  }

  function cashout(socket) {
    const user = socket.data.user;
    if (!user) return;
    const game = games.get(user.id);
    if (!game) return socket.emit('mines:error', { message: 'No active game.' });
    if (game.revealed.size === 0) {
      return socket.emit('mines:error', { message: 'Reveal at least one tile first.' });
    }
    finish(socket, game);
  }

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) socket.join(`user:${user.id}`);
    socket.on('mines:start', (payload) => start(socket, payload || {}));
    socket.on('mines:reveal', (payload) => reveal(socket, payload || {}));
    socket.on('mines:cashout', () => cashout(socket));
  });
}
