// backend/src/routes/me.routes.js
const express = require('express');
const { requireAuth } = require('../middlewares/auth.middleware');
const { pool } = require('../db/pool');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT balance_usdt FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }

    res.json({
      userId: req.userId,
      balance: Number(result.rows[0].balance_usdt),
    });
  } catch (err) {
    console.error('[Me] Error inesperado:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
