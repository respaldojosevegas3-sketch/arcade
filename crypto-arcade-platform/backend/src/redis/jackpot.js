// backend/src/redis/jackpot.js
// Pozo progresivo de Frutas. Vive aparte de config:games:* porque NO es
// configuración editable a mano: es un contador que crece solo con cada
// apuesta y se resetea solo cuando alguien gana el jackpot.
//
// Se usa INCRBYFLOAT para que el aporte sea atómico incluso con muchas
// tiradas simultáneas en varias instancias del backend (evita condiciones
// de carrera donde dos aportes pisan el mismo valor leído).

const { redis, ensureConnected } = require('./client');

const JACKPOT_KEY = 'jackpot:frutas:pool';

/**
 * Lee el pozo actual. Si nunca se sembró (primer arranque), lo inicializa
 * en el piso configurado.
 */
async function getJackpotPool(floor) {
  await ensureConnected();
  const raw = await redis.get(JACKPOT_KEY);
  if (raw !== null) return Number(raw);

  await redis.set(JACKPOT_KEY, String(floor));
  return floor;
}

/**
 * Suma el aporte de una tirada al pozo, de forma atómica.
 */
async function addToJackpotPool(amount) {
  await ensureConnected();
  const newValue = await redis.incrByFloat(JACKPOT_KEY, amount);
  return Number(newValue);
}

/**
 * Resetea el pozo al piso configurado tras pagar un jackpot.
 * Usa SET (no INCR) porque acá sí queremos un valor absoluto, no relativo.
 */
async function resetJackpotPool(floor) {
  await ensureConnected();
  await redis.set(JACKPOT_KEY, String(floor));
  return floor;
}

module.exports = { getJackpotPool, addToJackpotPool, resetJackpotPool };
