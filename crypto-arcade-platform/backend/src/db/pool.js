// backend/src/db/pool.js
// Pool de conexión a PostgreSQL. Aquí viven las operaciones ATÓMICAS
// de saldo (depósitos, retiros, apuestas, pagos). Nunca se maneja saldo
// crítico en memoria o en Redis: Redis es solo caché/estado efímero.

const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(
  config.db.connectionString
    ? {
        connectionString: config.db.connectionString,
        ssl: config.db.ssl,
        max: 20,
        idleTimeoutMillis: 30000,
      }
    : {
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        max: 20,
        idleTimeoutMillis: 30000,
      }
);

pool.on('error', (err) => {
  console.error('[PG] Error inesperado en cliente idle', err);
});

/**
 * Ejecuta una función dentro de una transacción SQL.
 * Uso: await withTransaction(async (client) => { ... });
 * Garantiza atomicidad para operaciones de saldo (débito/crédito).
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
