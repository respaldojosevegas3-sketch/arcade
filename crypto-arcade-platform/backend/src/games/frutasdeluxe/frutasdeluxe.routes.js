// backend/src/games/frutasdeluxe/frutasdeluxe.routes.js
const express = require('express');
const { requireAuth } = require('../../middlewares/auth.middleware');
const controller = require('./frutasdeluxe.controller');

const router = express.Router();

router.post('/spin', requireAuth, controller.spin);
router.get('/jackpot', requireAuth, controller.jackpot);

module.exports = router;
