// GOLDBET — Tower: a single-player, stateful, provably-fair climb. Each row has
// a few tiles; one safe pick advances you up the tower and raises the
// multiplier, a wrong pick ends the run. Cash out any time.
import { config } from './config.js';
import { adjustBalance } from './users.js';
import { newSeed, makeRng } from './fair.js';
import { makeBalanceEmitter, recordRound, parseBet } from './games-common.js';

const RTP = 1 - config.games.houseEdge;
const MAX_BET = config.games.maxBet;
const ROWS = 8;

// Per difficulty: number of tiles per row and how many of them are safe.
const DIFFICULTIES = {
  easy: { cols: 4, safe: 3 },
  medium: { cols: 3, safe: 2 },
  hard: { cols: 2, safe: 1 },
};

// Fair multiplier after clearing `rows` rows at the given odds.
function multiplierFor({ cols, safe }, rows) {
  let m = RTP;
  for (let i = 0; i < rows; i += 1) m *= cols / safe;
  return Math.floor(m * 100) / 100;
}

export function initTower(io) {
  const emitBalance = makeBalanceEmitter(io, 'tower:balance');
  const games = new Map(); // userId -> active game

  function start(socket, payload = {}) {
    const user = socket.data.user;
    if (!user) return socket.emit('tower:error', { message: 'Log in to play.' });
    if (games.has(user.id)) {
      return socket.emit('tower:error', { message: 'Finish your current game first.' });
    }

    const diff = DIFFICULTIES[payload.difficulty] || DIFFICULTIES.medium;

    let bet;
    try {
      bet = parseBet(payload.amount, MAX_BET);
      adjustBalance(user.id, -bet, 'tower_bet');
    } catch (err) {
      return socket.emit('tower:error', { message: err.message || 'Invalid bet.' });
    }

    const { serverSeed, hash } = newSeed();
    const rng = makeRng(serverSeed);
    // For each row, the indices of the "bad" tiles.
    const bad = [];
    for (let r = 0; r < ROWS; r += 1) {
      const idx = [...Array(diff.cols).keys()];
      for (let i = idx.length - 1; i > 0; i -= 1) {
        const j = rng.int(i + 1);
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      bad.push(new Set(idx.slice(0, diff.cols - diff.safe)));
    }

    const multipliers = [];
    for (let r = 1; r <= ROWS; r += 1) multipliers.push(multiplierFor(diff, r));

    games.set(user.id, { bet, diff, bad, row: 0, serverSeed, hash });
    emitBalance(user.id);
    socket.emit('tower:started', {
      bet,
      rows: ROWS,
      cols: diff.cols,
      multipliers,
      hash,
    });
  }

  function finish(socket, game, { busted, col = null } = {}) {
    const user = socket.data.user;
    const cleared = game.row;
    const multiplier = busted ? 0 : multiplierFor(game.diff, cleared);
    const payout = busted ? 0 : Math.floor(game.bet * multiplier);
    if (payout > 0) adjustBalance(user.id, payout, 'tower_win');

    recordRound({
      userId: user.id,
      game: 'tower',
      bet: game.bet,
      payout,
      result: { cleared, busted, multiplier },
      serverSeed: game.serverSeed,
      hash: game.hash,
    });
    games.delete(user.id);
    emitBalance(user.id);
    socket.emit('tower:over', {
      busted,
      hitCol: col,
      bustRow: busted ? game.row : null,
      multiplier,
      payout,
      board: game.bad.map((s) => [...s]),
      serverSeed: game.serverSeed,
      hash: game.hash,
    });
  }

  function pick(socket, payload = {}) {
    const user = socket.data.user;
    if (!user) return;
    const game = games.get(user.id);
    if (!game) return socket.emit('tower:error', { message: 'No active game.' });

    const col = Math.floor(Number(payload.col));
    if (!Number.isFinite(col) || col < 0 || col >= game.diff.cols) {
      return socket.emit('tower:error', { message: 'Invalid tile.' });
    }

    if (game.bad[game.row].has(col)) return finish(socket, game, { busted: true, col });

    game.row += 1;
    if (game.row >= ROWS) return finish(socket, game, { busted: false }); // reached the top

    socket.emit('tower:advance', {
      row: game.row - 1,
      col,
      nextRow: game.row,
      multiplier: multiplierFor(game.diff, game.row),
    });
  }

  function cashout(socket) {
    const user = socket.data.user;
    if (!user) return;
    const game = games.get(user.id);
    if (!game) return socket.emit('tower:error', { message: 'No active game.' });
    if (game.row === 0) {
      return socket.emit('tower:error', { message: 'Clear at least one row first.' });
    }
    finish(socket, game, { busted: false });
  }

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) socket.join(`user:${user.id}`);
    socket.on('tower:start', (payload) => start(socket, payload || {}));
    socket.on('tower:pick', (payload) => pick(socket, payload || {}));
    socket.on('tower:cashout', () => cashout(socket));
  });
}
