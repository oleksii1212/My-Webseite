import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import {
  createUser,
  getUserById,
  getUserByUsername,
  validateCredentials,
  verifyPassword,
} from './users.js';

export const COOKIE_NAME = 'token';

function signToken(userId) {
  return jwt.sign({ uid: userId }, config.jwtSecret, { expiresIn: '7d' });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.tokenMaxAgeMs,
  });
}

/** Express middleware: attaches req.user when a valid token cookie is present. */
export function authenticate(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const user = getUserById(payload.uid);
      if (user) req.user = user;
    } catch {
      // invalid/expired token -> treat as anonymous
    }
  }
  next();
}

/** Guard for routes that require a logged-in user. */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

export const authRouter = Router();

authRouter.post('/register', (req, res) => {
  const { username, password } = req.body ?? {};
  const error = validateCredentials(username, password);
  if (error) return res.status(400).json({ error });
  if (getUserByUsername(username)) {
    return res.status(409).json({ error: 'Username already taken.' });
  }
  const user = createUser(username, password);
  setAuthCookie(res, signToken(user.id));
  res.json({ user });
});

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password required.' });
  }
  const user = getUserByUsername(username);
  if (!user || !verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  setAuthCookie(res, signToken(user.id));
  res.json({ user: getUserById(user.id) });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.user });
});
