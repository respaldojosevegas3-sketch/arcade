// backend/src/models/ledger.service.js
// Todas las operaciones que tocan saldo real del usuario pasan por aquí,
// y SIEMPRE dentro de una transacción SQL (withTransaction). Esto evita
// condiciones de carrera (doble cobro, doble pago) bajo concurrencia.
//
// Esquema mínimo esperado (ver docs/schema.sql):
//   users(id, balance_usdt NUMERIC(18,6), ...)
//   bets(id, user_id, game, session_id, amount, status, created_at)
//   ledger_entries(id, user_id, type, amount, ref_id, created_at)

const { withTransaction } = require('../db/pool');

/**
 * Debita el monto de la apuesta del saldo del usuario de forma atómica.
 * Lanza error si el saldo es insuficiente (constraint a nivel de fila).
 */
async function debitForBet({ userId, amount, game, sessionId }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE users
         SET balance_usdt = balance_usdt - $1
       WHERE id = $2 AND balance_usdt >= $1
       RETURNING balance_usdt`,
      [amount, userId]
    );

    if (rows.length === 0) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    await client.query(
      `INSERT INTO bets (user_id, game, session_id, amount, status)
       VALUES ($1, $2, $3, $4, 'open')`,
      [userId, game, sessionId, amount]
    );

    await client.query(
      `INSERT INTO ledger_entries (user_id, type, amount, ref_id)
       VALUES ($1, 'bet_debit', $2, $3)`,
      [userId, amount, sessionId]
    );

    return rows[0].balance_usdt;
  });
}

/**
 * Acredita el pago del cashout y cierra la apuesta abierta.
 * payoutAmount ya viene calculado (stake * multiplicador) desde el
 * servicio del juego, con el house edge ya aplicado.
 */
async function creditPayout({ userId, sessionId, payoutAmount }) {
  return withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE bets
         SET status = 'closed', payout = $1, closed_at = NOW()
       WHERE session_id = $2 AND status = 'open'
       RETURNING id`,
      [payoutAmount, sessionId]
    );

    if (updated.rows.length === 0) {
      // Ya fue pagada o no existe: evita doble pago (idempotencia).
      throw new Error('BET_ALREADY_CLOSED_OR_NOT_FOUND');
    }

    const { rows } = await client.query(
      `UPDATE users
         SET balance_usdt = balance_usdt + $1
       WHERE id = $2
       RETURNING balance_usdt`,
      [payoutAmount, userId]
    );

    await client.query(
      `INSERT INTO ledger_entries (user_id, type, amount, ref_id)
       VALUES ($1, 'payout_credit', $2, $3)`,
      [userId, payoutAmount, sessionId]
    );

    return rows[0].balance_usdt;
  });
}

/**
 * Cierra una apuesta como perdida (el usuario tocó una mina o abandonó).
 * No hay crédito: el débito inicial ya cubrió la pérdida.
 */
async function settleAsLoss({ sessionId }) {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE bets
         SET status = 'lost', payout = 0, closed_at = NOW()
       WHERE session_id = $1 AND status = 'open'`,
      [sessionId]
    );
  });
}

module.exports = { debitForBet, creditPayout, settleAsLoss };
