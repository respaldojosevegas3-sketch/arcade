// backend/routes/admin.js
//
// Todas las rutas de acá requieren estar logueado Y ser admin.
// Se aplica una sola vez al montar el router (ver instrucciones de index.js).

const express = require('express');
const { pool } = require('../src/db/pool');
const { getGameConfig, setGameConfig } = require('../src/redis/client');

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
