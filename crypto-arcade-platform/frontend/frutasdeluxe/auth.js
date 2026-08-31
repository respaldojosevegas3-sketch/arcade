// frontend/frutasdeluxe/auth.js
// Maneja registro/login y guarda el token real que devuelve el backend.
// Sustituye al DEV_TOKEN_PLACEHOLDER que se usaba antes para pruebas.

const AUTH_API_BASE = 'https://arcade-production-d8c8.up.railway.app/api/auth';

async function authCall(path, body) {
  const res = await fetch(`${AUTH_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'ERROR');
  }
  return data;
}

async function register(email, password) {
  const data = await authCall('/register', { email, password });
  localStorage.setItem('demo_token', data.token);
  return data;
}

async function login(email, password) {
  const data = await authCall('/login', { email, password });
  localStorage.setItem('demo_token', data.token);
  return data;
}

function logout() {
  localStorage.removeItem('demo_token');
  window.location.reload();
}

function isLoggedIn() {
  return Boolean(localStorage.getItem('demo_token'));
}
