// GOLDBET frontend shell: auth, balance, simple view router.

import { mountCrash } from './crash.js';
import { mountRoulette } from './roulette.js';
import { mountBlackjack } from './blackjack.js';
import { mountDice } from './dice.js';
import { mountMines } from './mines.js';
import { mountTower } from './tower.js';
import { mountPlinko } from './plinko.js';
import { mountWheel } from './wheel.js';
import { mountPoker } from './poker.js';

const state = {
  user: null,
  authMode: 'login', // 'login' | 'register'
};

// Single shared realtime connection, reused by games.
const socket = window.io ? window.io() : null;
let unmountView = null;

const el = {
  loginBtn: document.getElementById('loginBtn'),
  registerBtn: document.getElementById('registerBtn'),
  avatarBtn: document.getElementById('avatarBtn'),
  avatarInitial: document.getElementById('avatarInitial'),
  userArea: document.getElementById('userArea'),
  userName: document.getElementById('userName'),
  balanceAmount: document.getElementById('balanceAmount'),
  homeBtn: document.getElementById('homeBtn'),
  menuBtn: document.getElementById('menuBtn'),
  menuDropdown: document.getElementById('menuDropdown'),
  logoutBtn: document.getElementById('logoutBtn'),
  content: document.getElementById('content'),
  modal: document.getElementById('authModal'),
  authTitle: document.getElementById('authTitle'),
  authForm: document.getElementById('authForm'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  authError: document.getElementById('authError'),
  authSubmit: document.getElementById('authSubmit'),
  switchText: document.getElementById('switchText'),
  switchLink: document.getElementById('switchLink'),
  navItems: [...document.querySelectorAll('.nav__item')],
  brand: document.getElementById('brandHome'),
};

const ICONS = {
  crash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"></polyline><polyline points="15 7 21 7 21 13"></polyline></svg>',
  roulette:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4.5"></circle><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"></circle></svg>',
  blackjack:
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 3C9.3 6.6 5 8.8 5 12.4 5 14.9 6.9 16.4 8.9 16.4c1 0 1.9-.4 2.5-1.1-.2 1.8-.8 3-1.8 3.7V20h4.8v-1c-1-.7-1.6-1.9-1.8-3.7.6.7 1.5 1.1 2.5 1.1 2 0 3.9-1.5 3.9-4C19 8.8 14.7 6.6 12 3z"></path></svg>',
  dice:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"></rect><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="16" cy="8" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="8" cy="16" r="1.3" fill="currentColor" stroke="none"></circle><circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none"></circle></svg>',
  mines:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="13" r="7"></circle><line x1="11" y1="13" x2="11" y2="13"></line><path d="M17 7l3-3"></path><path d="M18 4h2.5V6.5"></path><line x1="11" y1="9" x2="11" y2="11"></line></svg>',
  tower:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="4" rx="1"></rect><rect x="6" y="10" width="12" height="4" rx="1"></rect><rect x="6" y="17" width="12" height="4" rx="1"></rect></svg>',
  plinko:
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="4" r="1.4"></circle><circle cx="8" cy="9" r="1.4"></circle><circle cx="16" cy="9" r="1.4"></circle><circle cx="5" cy="14" r="1.4"></circle><circle cx="12" cy="14" r="1.4"></circle><circle cx="19" cy="14" r="1.4"></circle><circle cx="6" cy="20" r="1.4"></circle><circle cx="12" cy="20" r="1.4"></circle><circle cx="18" cy="20" r="1.4"></circle></svg>',
  wheel:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="3" x2="12" y2="21"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"></line><line x1="18.4" y1="5.6" x2="5.6" y2="18.4"></line></svg>',
  poker:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="11" height="15" rx="2"></rect><path d="M17 7l3 1.2a2 2 0 0 1 1.2 2.5l-3 8.2"></path><path d="M8.5 12.5l-1.5 4 4-1 1.5-4z"></path></svg>',
};

const GAMES = [
  {
    view: 'crash',
    icon: ICONS.crash,
    title: 'Crash',
    desc: 'Watch the multiplier rise \u2014 cash out before it crashes.',
    status: 'live',
  },
  {
    view: 'roulette',
    icon: ICONS.roulette,
    title: 'Roulette',
    desc: 'Bet on numbers or colors and watch the wheel spin.',
    status: 'live',
  },
  {
    view: 'blackjack',
    icon: ICONS.blackjack,
    title: 'Blackjack',
    desc: 'Sit at the shared 7-seat table and beat the dealer to 21.',
    status: 'live',
  },
  {
    view: 'dice',
    icon: ICONS.dice,
    title: 'Dice',
    desc: 'Pick a target and roll under or over it for instant wins.',
    status: 'live',
  },
  {
    view: 'mines',
    icon: ICONS.mines,
    title: 'Mines',
    desc: 'Reveal gems and dodge the mines \u2014 cash out before you bust.',
    status: 'live',
  },
  {
    view: 'tower',
    icon: ICONS.tower,
    title: 'Tower',
    desc: 'Climb row by row picking safe tiles for a rising multiplier.',
    status: 'live',
  },
  {
    view: 'plinko',
    icon: ICONS.plinko,
    title: 'Plinko',
    desc: 'Drop a ball through the pegs into a multiplier bucket.',
    status: 'live',
  },
  {
    view: 'wheel',
    icon: ICONS.wheel,
    title: 'Wheel',
    desc: 'Spin the wheel of multipliers at low, medium or high risk.',
    status: 'live',
  },
  {
    view: 'poker',
    icon: ICONS.poker,
    title: 'Poker',
    desc: 'Jacks-or-Better video poker \u2014 hold, draw and hit the pay table.',
    status: 'live',
  },
];

// ---------- API helpers ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function formatCoins(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Auth UI ----------
function openModal(mode) {
  state.authMode = mode;
  el.authError.hidden = true;
  el.authForm.reset();
  const isLogin = mode === 'login';
  el.authTitle.textContent = isLogin ? 'Log in' : 'Sign up';
  el.authSubmit.textContent = isLogin ? 'Log in' : 'Create account';
  el.switchText.textContent = isLogin ? "Don't have an account?" : 'Already have an account?';
  el.switchLink.textContent = isLogin ? 'Sign up' : 'Log in';
  el.modal.hidden = false;
  el.username.focus();
}

function closeModal() {
  el.modal.hidden = true;
}

// Re-handshake the realtime socket so the server re-reads the auth cookie
// (the socket identity is fixed at connection time).
function reconnectSocket() {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

function showBalance(n) {
  el.balanceAmount.textContent = `$ ${formatCoins(n)}`;
}

function setUser(user) {
  state.user = user;
  const loggedIn = Boolean(user);
  el.loginBtn.hidden = loggedIn;
  el.registerBtn.hidden = loggedIn;
  el.userArea.hidden = !loggedIn;
  if (loggedIn) {
    el.avatarInitial.textContent = user.username.charAt(0).toUpperCase();
    el.userName.textContent = user.username;
    showBalance(user.balance);
  } else {
    closeMenu();
  }
}

function closeMenu() {
  el.menuDropdown.hidden = true;
}

async function refreshBalance() {
  if (!state.user) return;
  try {
    const { balance } = await api('/api/balance');
    state.user.balance = balance;
    showBalance(balance);
  } catch {
    /* ignore */
  }
}

// ---------- Views ----------
const views = {
  placeholder: (title) => `
    <div class="placeholder">
      <div>
        <div style="font-size:48px">🚧</div>
        <h2>${title}</h2>
        <p>This section is coming soon.</p>
      </div>
    </div>
  `,
  home: () => {
    const user = state.user;
    const cards = GAMES.map(
      (g) => `
        <div class="game-card" data-view="${g.view}">
          <div class="game-card__icon">${g.icon}</div>
          <div class="game-card__title">${g.title}</div>
          <div class="game-card__desc">${g.desc}</div>
          ${
            g.status === 'live'
              ? '<span class="badge-live">\u25CF Live now</span>'
              : '<span class="badge-soon">Coming soon</span>'
          }
        </div>`,
    ).join('');
    return `
      <section class="hero">
        <h1>Welcome to GOLDBET \uD83C\uDFAE</h1>
        <p>
          A casino-style playground that runs entirely on <strong>virtual coins</strong> \u2014 no real
          money involved. Pick a game below and play.
        </p>
        ${
          user
            ? `<p>Logged in as <strong>${escapeHtml(user.username)}</strong> \u00B7 balance <strong>${formatCoins(user.balance)}</strong> coins.</p>`
            : '<button class="btn btn--primary" id="heroSignup">Create a free account</button>'
        }
      </section>

      <h2 class="section-title">Games</h2>
      <div class="cards">${cards}</div>

      <h2 class="section-title">How it works</h2>
      <div class="steps">
        <div class="step"><div class="step__num">1</div><div><strong>Sign up free</strong><p>Get 1000 virtual coins instantly. No real money, ever.</p></div></div>
        <div class="step"><div class="step__num">2</div><div><strong>Pick a game</strong><p>Crash, Roulette and Blackjack run live, shared rounds with other players.</p></div></div>
        <div class="step"><div class="step__num">3</div><div><strong>Place your bets</strong><p>Every result is decided on the server and provably fair.</p></div></div>
      </div>
    `;
  },
};

function renderView(name) {
  el.navItems.forEach((item) => item.classList.toggle('is-active', item.dataset.view === name));
  if (unmountView) {
    unmountView();
    unmountView = null;
  }
  const gameDeps = { socket, getUser: () => state.user, formatCoins, openModal };
  const mounts = {
    crash: mountCrash,
    roulette: mountRoulette,
    blackjack: mountBlackjack,
    dice: mountDice,
    mines: mountMines,
    tower: mountTower,
    plinko: mountPlinko,
    wheel: mountWheel,
    poker: mountPoker,
  };
  if (mounts[name] && socket) {
    unmountView = mounts[name](el.content, gameDeps);
  } else if (name === 'home') {
    el.content.innerHTML = views.home();
    const heroSignup = el.content.querySelector('#heroSignup');
    if (heroSignup) heroSignup.addEventListener('click', () => openModal('register'));
    el.content.querySelectorAll('.game-card').forEach((card) =>
      card.addEventListener('click', () => navigate(card.dataset.view)),
    );
  } else {
    const titles = { leaderboard: 'Leaderboard', rewards: 'Rewards' };
    el.content.innerHTML = views.placeholder(titles[name] || 'Page');
  }
}

function navigate(view) {
  if (location.hash !== `#${view}`) location.hash = `#${view}`;
  else renderView(view);
}

// ---------- Events ----------
el.loginBtn.addEventListener('click', () => openModal('login'));
el.registerBtn.addEventListener('click', () => openModal('register'));
el.modal.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', closeModal));
el.switchLink.addEventListener('click', (e) => {
  e.preventDefault();
  openModal(state.authMode === 'login' ? 'register' : 'login');
});

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  setUser(null);
  reconnectSocket();
  renderView(currentView());
}

el.menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  el.menuDropdown.hidden = !el.menuDropdown.hidden;
});

el.logoutBtn.addEventListener('click', () => {
  closeMenu();
  logout();
});

el.avatarBtn.addEventListener('click', () => navigate('home'));

el.homeBtn.addEventListener('click', () => navigate('home'));

document.addEventListener('click', (e) => {
  if (!el.menuDropdown.hidden && !e.target.closest('.menu')) closeMenu();
});

el.authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  el.authError.hidden = true;
  const body = JSON.stringify({
    username: el.username.value.trim(),
    password: el.password.value,
  });
  const path = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
  try {
    const { user } = await api(path, { method: 'POST', body });
    setUser(user);
    closeModal();
    reconnectSocket();
    renderView(currentView());
  } catch (err) {
    el.authError.textContent = err.message;
    el.authError.hidden = false;
  }
});

el.navItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(item.dataset.view);
  });
});

if (el.brand) {
  el.brand.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('home');
  });
}

function currentView() {
  return (location.hash || '#home').slice(1);
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

window.addEventListener('hashchange', () => renderView(currentView()));

// Keep the displayed balance fresh when returning to the tab.
window.addEventListener('focus', refreshBalance);

// ---------- Realtime ----------
if (socket) {
  // Games push an authoritative balance whenever it changes (bet, win, refund).
  // Keep the topbar in sync everywhere.
  const onBalance = ({ balance }) => {
    if (!state.user) return;
    state.user.balance = balance;
    showBalance(balance);
  };
  ['crash', 'roulette', 'blackjack', 'dice', 'mines', 'tower', 'plinko', 'wheel', 'poker'].forEach(
    (g) => socket.on(`${g}:balance`, onBalance),
  );
}

// ---------- Boot ----------
async function boot() {
  try {
    const { user } = await api('/api/me');
    setUser(user);
  } catch {
    setUser(null);
  }
  renderView(currentView());
}

boot();
