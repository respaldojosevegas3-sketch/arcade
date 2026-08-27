// routes/admin.js
//
// Monta este router en tu app.js, protegido por isAdmin:
//   const adminRouter = require('./routes/admin');
//   app.use('/api/admin', authMiddleware, isAdmin, adminRouter);
//
// (isAdmin y authMiddleware van UNA vez al montar el router entero,
// así no hace falta repetirlos en cada ruta de este archivo.)

const express = require("express");
const pool = require("../db");

const router = express.Router();

/**
 * GET /api/admin/stats
 * Números para la vista de Resumen del panel.
 */
router.get("/stats", async (req, res) => {
  try {
    const [{ rows: volumeRows }, { rows: userRows }, { rows: pendingRows }] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS volume_today
         FROM bets WHERE created_at >= CURRENT_DATE`
      ),
      pool.query(
        `SELECT COUNT(DISTINCT user_id) AS active_users
         FROM bets WHERE created_at >= CURRENT_DATE`
      ),
      pool.query(`SELECT COUNT(*) AS pending_count FROM withdrawals WHERE status = 'pending'`),
    ]);

    const volumeToday = Number(volumeRows[0].volume_today);

    const { rows: revenueRows } = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) - COALESCE(SUM(payout), 0) AS house_revenue
       FROM bets WHERE created_at >= CURRENT_DATE`
    );

    res.json({
      volumeToday: volumeToday.toFixed(2),
      houseRevenueToday: Number(revenueRows[0].house_revenue).toFixed(2),
      activeUsers: Number(userRows[0].active_users),
      pendingWithdrawals: Number(pendingRows[0].pending_count),
    });
  } catch (err) {
    console.error("Error en /admin/stats:", err);
    res.status(500).json({ error: "Error al calcular estadísticas." });
  }
});

/**
 * GET /api/admin/games
 * Devuelve la configuración actual de todos los juegos.
 */
router.get("/games", async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM game_configs ORDER BY id`);
  res.json(rows);
});

/**
 * PUT /api/admin/games/:id
 * Actualiza la configuración de un juego (house edge, créditos por ronda, límites, enabled).
 */
router.put("/games/:id", async (req, res) => {
  const { id } = req.params;
  const { enabled, houseEdge, creditsPerRound, minBet, maxBet } = req.body;

  const { rows } = await pool.query(
    `UPDATE game_configs
     SET enabled = COALESCE($1, enabled),
         house_edge = COALESCE($2, house_edge),
         credits_per_round = COALESCE($3, credits_per_round),
         min_bet = COALESCE($4, min_bet),
         max_bet = COALESCE($5, max_bet),
         updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [enabled, houseEdge, creditsPerRound, minBet, maxBet, id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Juego no encontrado." });
  }

  res.json(rows[0]);
});

/**
 * GET /api/admin/withdrawals?status=pending
 * Lista de retiros, por defecto solo los pendientes.
 */
router.get("/withdrawals", async (req, res) => {
  const status = req.query.status || "pending";

  const { rows } = await pool.query(
    `SELECT w.id, w.amount_usd, w.wallet_address, w.status, w.requested_at,
            u.email AS user_email
     FROM withdrawals w
     JOIN users u ON u.id = w.user_id
     WHERE w.status = $1
     ORDER BY w.requested_at ASC`,
    [status]
  );

  res.json(rows);
});

module.exports = router;
