// backend/src/games/frutas/frutas.routes.js
const express = require('express');
const { requireAuth } = require('../../middlewares/auth.middleware');
const controller = require('./frutas.controller');

const router = express.Router();

router.post('/spin', requireAuth, controller.spin);
router.get('/jackpot', requireAuth, controller.jackpot);

module.exports = router;
