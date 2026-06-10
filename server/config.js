import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  startingBalance: Number(process.env.STARTING_BALANCE) || 1000,
  // Auth token lifetime
  tokenMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};
