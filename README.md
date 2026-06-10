# GOLDBET

A casino-style web app that runs entirely on **virtual coins** — no real money is involved.
This repository is built step by step as a learning project. This first milestone is the
**foundation**: the site shell, user accounts (register / login), and a server-authoritative
virtual balance. Games (Crash, Roulette, Blackjack) are added in later milestones.

## Tech stack

- **Backend:** Node.js + [Express](https://expressjs.com/) + [Socket.IO](https://socket.io/)
- **Database:** [SQLite](https://www.sqlite.org/) via `better-sqlite3` (a local file, zero setup)
- **Auth:** password hashing with `bcryptjs`, sessions via JWT stored in an httpOnly cookie
- **Frontend:** plain HTML / CSS / JavaScript (dark theme)

> **Security principle:** all balances and game logic live on the **server**. The browser only
> displays results, so a player cannot cheat by editing values in the browser console.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer (includes `npm`)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your local config from the template
#    (Windows PowerShell: copy .env.example .env)
cp .env.example .env

# 3. Start the server
npm start
```

Then open <http://localhost:3000>.

For development with auto-reload on file changes:

```bash
npm run dev
```

## Configuration

Settings live in `.env` (see `.env.example`):

| Variable           | Description                                        | Default |
| ------------------ | -------------------------------------------------- | ------- |
| `PORT`             | Port the server listens on                         | `3000`  |
| `JWT_SECRET`       | Secret used to sign auth tokens — **change this!** | —       |
| `STARTING_BALANCE` | Virtual coins granted to every new account         | `1000`  |

## Project structure

```
server/         Backend (Express + Socket.IO)
  index.js        Server entry point & routes
  config.js       Environment configuration
  db.js           SQLite connection & schema
  users.js        User + balance logic (ledger-backed)
  auth.js         Register / login / logout, auth middleware
public/         Frontend (served as static files)
  index.html      App shell (sidebar, topbar, auth modal)
  css/style.css   Dark theme
  js/app.js       Auth flow, balance display, view router
data/           SQLite database file (created at runtime, git-ignored)
```

## Available scripts

- `npm start` — run the server
- `npm run dev` — run with auto-reload
- `npm run lint` — check code style with ESLint
- `npm run lint:fix` — auto-fix lint issues

## Roadmap

1. **Foundation** — accounts, balances, site shell ✅ (this milestone)
2. **Crash** — realtime multiplier game
3. **Roulette**
4. **Blackjack**
5. Profile, game history, leaderboard
