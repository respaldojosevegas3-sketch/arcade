// backend/src/middlewares/isAdmin.js
//
// A diferencia de una version anterior, esta SI calza con el sistema real:
// requireAuth solo deja req.userId (no req.user), así que acá buscamos
// el email en la base para compararlo contra ADMIN_EMAILS.

const { pool } = require('../db/pool');

async function isAdmin(req, res, next) {
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (adminEmails.length === 0) {
    return res.status(403).json({ error: 'ADMIN_NOT_CONFIGURED' });
  }

  try {
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [req.userId]);
    const email = (rows[0]?.email || '').toLowerCase();

    if (!email || !adminEmails.includes(email)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    next();
  } catch (err) {
    console.error('[isAdmin] Error verificando admin:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = { isAdmin };
