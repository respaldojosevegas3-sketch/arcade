// backend/src/models/jackpotClaims.service.js
// Reclamos de jackpot que requieren aprobación manual de un admin antes
// de acreditarse (medida antifraude para premios grandes, pedida
// explícitamente para Frutas Deluxe).

const pool = require('../db/pool');
const ledger = require('./ledger.service');

async function createClaim({ userId, game, sessionId, amount }) {
  const { rows } = await pool.query(
    `INSERT INTO jackpot_claims (user_id, game, session_id, amount, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id, user_id, game, session_id, amount, status, created_at`,
    [userId, game, sessionId, amount]
  );
  return rows[0];
}

async function listClaims({ status } = {}) {
  const { rows } = await pool.query(
    `SELECT jc.id, jc.user_id, u.email, jc.game, jc.session_id, jc.amount,
            jc.status, jc.created_at, jc.resolved_at
       FROM jackpot_claims jc
       JOIN users u ON u.id = jc.user_id
      WHERE ($1::text IS NULL OR jc.status = $1)
      ORDER BY jc.created_at DESC`,
    [status || null]
  );
  return rows;
}

/**
 * Aprueba un reclamo: acredita el pago real (reutilizando el ledger, que
 * ya sabe cerrar una apuesta 'open' identificada por session_id) y marca
 * el reclamo como 'approved'.
 */
async function approveClaim({ claimId }) {
  const { rows } = await pool.query(
    `SELECT * FROM jackpot_claims WHERE id = $1 AND status = 'pending'`,
    [claimId]
  );
  const claim = rows[0];
  if (!claim) return null;

  const newBalance = await ledger.creditPayout({
    userId: claim.user_id,
    sessionId: claim.session_id,
    payoutAmount: claim.amount,
  });

  await pool.query(
    `UPDATE jackpot_claims SET status = 'approved', resolved_at = NOW() WHERE id = $1`,
    [claimId]
  );

  return { ...claim, status: 'approved', newBalance };
}

/**
 * Rechaza un reclamo (ej. se detectó un intento de fraude). La apuesta
 * queda cerrada como perdida — el jugador no recibe nada.
 */
async function rejectClaim({ claimId }) {
  const { rows } = await pool.query(
    `SELECT * FROM jackpot_claims WHERE id = $1 AND status = 'pending'`,
    [claimId]
  );
  const claim = rows[0];
  if (!claim) return null;

  await ledger.settleAsLoss({ sessionId: claim.session_id });

  await pool.query(
    `UPDATE jackpot_claims SET status = 'rejected', resolved_at = NOW() WHERE id = $1`,
    [claimId]
  );

  return { ...claim, status: 'rejected' };
}

module.exports = { createClaim, listClaims, approveClaim, rejectClaim };
