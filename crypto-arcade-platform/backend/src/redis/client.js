// backend/src/redis/client.js
// Redis se usa para:
//  1) Estado efímero de partidas en curso (grid de minas, casillas reveladas)
//     -> permite escalar el backend horizontalmente (varias instancias Node
//        pueden leer/escribir el mismo estado de partida).
//  2) Config operativa en caliente editada desde el Backoffice
//     (house edge, límites de apuesta, modo mantenimiento, billeteras activas).
//  3) Rate limiting / anti-abuso.

const { createClient } = require('redis');
const config = require('../config');

const redis = createClient({ url: config.redis.url });

redis.on('error', (err) => console.error('[Redis] Error de conexión', err));

let connected = false;
async function ensureConnected() {
  if (!connected) {
    await redis.connect();
    connected = true;
  }
}

const CONFIG_KEY_PREFIX = 'config:games:';

/**
 * Lee la configuración operativa de un juego desde Redis.
 * Si no existe (primer arranque), la siembra con el default del config
 * estático y la devuelve.
 */
async function getGameConfig(gameName) {
  await ensureConnected();
  const key = CONFIG_KEY_PREFIX + gameName;
  const raw = await redis.get(key);
  if (raw) return JSON.parse(raw);

  const fallback = config.games[gameName];
  if (fallback) {
    await redis.set(key, JSON.stringify(fallback));
  }
  return fallback;
}

/**
 * Usado por el Backoffice para actualizar parámetros en caliente
 * (house edge, límites, mantenimiento) sin redeploy.
 */
async function setGameConfig(gameName, newConfig) {
  await ensureConnected();
  const key = CONFIG_KEY_PREFIX + gameName;
  await redis.set(key, JSON.stringify(newConfig));
  return newConfig;
}

module.exports = { redis, ensureConnected, getGameConfig, setGameConfig };
