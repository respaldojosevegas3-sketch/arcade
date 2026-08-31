// backend/src/redis/jackpot.js
// Pozo progresivo, genérico para cualquier juego que lo necesite (Frutas,
// Frutas Deluxe, futuros). Cada juego tiene su propia clave, así los
// pozos NUNCA se mezclan entre sí.
//
// Se usa INCRBYFLOAT para que el aporte sea atómico incluso con muchas
// tiradas simultáneas en varias instancias del backend.

const { redis, ensureConnected } = require('./client');

function keyFor(game) {
  return `jackpot:${game}:pool`;
}

/**
 * Lee el pozo actual de un juego. Si nunca se sembró (primer arranque),
 * lo inicializa en el piso configurado para ESE juego.
 */
async function getJackpotPool(game, floor) {
  await ensureConnected();
  const raw = await redis.get(keyFor(game));
  if (raw !== null) return Number(raw);

  await redis.set(keyFor(game), String(floor));
  return floor;
}

/**
 * Suma el aporte de una tirada al pozo de ese juego, de forma atómica.
 */
async function addToJackpotPool(game, amount) {
  await ensureConnected();
  const newValue = await redis.incrByFloat(keyFor(game), amount);
  return Number(newValue);
}

/**
 * Resetea el pozo de ese juego al piso configurado tras pagar un jackpot.
 */
async function resetJackpotPool(game, floor) {
  await ensureConnected();
  await redis.set(keyFor(game), String(floor));
  return floor;
}

module.exports = { getJackpotPool, addToJackpotPool, resetJackpotPool };
