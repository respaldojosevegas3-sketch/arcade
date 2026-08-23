// backend/src/routes/index.js
// Aquí se van agregando el resto de juegos a medida que se implementan:
// router.use('/crash', crashRoutes);
// router.use('/dice', diceRoutes);
// router.use('/plinko', plinkoRoutes);
// router.use('/slot', slotRoutes);

const express = require('express');
const minesRoutes = require('../games/mines/mines.routes');

const router = express.Router();

router.use('/games/mines', minesRoutes);

module.exports = router;
