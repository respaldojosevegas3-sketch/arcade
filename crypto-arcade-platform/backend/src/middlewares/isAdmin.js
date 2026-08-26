// middleware/isAdmin.js
//
// Restringe una ruta a un set fijo de emails de administrador,
// definidos en la variable de entorno ADMIN_EMAILS (separados por coma).
//
// Requiere que el middleware de auth ya haya corrido antes y haya
// dejado `req.user.email` seteado desde el JWT.
//
// Uso en routes/payments.js:
//   const isAdmin = require('../middleware/isAdmin');
//   router.post('/withdraw/:id/approve', authMiddleware, isAdmin, async (req, res) => { ... });
//   router.post('/withdraw/:id/reject', authMiddleware, isAdmin, async (req, res) => { ... });

function isAdmin(req, res, next) {
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const userEmail = (req.user?.email || "").toLowerCase();

  if (!userEmail || !adminEmails.includes(userEmail)) {
    return res.status(403).json({ error: "No autorizado." });
  }

  next();
}

module.exports = isAdmin;
