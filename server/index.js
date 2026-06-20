import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { config } from './config.js';
import { authenticate, requireAuth, authRouter, getUserFromCookieHeader } from './auth.js';
import { getUserById } from './users.js';
import { initCrash } from './crash.js';
import { initRoulette } from './roulette.js';
import { initBlackjack } from './blackjack.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use(cookieParser());
app.use(authenticate);

// --- API routes ---
app.use('/api/auth', authRouter);

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/balance', requireAuth, (req, res) => {
  const user = getUserById(req.user.id);
  res.json({ balance: user.balance });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// --- Static frontend ---
app.use(express.static(publicDir));

// SPA-ish fallback: serve the app shell for unknown non-API GET routes.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(join(publicDir, 'index.html'));
});

// --- Realtime ---
// Attach the logged-in user (if any) to each socket from its auth cookie.
io.use((socket, next) => {
  socket.data.user = getUserFromCookieHeader(socket.handshake.headers.cookie);
  next();
});

io.on('connection', (socket) => {
  socket.emit('server:hello', { message: 'connected' });
});

// Crash, Roulette & Blackjack: shared, server-authoritative rounds broadcast
// to all clients.
initCrash(io);
initRoulette(io);
initBlackjack(io);

httpServer.listen(config.port, () => {
  console.log(`GOLDBET server running on http://localhost:${config.port}`);
});

export { app, io };
