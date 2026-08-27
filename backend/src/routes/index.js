// backend/src/routes/index.js
// Aquí se van agregando el resto de juegos a medida que se implementan:
// router.use('/crash', crashRoutes);
// router.use('/dice', diceRoutes);
// router.use('/plinko', plinkoRoutes);
// router.use('/slot', slotRoutes);

const express = require('express');
const minesRoutes = require('../games/mines/mines.routes');
const meRoutes = require('../routes/me.routes');
const authRoutes = require('../routes/auth.routes');
const paymentsRoutes = require('../../routes/payments');
const adminRoutes = require('../../routes/admin');
const { requireAuth } = require('../middlewares/auth.middleware');
const { isAdmin } = require('../middlewares/isAdmin');

const router = express.Router();
router.use('/games/mines', minesRoutes);
router.use('/me', meRoutes);
router.use('/auth', authRoutes);
router.use('/payments', paymentsRoutes);
router.use('/admin', requireAuth, isAdmin, adminRoutes);
module.exports = router;
