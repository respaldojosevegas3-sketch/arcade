// backend/src/middlewares/auth.middleware.js
const jwt = require('jsonwebtoken');
const config = require('../config');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'NO_TOKEN' });
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.userId = payload.userId; // el userId SIEMPRE sale del token firmado,
    // nunca del body del request (evita que un usuario apueste "como si fuera" otro).
    next();
  } catch (err) {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

module.exports = { requireAuth };
