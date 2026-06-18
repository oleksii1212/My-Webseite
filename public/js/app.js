// GOLDBET frontend shell: auth, balance, simple view router.

import { mountCrash } from './crash.js';

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
};

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
};

function renderView(name) {
  el.navItems.forEach((item) => item.classList.toggle('is-active', item.dataset.view === name));
  if (unmountView) {
    unmountView();
    unmountView = null;
  }
  if (name === 'crash' && socket) {
    unmountView = mountCrash(el.content, {
      socket,
      getUser: () => state.user,
      formatCoins,
      openModal,
    });
  } else {
    const titles = {
      roulette: 'Roulette',
      blackjack: 'Blackjack',
      leaderboard: 'Leaderboard',
      rewards: 'Rewards',
    };
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

function currentView() {
  return (location.hash || '#crash').slice(1);
}

window.addEventListener('hashchange', () => renderView(currentView()));

// Keep the displayed balance fresh when returning to the tab.
window.addEventListener('focus', refreshBalance);

// ---------- Realtime ----------
if (socket) {
  // The Crash engine pushes an authoritative balance whenever it changes
  // (bet placed, cashed out, busted). Keep the topbar in sync everywhere.
  socket.on('crash:balance', ({ balance }) => {
    if (!state.user) return;
    state.user.balance = balance;
    el.balanceAmount.textContent = formatCoins(balance);
  });
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
