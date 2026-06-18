import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  startingBalance: Number(process.env.STARTING_BALANCE) || 1000,
  // Auth token lifetime
  tokenMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  crash: {
    bettingMs: 7000, // how long players can place bets each round
    crashedPauseMs: 4000, // how long the bust result stays on screen
    tickMs: 100, // multiplier broadcast interval while running
    // Exponential growth of the multiplier: m(t) = e^(rate * elapsedMs).
    // This MUST match GROWTH_RATE_PER_MS in public/js/crash.js so the client
    // animation tracks the server. ~2x at 5.8s, ~10x at 19s.
    growthRatePerMs: 0.00012,
    maxBet: 10000, // max coins per bet
    historySize: 20, // recent crash points kept for the history strip
  },
};
