// backend/routes/admin.js
//
// Todas las rutas de acá requieren estar logueado Y ser admin.
// Se aplica una sola vez al montar el router (ver instrucciones de index.js).

const express = require('express');
const { pool } = require('../src/db/pool');
const { getGameConfig, setGameConfig } = require('../src/redis/client');
const { getJackpotPool } = require('../src/redis/jackpot');
const jackpotClaims = require('../src/models/jackpotClaims.service');

const router = express.Router();

/**
 * GET /api/admin/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const [{ rows: volumeRows }, { rows: userRows }, { rows: pendingRows }, { rows: revenueRows }] =
      await Promise.all([
        pool.query(`SELECT COALESCE(SUM(amount), 0) AS v FROM bets WHERE created_at >= CURRENT_DATE`),
        pool.query(`SELECT COUNT(DISTINCT user_id) AS c FROM bets WHERE created_at >= CURRENT_DATE`),
        pool.query(`SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'pending'`),
        pool.query(
          `SELECT COALESCE(SUM(amount), 0) - COALESCE(SUM(payout), 0) AS r
           FROM bets WHERE created_at >= CURRENT_DATE AND status != 'open'`
        ),
      ]);

    res.json({
      volumeToday: Number(volumeRows[0].v).toFixed(2),
      houseRevenueToday: Number(revenueRows[0].r).toFixed(2),
      activeUsers: Number(userRows[0].c),
      pendingWithdrawals: Number(pendingRows[0].c),
    });
  } catch (err) {
    console.error('[Admin] Error en /stats:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/admin/games/mines
 * Lee la config operativa de Mines desde Redis (con fallback a defaults).
 */
router.get('/games/mines', async (req, res) => {
  try {
    const cfg = await getGameConfig('mines');
    res.json(cfg);
  } catch (err) {
    console.error('[Admin] Error leyendo config de mines:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/admin/games/mines
 * Actualiza la config operativa de Mines en Redis. Toma efecto
 * inmediato, sin redeploy — las próximas partidas ya la usan.
 */
router.put('/games/mines', async (req, res) => {
  const { houseEdge, minBet, maxBet, minMines, maxMines, maintenanceMode } = req.body;

  try {
    const current = await getGameConfig('mines');
    const updated = {
      ...current,
      ...(houseEdge !== undefined && { houseEdge }),
      ...(minBet !== undefined && { minBet }),
      ...(maxBet !== undefined && { maxBet }),
      ...(minMines !== undefined && { minMines }),
      ...(maxMines !== undefined && { maxMines }),
      ...(maintenanceMode !== undefined && { maintenanceMode }),
    };

    await setGameConfig('mines', updated);
    res.json(updated);
  } catch (err) {
    console.error('[Admin] Error actualizando config de mines:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/admin/games/frutas
 * Lee la config operativa de Frutas desde Redis (con fallback a defaults).
 */
router.get('/games/frutas', async (req, res) => {
  try {
    const cfg = await getGameConfig('frutas');
    res.json(cfg);
  } catch (err) {
    console.error('[Admin] Error leyendo config de frutas:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/admin/games/frutas
 * Actualiza la config operativa de Frutas en Redis. Toma efecto inmediato.
 * Acepta actualizaciones parciales de weights/paytable/jackpot (merge por
 * campo, no reemplazo total) para que se pueda subir solo el houseEdge de
 * un símbolo o solo el piso del jackpot sin tener que reenviar todo.
 */
router.put('/games/frutas', async (req, res) => {
  const { minBet, maxBet, maintenanceMode, weights, paytable, jackpot } = req.body;

  try {
    const current = await getGameConfig('frutas');
    const updated = {
      ...current,
      ...(minBet !== undefined && { minBet }),
      ...(maxBet !== undefined && { maxBet }),
      ...(maintenanceMode !== undefined && { maintenanceMode }),
      weights: weights ? { ...current.weights, ...weights } : current.weights,
      paytable: paytable ? { ...current.paytable, ...paytable } : current.paytable,
      jackpot: jackpot ? { ...current.jackpot, ...jackpot } : current.jackpot,
    };

    await setGameConfig('frutas', updated);
    res.json(updated);
  } catch (err) {
    console.error('[Admin] Error actualizando config de frutas:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/admin/games/frutas/jackpot
 * Solo lectura: cuánto hay acumulado en el pozo AHORA MISMO. No se edita
 * a mano — crece solo con cada tirada y se resetea solo al pagarse.
 */
router.get('/games/frutas/jackpot', async (req, res) => {
  try {
    const cfg = await getGameConfig('frutas');
    const pool = await getJackpotPool(cfg.jackpot.floor);
    res.json({ pool, floor: cfg.jackpot.floor, payoutIfWonNow: Math.max(0, pool - cfg.jackpot.floor) });
  } catch (err) {
    console.error('[Admin] Error leyendo pozo de frutas:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/admin/users/credit
 * Acredita saldo manualmente a un usuario por email. Pensado para cargar
 * saldo de prueba durante desarrollo, o para ajustes manuales puntuales
 * (ej. compensar un error). Queda registrado en el ledger igual que
 * cualquier otro movimiento, para no perder trazabilidad contable.
 */
router.post('/users/credit', async (req, res) => {
  const { email, amount } = req.body;

  if (!email || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'INVALID_PAYLOAD' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users
         SET balance_usdt = balance_usdt + $1
       WHERE email = $2
       RETURNING id, email, balance_usdt`,
      [amount, email]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }

    await pool.query(
      `INSERT INTO ledger_entries (user_id, type, amount, ref_id)
       VALUES ($1, 'deposit', $2, 'manual_admin_credit')`,
      [rows[0].id, amount]
    );

    res.json({ email: rows[0].email, newBalance: rows[0].balance_usdt });
  } catch (err) {
    console.error('[Admin] Error acreditando saldo:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/admin/games/frutasdeluxe
 */
router.get('/games/frutasdeluxe', async (req, res) => {
  try {
    const cfg = await getGameConfig('frutasdeluxe');
    res.json(cfg);
  } catch (err) {
    console.error('[Admin] Error leyendo config de frutasdeluxe:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/admin/games/frutasdeluxe
 */
router.put('/games/frutasdeluxe', async (req, res) => {
  const { minBet, maxBet, maintenanceMode, weights, paytable, jackpot, manualReviewThreshold } = req.body;

  try {
    const current = await getGameConfig('frutasdeluxe');
    const updated = {
      ...current,
      ...(minBet !== undefined && { minBet }),
      ...(maxBet !== undefined && { maxBet }),
      ...(maintenanceMode !== undefined && { maintenanceMode }),
      ...(manualReviewThreshold !== undefined && { manualReviewThreshold }),
      weights: weights ? { ...current.weights, ...weights } : current.weights,
      paytable: paytable ? { ...current.paytable, ...paytable } : current.paytable,
      jackpot: jackpot ? { ...current.jackpot, ...jackpot } : current.jackpot,
    };

    await setGameConfig('frutasdeluxe', updated);
    res.json(updated);
  } catch (err) {
    console.error('[Admin] Error actualizando config de frutasdeluxe:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/admin/games/frutasdeluxe/jackpot
 */
router.get('/games/frutasdeluxe/jackpot', async (req, res) => {
  try {
    const cfg = await getGameConfig('frutasdeluxe');
    const pool = await getJackpotPool('frutasdeluxe', cfg.jackpot.floor);
    res.json({ pool, floor: cfg.jackpot.floor, payoutIfWonNow: Math.max(0, pool - cfg.jackpot.floor) });
  } catch (err) {
    console.error('[Admin] Error leyendo pozo de frutasdeluxe:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/admin/jackpots?status=pending
 * Lista de reclamos de jackpot esperando revisión manual (por ahora solo
 * lo usa Frutas Deluxe, pero queda genérico por si otro juego lo suma).
 */
router.get('/jackpots', async (req, res) => {
  try {
    const claims = await jackpotClaims.listClaims({ status: req.query.status });
    res.json(claims);
  } catch (err) {
    console.error('[Admin] Error listando reclamos de jackpot:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/admin/jackpots/:id/approve
 * Acredita el premio real al jugador. Usar SOLO después de verificar
 * manualmente que la tirada es legítima (revisar reels/session_id contra
 * los logs del backend si hay dudas).
 */
router.post('/jackpots/:id/approve', async (req, res) => {
  try {
    const result = await jackpotClaims.approveClaim({ claimId: req.params.id });
    if (!result) return res.status(404).json({ error: 'CLAIM_NOT_FOUND_OR_ALREADY_RESOLVED' });
    res.json(result);
  } catch (err) {
    console.error('[Admin] Error aprobando reclamo de jackpot:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/admin/jackpots/:id/reject
 * Rechaza el reclamo (ej. se detectó manipulación). El jugador no cobra.
 */
router.post('/jackpots/:id/reject', async (req, res) => {
  try {
    const result = await jackpotClaims.rejectClaim({ claimId: req.params.id });
    if (!result) return res.status(404).json({ error: 'CLAIM_NOT_FOUND_OR_ALREADY_RESOLVED' });
    res.json(result);
  } catch (err) {
    console.error('[Admin] Error rechazando reclamo de jackpot:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/admin/withdrawals?status=pending
 */
router.get('/withdrawals', async (req, res) => {
  const status = req.query.status || 'pending';

  const { rows } = await pool.query(
    `SELECT w.id, w.amount_usd, w.wallet_address, w.status, w.requested_at, u.email AS user_email
     FROM withdrawals w
     JOIN users u ON u.id = w.user_id
     WHERE w.status = $1
     ORDER BY w.requested_at ASC`,
    [status]
  );

  res.json(rows);
});

module.exports = router;
