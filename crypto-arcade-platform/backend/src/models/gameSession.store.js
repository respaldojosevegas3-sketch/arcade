// backend/src/models/gameSession.store.js
// Almacena el estado COMPLETO de la partida (incluyendo posición real de
// las minas) del lado del servidor, indexado por sessionId.
// El cliente SOLO conoce el sessionId + las casillas que ya reveló.
// TTL corto: si el usuario abandona la partida, expira y el importe
// apostado queda registrado como pérdida (ya fue debitado al iniciar).

const { redis, ensureConnected } = require('../redis/client');

const SESSION_PREFIX = 'mines:session:';
const SESSION_TTL_SECONDS = 60 * 30; // 30 min máx por partida abierta

async function createSession(sessionId, sessionData) {
  await ensureConnected();
  await redis.set(SESSION_PREFIX + sessionId, JSON.stringify(sessionData), {
    EX: SESSION_TTL_SECONDS,
  });
}

async function getSession(sessionId) {
  await ensureConnected();
  const raw = await redis.get(SESSION_PREFIX + sessionId);
  return raw ? JSON.parse(raw) : null;
}

async function updateSession(sessionId, sessionData) {
  await ensureConnected();
  // Mantiene el TTL restante en vez de resetearlo a full cada update,
  // usando KEEPTTL para no extender indefinidamente la ventana de juego.
  await redis.set(SESSION_PREFIX + sessionId, JSON.stringify(sessionData), {
    KEEPTTL: true,
  });
}

async function deleteSession(sessionId) {
  await ensureConnected();
  await redis.del(SESSION_PREFIX + sessionId);
}

module.exports = { createSession, getSession, updateSession, deleteSession };
