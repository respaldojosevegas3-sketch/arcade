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
const muteBtn = document.getElementById('muteBtn');

let spinning = false;
let currentBalance = null;

// ============================================================
// SONIDO — generado en el momento con Web Audio API, sin archivos
// externos. Todo vive acá adentro para no depender de nada más.
// ============================================================
const sound = (() => {
  let ctx = null;
  let muted = localStorage.getItem('frutas_muted') === 'true';
  let spinLoopStop = null;

  function getCtx() {
    // El navegador exige un gesto del usuario (click) antes de crear el
    // AudioContext — por eso se crea recién acá, en el primer click, y
    // no al cargar la página.
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function tone({ freq, duration, type = 'sine', volume = 0.15, delay = 0, endFreq = null }) {
    if (muted) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + delay);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, c.currentTime + delay + duration);
    }
    gain.gain.setValueAtTime(volume, c.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + duration + 0.05);
  }

  // Zumbido continuo mientras giran los carretes, tipo motor de máquina.
  function startSpinLoop() {
    if (muted) { spinLoopStop = () => {}; return; }
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 90;
    gain.gain.value = 0.035;
    osc.connect(gain).connect(c.destination);
    osc.start();

    // leve vibrato para que no suene como un tono plano y molesto
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 7;
    lfoGain.gain.value = 12;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start();

    spinLoopStop = () => {
      gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.15);
      setTimeout(() => { osc.stop(); lfo.stop(); }, 200);
    };
  }

  function stopSpinLoop() {
    if (spinLoopStop) { spinLoopStop(); spinLoopStop = null; }
  }

  // Tick seco cuando un carrete individual se frena.
  function reelStop() {
    tone({ freq: 220, duration: 0.08, type: 'square', volume: 0.12 });
  }

  // "Cha-ching" de dinero: par de campanitas ascendentes, cortas y alegres.
  function win() {
    tone({ freq: 660, duration: 0.12, type: 'triangle', volume: 0.18, delay: 0 });
    tone({ freq: 880, duration: 0.14, type: 'triangle', volume: 0.18, delay: 0.1 });
    tone({ freq: 1175, duration: 0.18, type: 'triangle', volume: 0.16, delay: 0.2 });
  }

  // Sonido propio y más grande del jackpot: una fanfarria de varias notas
  // en escalera, bien distinta del sonido de ganar normal.
  function jackpot() {
    const notes = [523, 659, 784, 1047, 1319, 1568];
    notes.forEach((freq, i) => {
      tone({ freq, duration: 0.28, type: 'triangle', volume: 0.22, delay: i * 0.13 });
    });
    // capa grave de fondo para darle "peso"
    tone({ freq: 130, duration: 1.4, type: 'sawtooth', volume: 0.08, delay: 0 });
  }

  // Sonido neutro y breve al perder — sin intención punitiva, solo cierre.
  function loss() {
    tone({ freq: 200, duration: 0.18, type: 'sine', volume: 0.08, endFreq: 140 });
  }

  function setMuted(value) {
    muted = value;
    localStorage.setItem('frutas_muted', String(value));
  }

  return { startSpinLoop, stopSpinLoop, reelStop, win, jackpot, loss, setMuted, isMuted: () => muted };
})();

if (muteBtn) {
  muteBtn.textContent = sound.isMuted() ? '🔇' : '🔊';
  muteBtn.addEventListener('click', () => {
    const next = !sound.isMuted();
    sound.setMuted(next);
    muteBtn.textContent = next ? '🔇' : '🔊';
  });
}

// ============================================================

function setResult(msg, className) {
  resultEl.textContent = msg;
  resultEl.className = `result-msg ${className || ''}`.trim();
}

function updateBalance(balance) {
  if (balance === null || balance === undefined) return;
  currentBalance = Number(balance);
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
  const STOP_DELAYS = [3600, 5200, 7500]; // ms desde que arrancó el giro

  return Promise.all(
    reels.map(
      (symbol, i) =>
        new Promise((resolve) => {
          setTimeout(() => {
            reelEls[i].classList.remove('spinning');
            reelEls[i].textContent = SYMBOL_EMOJI[symbol];
            sound.reelStop();
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
  sound.startSpinLoop();

  // Descuento OPTIMISTA: el servidor ya debitó la apuesta en el instante
  // del click (antes incluso de tirar los carretes) — mostramos ese
  // descuento de inmediato en pantalla, en vez de esperar a que termine
  // toda la animación. Así, cuando el premio llega, la subida se nota.
  if (currentBalance !== null) {
    balanceEl.textContent = `${(currentBalance - betAmount).toFixed(2)} USDT`;
  }

  // El pedido al servidor y la animación corren en paralelo. Como la
  // animación (carretes parando de a uno) dura varios segundos y el
  // request suele tardar mucho menos, el resultado real ya está
  // esperando cuando el último carrete para.
  try {
    const data = await apiCall('/games/frutas/spin', { betAmount });

    await stopReelsSequentially(data.reels);
    stopAnimation();
    sound.stopSpinLoop();
    updateJackpot(data.jackpotPool, data.jackpotWon);

    if (data.jackpotWon) {
      highlightWin(3);
      sound.jackpot();
      setResult(`🎰 ¡JACKPOT! Ganaste ${data.payoutAmount.toFixed(2)} USDT`, 'jackpot');
    } else if (data.outcome === 'triple') {
      highlightWin(3);
      sound.win();
      setResult(`🎉 ¡Ganaste ${data.payoutAmount.toFixed(2)} USDT! (x${data.multiplier})`, 'win');
    } else if (data.outcome === 'pair') {
      highlightWin(2);
      sound.win();
      setResult(`✨ Ganaste ${data.payoutAmount.toFixed(2)} USDT (x${data.multiplier})`, 'win');
    } else if (data.outcome === 'push') {
      setResult('⭐ Casi. Se te devolvió tu apuesta.', 'win');
    } else {
      sound.loss();
      setResult('Sin suerte esta vez.', 'loss');
    }

    if (data.newBalance !== null) {
      updateBalance(data.newBalance);
    } else {
      loadBalance();
    }
  } catch (err) {
    stopAnimation();
    sound.stopSpinLoop();
    reelEls.forEach((el) => el.classList.remove('spinning'));
    setResult(`Error: ${err.message}`, 'loss');
    loadBalance(); // el descuento optimista no se confirmó: recargamos el saldo real
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
