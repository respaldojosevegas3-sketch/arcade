// backend/src/games/frutas/frutas.engine.js
// Lógica PURA del juego (sin I/O). Mismo principio que mines.engine.js:
// el resultado se genera SOLO en el servidor con el CSPRNG de Node
// (crypto.randomInt / crypto.randomBytes), nunca Math.random() ni el cliente.

const crypto = require('crypto');

const SYMBOLS = ['LEMON', 'CHERRY', 'BELL', 'GEM', 'STAR', 'SEVEN'];

/**
 * Elige un símbolo para un carrete según las probabilidades configuradas
 * (cfg.weights, un mapa símbolo -> peso; no hace falta que sumen 1, se
 * normalizan acá). Usa crypto.randomInt sobre un rango entero grande para
 * mantener precisión sin usar floats en la tirada del dado.
 */
function pickSymbol(weights) {
  const PRECISION = 1_000_000; // resolución para permitir pesos como 0.000001
  const entries = SYMBOLS.map((s) => [s, Math.round(weights[s] * PRECISION)]);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);

  let roll = crypto.randomInt(0, total);
  for (const [symbol, w] of entries) {
    if (roll < w) return symbol;
    roll -= w;
  }
  return entries[entries.length - 1][0]; // fallback defensivo por redondeo
}

/**
 * Tira los 3 carretes de forma independiente.
 */
function spinReels(weights) {
  return [pickSymbol(weights), pickSymbol(weights), pickSymbol(weights)];
}

/**
 * ¿El símbolo `s` "cuenta como" `target` para efectos de armar una racha?
 * La Estrella (STAR) sustituye a cualquier FRUTA, pero nunca a SEVEN ni
 * a sí misma como comodín ajeno (una racha de STAR debe ser de STAR real).
 */
function isMatch(s, target) {
  if (s === target) return true;
  if (s === 'STAR' && target !== 'SEVEN' && target !== 'STAR') return true;
  return false;
}

/**
 * El símbolo "objetivo" de la tirada es el primero (de izquierda a derecha)
 * que no sea comodín. Si los 3 son Estrella, el objetivo es la Estrella
 * misma (racha pura de comodines).
 */
function resolveTarget(reels) {
  for (const s of reels) {
    if (s !== 'STAR') return s;
  }
  return 'STAR';
}

/**
 * Longitud de la racha ganadora, contada desde el carrete 0 hacia la
 * derecha, cortando en el primer símbolo que no matchea. Esto implementa
 * la regla "solo paga si es consecutivo empezando desde la izquierda".
 */
function runLength(reels, target) {
  let count = 0;
  for (const s of reels) {
    if (isMatch(s, target)) count++;
    else break;
  }
  return count;
}

/**
 * Evalúa el resultado de una tirada contra la tabla de pagos (paytable).
 * paytable: { LEMON: {pair, triple}, CHERRY: {...}, BELL: {...}, GEM: {...},
 *             STAR: {triple}, SEVEN: {} } — SEVEN no tiene multiplicador
 * fijo: su triple dispara el jackpot progresivo (se resuelve fuera de acá).
 *
 * Devuelve { outcome, multiplier, isJackpot }.
 *   outcome: 'triple' | 'pair' | 'push' | 'loss'
 *   multiplier: multiplicador sobre la apuesta (0 para loss, 1 para push)
 *   isJackpot: true si deben pagarse los fondos del pozo progresivo
 */
function evaluateSpin(reels, paytable) {
  const target = resolveTarget(reels);
  const run = runLength(reels, target);

  if (target === 'SEVEN' && run === 3) {
    return { outcome: 'triple', multiplier: 0, isJackpot: true, target };
  }

  if (run === 3) {
    const mult = paytable[target]?.triple ?? 0;
    return { outcome: 'triple', multiplier: mult, isJackpot: false, target };
  }

  if (run === 2 && target !== 'SEVEN') {
    const mult = paytable[target]?.pair ?? 0;
    if (mult > 0) return { outcome: 'pair', multiplier: mult, isJackpot: false, target };
  }

  // Sin racha ganadora: si apareció al menos una Estrella en la tirada,
  // se devuelve la apuesta (push) en vez de perderla — así el comodín
  // siempre "hace algo" aunque no complete una combinación.
  if (reels.includes('STAR')) {
    return { outcome: 'push', multiplier: 1, isJackpot: false, target };
  }

  return { outcome: 'loss', multiplier: 0, isJackpot: false, target };
}

module.exports = { SYMBOLS, spinReels, evaluateSpin, isMatch, resolveTarget, runLength };
