// backend/src/games/frutasdeluxe/frutasdeluxe.engine.js
// Igual principio que frutas.engine.js (RNG server-side con crypto,
// nunca Math.random ni el cliente), pero con 5 posiciones y una regla
// de comodín más sofisticada: en vez de fijar una sola "identidad" para
// la tirada, se evalúan TODAS las identidades posibles y se paga la que
// más le convenga al jugador. Esto evita que una racha de Estrellas se
// vea opacada por una fruta que aparece después (ver docs internos /
// conversación con Anthropic del [fecha] para el porqué de este cambio).

const crypto = require('crypto');

const SYMBOLS = ['LEMON', 'CHERRY', 'BELL', 'GEM', 'STAR', 'SEVEN'];
const REELS = 5;
const TIER_NAME = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' };

function pickSymbol(weights) {
  const PRECISION = 1_000_000;
  const entries = SYMBOLS.map((s) => [s, Math.round(weights[s] * PRECISION)]);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);

  let roll = crypto.randomInt(0, total);
  for (const [symbol, w] of entries) {
    if (roll < w) return symbol;
    roll -= w;
  }
  return entries[entries.length - 1][0];
}

function spinReels(weights) {
  return Array.from({ length: REELS }, () => pickSymbol(weights));
}

/**
 * Cuenta cuántas posiciones consecutivas desde la izquierda "son" el
 * símbolo `target`. Las frutas aceptan que la Estrella las sustituya;
 * STAR y SEVEN como objetivo NO aceptan sustitución (deben salir
 * literalmente — así el jackpot y el premio de Estrella pura mantienen
 * su rareza real, sin inflarse por el comodín).
 */
function runForTarget(reels, target) {
  const allowsWildcard = target !== 'STAR' && target !== 'SEVEN';
  let count = 0;
  for (const s of reels) {
    const matches = s === target || (allowsWildcard && s === 'STAR');
    if (matches) count++;
    else break;
  }
  return count;
}

/**
 * Evalúa TODAS las identidades posibles de la tirada y devuelve la que
 * mejor le paga al jugador. El jackpot (5 sietes literales) tiene
 * prioridad absoluta sobre cualquier otra interpretación.
 */
function evaluateSpin(reels, paytable) {
  if (runForTarget(reels, 'SEVEN') === REELS) {
    return { outcome: 'jackpot', multiplier: 0, isJackpot: true, target: 'SEVEN' };
  }

  let best = { outcome: 'loss', multiplier: 0, isJackpot: false, target: null };

  for (const target of SYMBOLS) {
    if (target === 'SEVEN') continue; // ya cubierto arriba; sin premio parcial
    const run = runForTarget(reels, target);
    if (run < 2) continue;

    const tier = TIER_NAME[run];
    const mult = paytable[target]?.[tier];
    if (mult && mult > best.multiplier) {
      best = { outcome: `${run}_${target.toLowerCase()}`, multiplier: mult, isJackpot: false, target };
    }
  }

  if (best.multiplier > 0) return best;

  // Ninguna racha pagó, pero si apareció una Estrella en algún lado,
  // se devuelve la apuesta en vez de perderla del todo.
  if (reels.includes('STAR')) {
    return { outcome: 'push', multiplier: 1, isJackpot: false, target: null };
  }

  return { outcome: 'loss', multiplier: 0, isJackpot: false, target: null };
}

module.exports = { SYMBOLS, REELS, spinReels, evaluateSpin, runForTarget };
