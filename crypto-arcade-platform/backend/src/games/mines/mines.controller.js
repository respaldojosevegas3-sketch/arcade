// backend/src/games/mines/mines.controller.js
const minesService = require('./mines.service');

async function start(req, res) {
  try {
    const { betAmount, mineCount } = req.body;
    const userId = req.userId; // viene del JWT, no del body

    if (typeof betAmount !== 'number' || typeof mineCount !== 'number') {
      return res.status(400).json({ error: 'INVALID_PAYLOAD' });
    }

    const data = await minesService.startGame({ userId, betAmount, mineCount });
    return res.status(201).json(data);
  } catch (err) {
    return handleError(res, err);
  }
}

async function reveal(req, res) {
  try {
    const { sessionId, tileIndex } = req.body;
    const userId = req.userId;

    if (typeof tileIndex !== 'number' || !sessionId) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD' });
    }

    const data = await minesService.revealTile({ userId, sessionId, tileIndex });
    return res.status(200).json(data);
  } catch (err) {
    return handleError(res, err);
  }
}

async function cashout(req, res) {
  try {
    const { sessionId } = req.body;
    const userId = req.userId;

    if (!sessionId) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD' });
    }

    const data = await minesService.cashout({ userId, sessionId });
    return res.status(200).json(data);
  } catch (err) {
    return handleError(res, err);
  }
}

function handleError(res, err) {
  if (err instanceof minesService.GameError) {
    const statusMap = {
      MAINTENANCE_MODE: 503,
      BET_OUT_OF_RANGE: 400,
      INVALID_MINE_COUNT: 400,
      SESSION_NOT_FOUND: 404,
      FORBIDDEN: 403,
      GAME_ALREADY_ENDED: 409,
      INVALID_TILE: 400,
      TILE_ALREADY_REVEALED: 409,
      NOTHING_TO_CASHOUT: 400,
    };
    const status = statusMap[err.code] || 400;
    return res.status(status).json({ error: err.code, message: err.message });
  }

  if (err.message === 'INSUFFICIENT_BALANCE') {
    return res.status(400).json({ error: 'INSUFFICIENT_BALANCE' });
  }

  console.error('[Mines] Error inesperado:', err);
  return res.status(500).json({ error: 'INTERNAL_ERROR' });
}

module.exports = { start, reveal, cashout };
