// GOLDBET frontend shell: auth, balance, simple view router.

import { mountCrash } from './crash.js';
import { mountRoulette } from './roulette.js';
import { mountBlackjack } from './blackjack.js';

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
  balancePill: document.getElementById('balancePill'),
  balanceAmount: document.getElementById('balanceAmount'),
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

const GAMES = [
  {
    view: 'crash',
    icon: '\uD83D\uDCC8',
    title: 'Crash',
    desc: 'Watch the multiplier rise \u2014 cash out before it crashes.',
    status: 'live',
  },
  {
    view: 'roulette',
    icon: '\uD83C\uDFAF',
    title: 'Roulette',
    desc: 'Bet on numbers or colors and watch the wheel spin.',
    status: 'live',
  },
  {
    view: 'blackjack',
    icon: '\uD83C\uDCCF',
    title: 'Blackjack',
    desc: 'Sit at the shared 7-seat table and beat the dealer to 21.',
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

function setUser(user) {
  state.user = user;
  const loggedIn = Boolean(user);
  el.loginBtn.hidden = loggedIn;
  el.registerBtn.hidden = loggedIn;
  el.avatarBtn.hidden = !loggedIn;
  el.balancePill.hidden = !loggedIn;
  if (loggedIn) {
    el.avatarInitial.textContent = user.username.charAt(0).toUpperCase();
    el.balanceAmount.textContent = formatCoins(user.balance);
  }
}

async function refreshBalance() {
  if (!state.user) return;
  try {
    const { balance } = await api('/api/balance');
    state.user.balance = balance;
    el.balanceAmount.textContent = formatCoins(balance);
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
  if (name === 'crash' && socket) {
    unmountView = mountCrash(el.content, gameDeps);
  } else if (name === 'roulette' && socket) {
    unmountView = mountRoulette(el.content, gameDeps);
  } else if (name === 'blackjack' && socket) {
    unmountView = mountBlackjack(el.content, gameDeps);
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

el.avatarBtn.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  setUser(null);
  reconnectSocket();
  renderView(currentView());
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
    el.balanceAmount.textContent = formatCoins(balance);
  };
  socket.on('crash:balance', onBalance);
  socket.on('roulette:balance', onBalance);
  socket.on('blackjack:balance', onBalance);
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
