// frontend/frutasdeluxe/game.js
// Igual principio que frutas/game.js: el cliente nunca calcula nada,
// solo envía la apuesta y pinta lo que el servidor responde. 5 carretes
// en vez de 3, y el jackpot queda "pendiente de revisión" en vez de
// acreditarse solo.

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

const reelEls = [0, 1, 2, 3, 4].map((i) => document.getElementById(`reel${i}`));
const balanceEl = document.getElementById('balanceValue');
const jackpotEl = document.getElementById('jackpotValue');
const resultEl = document.getElementById('resultMsg');
const spinBtn = document.getElementById('spinBtn');
const betInput = document.getElementById('betAmount');
const muteBtn = document.getElementById('muteBtn');

let spinning = false;

// ============================================================
// SONIDO — mismo sistema que Frutas normal, generado en el momento.
// ============================================================
const sound = (() => {
  let ctx = null;
  let muted = localStorage.getItem('frutasdeluxe_muted') === 'true';
  let spinLoopStop = null;

  function getCtx() {
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
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, c.currentTime + delay + duration);
    gain.gain.setValueAtTime(volume, c.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + delay + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + duration + 0.05);
  }

  function startSpinLoop() {
    if (muted) { spinLoopStop = () => {}; return; }
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 95;
    gain.gain.value = 0.035;
    osc.connect(gain).connect(c.destination);
    osc.start();

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
  function stopSpinLoop() { if (spinLoopStop) { spinLoopStop(); spinLoopStop = null; } }

  function reelStop() { tone({ freq: 240, duration: 0.08, type: 'square', volume: 0.12 }); }

  function win() {
    tone({ freq: 660, duration: 0.12, type: 'triangle', volume: 0.18, delay: 0 });
    tone({ freq: 880, duration: 0.14, type: 'triangle', volume: 0.18, delay: 0.1 });
    tone({ freq: 1175, duration: 0.18, type: 'triangle', volume: 0.16, delay: 0.2 });
  }

  function bigWin() {
    // Para 5 iguales / Estrella grande: un escalón más largo que "win" normal.
    [523, 659, 784, 1047].forEach((freq, i) => {
      tone({ freq, duration: 0.2, type: 'triangle', volume: 0.2, delay: i * 0.11 });
    });
  }

  function jackpot() {
    const notes = [523, 659, 784, 1047, 1319, 1568, 1976];
    notes.forEach((freq, i) => tone({ freq, duration: 0.3, type: 'triangle', volume: 0.22, delay: i * 0.12 }));
    tone({ freq: 110, duration: 1.8, type: 'sawtooth', volume: 0.09, delay: 0 });
  }

  function loss() { tone({ freq: 200, duration: 0.18, type: 'sine', volume: 0.08, endFreq: 140 }); }

  function setMuted(v) { muted = v; localStorage.setItem('frutasdeluxe_muted', String(v)); }

  return { startSpinLoop, stopSpinLoop, reelStop, win, bigWin, jackpot, loss, setMuted, isMuted: () => muted };
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
  balanceEl.textContent = `${Number(balance).toFixed(2)} USDT`;
}

function updateJackpot(pool) {
  jackpotEl.textContent = `${Number(pool).toFixed(2)} USDT`;
}

async function apiCall(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'ERROR');
  return data;
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${authToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'ERROR');
  return data;
}

function startSpinAnimation() {
  reelEls.forEach((el) => { el.classList.add('spinning'); el.classList.remove('win', 'jackpot-cell'); });
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
 * 5 carretes parando de a uno, con pausas crecientes — más suspenso que
 * el Frutas normal, acorde a que este juego apunta a premios más grandes.
 */
function stopReelsSequentially(reels) {
  const STOP_DELAYS = [2200, 3600, 5200, 7000, 9000];
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

function highlightWin(count, isJackpot) {
  for (let i = 0; i < count; i++) {
    reelEls[i].classList.add(isJackpot ? 'jackpot-cell' : 'win');
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

  try {
    const data = await apiCall('/games/frutasdeluxe/spin', { betAmount });

    await stopReelsSequentially(data.reels);
    stopAnimation();
    sound.stopSpinLoop();
    updateJackpot(data.jackpotPool);

    if (data.jackpotWon && data.jackpotPending) {
      // El jackpot NO se acredita solo: queda en revisión manual.
      highlightWin(5, true);
      sound.jackpot();
      setResult(
        `🎰 ¡JACKPOT! ${data.payoutAmount.toFixed(2)} USDT en revisión — se acredita en breve.`,
        'pending'
      );
    } else if (data.outcome && data.outcome.startsWith('5_')) {
      highlightWin(5, false);
      sound.bigWin();
      setResult(`🎉 ¡5 iguales! Ganaste ${data.payoutAmount.toFixed(2)} USDT (x${data.multiplier})`, 'win');
    } else if (data.outcome && data.outcome !== 'loss' && data.outcome !== 'push') {
      const count = parseInt(data.outcome.split('_')[0], 10) || 2;
      highlightWin(count, false);
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
  } finally {
    spinning = false;
    spinBtn.disabled = false;
  }
}

async function loadBalance() {
  try {
    const res = await fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (!res.ok) return;
    const data = await res.json();
    updateBalance(data.balance);
  } catch (err) {
    console.error('No se pudo cargar el balance:', err);
  }
}

async function loadJackpot() {
  try {
    const data = await apiGet('/games/frutasdeluxe/jackpot');
    updateJackpot(data.pool);
  } catch (err) {
    console.error('No se pudo cargar el pozo:', err);
  }
}

spinBtn.addEventListener('click', spin);

setResult('Configura tu apuesta y presiona "Girar".');
loadBalance();
loadJackpot();
