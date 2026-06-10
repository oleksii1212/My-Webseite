import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { config } from './config.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3-20 characters: letters, numbers or underscore.';
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) {
    return 'Password must be at least 6 characters.';
  }
  return null;
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function getUserById(id) {
  return db.prepare('SELECT id, username, balance, created_at FROM users WHERE id = ?').get(id);
}

export function createUser(username, password) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const tx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO users (username, password_hash, balance) VALUES (?, ?, ?)')
      .run(username, passwordHash, config.startingBalance);
    const userId = info.lastInsertRowid;
    db.prepare('INSERT INTO transactions (user_id, amount, reason) VALUES (?, ?, ?)').run(
      userId,
      config.startingBalance,
      'signup_bonus',
    );
    return userId;
  });
  const userId = tx();
  return getUserById(userId);
}

export function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

/**
 * Atomically adjust a user's balance and record a ledger entry.
 * Throws if the change would make the balance negative.
 * @returns the new balance
 */
export function adjustBalance(userId, amount, reason) {
  const apply = db.transaction(() => {
    const row = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (!row) throw new Error('User not found');
    const newBalance = row.balance + amount;
    if (newBalance < 0) throw new Error('Insufficient balance');
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, userId);
    db.prepare('INSERT INTO transactions (user_id, amount, reason) VALUES (?, ?, ?)').run(
      userId,
      amount,
      reason,
    );
    return newBalance;
  });
  return apply();
}
