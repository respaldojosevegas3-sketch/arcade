// backend/src/games/frutas/frutas.controller.js
const frutasService = require('./frutas.service');

async function spin(req, res) {
  try {
    const { betAmount } = req.body;
    const userId = req.userId; // viene del JWT, no del body (mismo patrón que Mines)

    if (typeof betAmount !== 'number' || betAmount <= 0) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD' });
    }

    const data = await frutasService.spin({ userId, betAmount });
    return res.status(200).json(data);
  } catch (err) {
    return handleError(res, err);
  }
}

function handleError(res, err) {
  if (err instanceof frutasService.GameError) {
    const statusMap = {
      MAINTENANCE_MODE: 503,
      BET_OUT_OF_RANGE: 400,
    };
    const status = statusMap[err.code] || 400;
    return res.status(status).json({ error: err.code, message: err.message });
  }

  if (err.message === 'INSUFFICIENT_BALANCE') {
    return res.status(400).json({ error: 'INSUFFICIENT_BALANCE' });
  }

  console.error('[Frutas] Error inesperado:', err);
  return res.status(500).json({ error: 'INTERNAL_ERROR' });
}

module.exports = { spin };
