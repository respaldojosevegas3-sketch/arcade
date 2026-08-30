// frontend/frutas/game.js
// Igual que Mines: el cliente NUNCA calcula multiplicadores ni sabe qué va
// a salir. Solo envía la apuesta y pinta lo que el servidor responde.

const API_BASE = 'https://arcade-production-d8c8.up.railway.app/api';

const SYMBOL_EMOJI = {
  LEMON: '🍋',
  CHERRY: '🍒',
  BELL: '🔔',
  GEM: '💎',
  STAR: '⭐',
  SEVEN: '7️⃣',
};

let authToken = localStorage.getItem('demo_token') || 'DEV_TOKEN_PLACEHOLDER';

const reelEls = [
  document.getElementById('reel0'),
  document.getElementById('reel1'),
  document.getElementById('reel2'),
];
const balanceEl = document.getElementById('balanceValue');
const jackpotEl = document.getElementById('jackpotValue');
const resultEl = document.getElementById('resultMsg');
const spinBtn = document.getElementById('spinBtn');
const betInput = document.getElementById('betAmount');

let spinning = false;

function setResult(msg, className) {
  resultEl.textContent = msg;
  resultEl.className = `result-msg ${className || ''}`.trim();
}

function updateBalance(balance) {
  if (balance === null || balance === undefined) return;
  balanceEl.textContent = `${Number(balance).toFixed(2)} USDT`;
}

function updateJackpot(pool, won) {
  jackpotEl.textContent = `${Number(pool).toFixed(2)} USDT`;
  jackpotEl.classList.toggle('won', Boolean(won));
  if (won) setTimeout(() => jackpotEl.classList.remove('won'), 2000);
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

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'ERROR');
  }
  return data;
}

function startSpinAnimation() {
  reelEls.forEach((el) => {
    el.classList.add('spinning');
    el.classList.remove('win');
  });

  const keys = Object.keys(SYMBOL_EMOJI);
  const interval = setInterval(() => {
    reelEls.forEach((el) => {
      if (el.classList.contains('spinning')) {
        el.textContent = SYMBOL_EMOJI[keys[Math.floor(Math.random() * keys.length)]];
      }
    });
  }, 70);

  return () => clearInterval(interval);
}

/**
 * Para los carretes UNO POR UNO, de izquierda a derecha, con pausas
 * crecientes entre cada parada — es lo que genera la expectativa de una
 * tragamonedas real, en vez de mostrar el resultado todo junto de golpe.
 */
function stopReelsSequentially(reels) {
  const STOP_DELAYS = [2100, 2900, 3900]; // ms desde que arrancó el giro

  return Promise.all(
    reels.map(
      (symbol, i) =>
        new Promise((resolve) => {
          setTimeout(() => {
            reelEls[i].classList.remove('spinning');
            reelEls[i].textContent = SYMBOL_EMOJI[symbol];
            resolve();
          }, STOP_DELAYS[i]);
        })
    )
  );
}

function highlightWin(count) {
  for (let i = 0; i < count; i++) {
    reelEls[i].classList.add('win');
  }
}

async function spin() {
  if (spinning) return;

  const betAmount = parseFloat(betInput.value);
  if (!betAmount || betAmount <= 0) {
    setResult('Ingresa una apuesta válida.', 'loss');
    return;
  }

  spinning = true;
  spinBtn.disabled = true;
  setResult('');
  const stopAnimation = startSpinAnimation();

  // El pedido al servidor y la animación corren en paralelo. Como la
  // animación (carretes parando de a uno) dura ~2.9s y el request suele
  // tardar mucho menos, el resultado real ya está esperando cuando el
  // último carrete para — así nunca se siente que "trabamos" el giro.
  try {
    const data = await apiCall('/games/frutas/spin', { betAmount });

    await stopReelsSequentially(data.reels);
    stopAnimation();
    updateJackpot(data.jackpotPool, data.jackpotWon);

    if (data.jackpotWon) {
      highlightWin(3);
      setResult(`🎰 ¡JACKPOT! Ganaste ${data.payoutAmount.toFixed(2)} USDT`, 'jackpot');
    } else if (data.outcome === 'triple') {
      highlightWin(3);
      setResult(`🎉 ¡Ganaste ${data.payoutAmount.toFixed(2)} USDT! (x${data.multiplier})`, 'win');
    } else if (data.outcome === 'pair') {
      highlightWin(2);
      setResult(`✨ Ganaste ${data.payoutAmount.toFixed(2)} USDT (x${data.multiplier})`, 'win');
    } else if (data.outcome === 'push') {
      setResult('⭐ Casi. Se te devolvió tu apuesta.', 'win');
    } else {
      setResult('Sin suerte esta vez.', 'loss');
    }

    if (data.newBalance !== null) {
      updateBalance(data.newBalance);
    } else {
      loadBalance();
    }
  } catch (err) {
    stopAnimation();
    reelEls.forEach((el) => el.classList.remove('spinning'));
    setResult(`Error: ${err.message}`, 'loss');
  } finally {
    spinning = false;
    spinBtn.disabled = false;
  }
}

async function loadBalance() {
  try {
    const res = await fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    updateBalance(data.balance);
  } catch (err) {
    console.error('No se pudo cargar el balance:', err);
  }
}

async function loadJackpot() {
  try {
    const data = await apiGet('/games/frutas/jackpot');
    updateJackpot(data.pool, false);
  } catch (err) {
    console.error('No se pudo cargar el pozo:', err);
  }
}

spinBtn.addEventListener('click', spin);

setResult('Configura tu apuesta y presiona "Girar".');
loadBalance();
loadJackpot();
