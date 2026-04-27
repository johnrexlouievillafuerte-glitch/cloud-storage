import { api } from './api.js';

let currentUser = null;
let listeners = [];

export function getUser() { return currentUser; }

export function onAuthChange(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

function notify() { listeners.forEach(fn => fn(currentUser)); }

export async function initAuth() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const data = await api.getMe();
    currentUser = data.user;
    notify();
    return currentUser;
  } catch {
    localStorage.removeItem('token');
    currentUser = null;
    notify();
    return null;
  }
}

export async function login(email, password) {
  const data = await api.login({ email, password });
  localStorage.setItem('token', data.token);
  currentUser = data.user;
  notify();
  return currentUser;
}

export async function register(email, username, password) {
  const data = await api.register({ email, username, password });
  localStorage.setItem('token', data.token);
  currentUser = data.user;
  notify();
  return currentUser;
}

export function logout() {
  localStorage.removeItem('token');
  currentUser = null;
  notify();
}

export async function refreshUser() {
  try {
    const data = await api.getMe();
    currentUser = data.user;
    notify();
  } catch { /* ignore */ }
}
