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
  roulette: {
    bettingMs: 12000, // how long players can place bets each round
    spinningMs: 6000, // wheel/reel animation length (number is revealed now)
    resultMs: 5000, // how long the result stays on screen before the next round
    maxBet: 10000, // max coins per single bet
    historySize: 18, // recent winning numbers kept for the history strip
  },
  blackjack: {
    seatCount: 7, // seats at the shared table
    decks: 6, // decks in the shoe (reshuffled each round, provably fair)
    bettingMs: 15000, // how long seated players can place/raise bets
    turnMs: 15000, // per-action time limit before an auto-stand
    dealerStepMs: 900, // delay between dealer draws (and before settling)
    resultMs: 6000, // how long results stay on screen before the next round
    idleMs: 3000, // pause when nobody bet, before re-opening betting
    maxBet: 10000, // max coins staked on one seat per round
    maxHands: 4, // max hands a seat can hold after splitting
    historySize: 16, // recent dealer results kept for the history strip
  },
};
