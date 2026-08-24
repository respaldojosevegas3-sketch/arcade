// frontend/mines/game.js
// El cliente NUNCA calcula multiplicadores, NUNCA conoce las minas.
// Solo envía intenciones (start / reveal / cashout) y pinta lo que el
// servidor responde. Esto es intencional: toda la lógica de negocio y
// el RNG viven en el backend.

const API_BASE = 'https://arcade-production-d8c8.up.railway.app/api';
const GRID_SIZE = 25;

// En producción, este token sale del login real del usuario.
let authToken = localStorage.getItem('demo_token') || 'DEV_TOKEN_PLACEHOLDER';

const state = {
  sessionId: null,
  revealed: new Set(),
  active: false,
};

const boardEl = document.getElementById('board');
const balanceEl = document.getElementById('balanceValue');
const multiplierEl = document.getElementById('multiplierBadge');
const statusEl = document.getElementById('statusMsg');
const startBtn = document.getElementById('startBtn');
const cashoutBtn = document.getElementById('cashoutBtn');
const betInput = document.getElementById('betAmount');
const mineSelect = document.getElementById('mineCount');

function renderBoard() {
  boardEl.innerHTML = '';
  for (let i = 0; i < GRID_SIZE; i++) {
    const btn = document.createElement('button');
    btn.className = 'tile';
    btn.dataset.index = i;
    btn.disabled = !state.active || state.revealed.has(i);
    btn.addEventListener('click', () => onTileClick(i));
    boardEl.appendChild(btn);
  }
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setMultiplier(mult) {
  multiplierEl.textContent = `${Number(mult).toFixed(2)}x`;
}

function markTile(index, type) {
  const tile = boardEl.querySelector(`[data-index="${index}"]`);
  if (!tile) return;
  tile.classList.add('revealed', type);
  tile.textContent = type === 'mine' ? '💣' : '💎';
  tile.disabled = true;
}

async function apiCall(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'ERROR');
  }
  return data;
}

async function startGame() {
  const betAmount = parseFloat(betInput.value);
  const mineCount = parseInt(mineSelect.value, 10);

  if (!betAmount || betAmount <= 0) {
    setStatus('Ingresa un monto de apuesta válido.');
    return;
  }

  startBtn.disabled = true;
  setStatus('Iniciando partida…');

  try {
    const data = await apiCall('/games/mines/start', { betAmount, mineCount });

    state.sessionId = data.sessionId;
    state.revealed = new Set();
    state.active = true;

    setMultiplier(data.currentMultiplier);
    setStatus('Elige una casilla.');
    renderBoard();

    cashoutBtn.disabled = true; // se habilita tras la 1ra casilla segura
  } catch (err) {
    setStatus(`No se pudo iniciar: ${err.message}`);
    startBtn.disabled = false;
  }
}

async function onTileClick(index) {
  if (!state.active || state.revealed.has(index)) return;

  try {
    const data = await apiCall('/games/mines/reveal', {
      sessionId: state.sessionId,
      tileIndex: index,
    });

    state.revealed.add(index);

    if (data.result === 'mine') {
      markTile(index, 'mine');
      // El servidor revela el tablero completo solo al terminar la partida.
      data.minePositions.forEach((i) => {
        if (i !== index) markTile(i, 'mine');
      });
      endGame('💥 ¡Boom! Perdiste la apuesta.');
      return;
    }

    markTile(index, 'safe');
    setMultiplier(data.currentMultiplier);
    setStatus(`Casillas seguras: ${data.revealedCount}`);
    cashoutBtn.disabled = false;

    if (data.result === 'cashed_out') {
      // Tablero completo revelado automáticamente.
      endGame(`🎉 Tablero completo. Ganaste ${data.payoutAmount} USDT.`);
      updateBalance(data.newBalance);
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

async function cashout() {
  if (!state.active) return;
  cashoutBtn.disabled = true;

  try {
    const data = await apiCall('/games/mines/cashout', { sessionId: state.sessionId });
    endGame(`✅ Cobraste ${data.payoutAmount} USDT (x${data.multiplier}).`);
    updateBalance(data.newBalance);
  } catch (err) {
    setStatus(`Error al cobrar: ${err.message}`);
    cashoutBtn.disabled = false;
  }
}

function endGame(message) {
  state.active = false;
  setStatus(message);
  startBtn.disabled = false;
  cashoutBtn.disabled = true;
  boardEl.querySelectorAll('.tile').forEach((t) => (t.disabled = true));
}

function updateBalance(balance) {
  balanceEl.textContent = `${Number(balance).toFixed(2)} USDT`;
}

startBtn.addEventListener('click', startGame);
cashoutBtn.addEventListener('click', cashout);

renderBoard();
setStatus('Configura tu apuesta y presiona "Iniciar partida".');
