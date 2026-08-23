// backend/src/games/mines/mines.routes.js
const express = require('express');
const { requireAuth } = require('../../middlewares/auth.middleware');
const controller = require('./mines.controller');

const router = express.Router();

router.post('/start', requireAuth, controller.start);
router.post('/reveal', requireAuth, controller.reveal);
router.post('/cashout', requireAuth, controller.cashout);

module.exports = router;
