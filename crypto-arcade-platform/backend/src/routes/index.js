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
const router = express.Router();
router.use('/games/mines', minesRoutes);
router.use('/me', meRoutes);
router.use('/auth', authRoutes);
module.exports = router;
