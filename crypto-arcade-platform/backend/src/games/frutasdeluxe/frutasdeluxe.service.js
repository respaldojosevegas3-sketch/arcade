// backend/src/games/frutasdeluxe/frutasdeluxe.service.js
const crypto = require('crypto');
const { getGameConfig } = require('../../redis/client');
const { getJackpotPool, addToJackpotPool, resetJackpotPool } = require('../../redis/jackpot');
const ledger = require('../../models/ledger.service');
const jackpotClaims = require('../../models/jackpotClaims.service');
const engine = require('./frutasdeluxe.engine');

const GAME = 'frutasdeluxe';

class GameError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function spin({ userId, betAmount }) {
  const cfg = await getGameConfig(GAME);

  if (cfg.maintenanceMode) {
    throw new GameError('MAINTENANCE_MODE', 'El juego está en mantenimiento.');
  }
  if (betAmount < cfg.minBet || betAmount > cfg.maxBet) {
    throw new GameError('BET_OUT_OF_RANGE', `La apuesta debe estar entre ${cfg.minBet} y ${cfg.maxBet} USDT.`);
  }

  const sessionId = crypto.randomUUID();

  // 1. Débito atómico de la apuesta.
  await ledger.debitForBet({ userId, amount: betAmount, game: GAME, sessionId });

  // 2. Aporte al pozo (propio de Frutas Deluxe, separado del de Frutas).
  const contribution = Number((betAmount * cfg.jackpot.contributionPct).toFixed(6));
  await addToJackpotPool(GAME, contribution);

  // 3. Tirada server-side.
  const reels = engine.spinReels(cfg.weights);
  const result = engine.evaluateSpin(reels, cfg.paytable);

  // 4a. CAMINO JACKPOT: nunca se acredita solo (ver más abajo).
  if (result.isJackpot) {
    const currentPool = await getJackpotPool(GAME, cfg.jackpot.floor);
    const claimedAmount = Number(Math.max(0, currentPool - cfg.jackpot.floor).toFixed(6));
    const poolAfter = await resetJackpotPool(GAME, cfg.jackpot.floor);

    await jackpotClaims.createClaim({ userId, game: GAME, sessionId, amount: claimedAmount });

    return {
      sessionId,
      reels,
      outcome: 'jackpot',
      multiplier: 0,
      payoutAmount: claimedAmount,
      jackpotWon: true,
      jackpotPending: true,
      bigWinPending: false,
      jackpotPool: poolAfter,
      newBalance: null,
    };
  }

  const payoutAmount = Number((betAmount * result.multiplier).toFixed(6));

  // 4b. CAMINO "PREMIO GRANDE": no es jackpot, pero supera el umbral que
  //     vos definiste (manualReviewThreshold) — tampoco se acredita
  //     solo, queda pendiente de tu aprobación por la misma vía que el
  //     jackpot (reutiliza jackpot_claims, que ya sirve para cualquier
  //     pago que necesite revisión, no solo el jackpot en sí).
  if (payoutAmount >= cfg.manualReviewThreshold) {
    await jackpotClaims.createClaim({ userId, game: GAME, sessionId, amount: payoutAmount });

    return {
      sessionId,
      reels,
      outcome: result.outcome,
      multiplier: result.multiplier,
      payoutAmount,
      jackpotWon: false,
      jackpotPending: false,
      bigWinPending: true, // el frontend debe mostrar "en revisión"
      jackpotPool: await getJackpotPool(GAME, cfg.jackpot.floor),
      newBalance: null,
    };
  }

  // 4c. CAMINO NORMAL: se liquida al instante.
  let newBalance;
  if (payoutAmount > 0) {
    newBalance = await ledger.creditPayout({ userId, sessionId, payoutAmount });
  } else {
    newBalance = await ledger.settleAsLoss({ sessionId });
  }

  return {
    sessionId,
    reels,
    outcome: result.outcome,
    multiplier: result.multiplier,
    payoutAmount,
    jackpotWon: false,
    jackpotPending: false,
    bigWinPending: false,
    jackpotPool: await getJackpotPool(GAME, cfg.jackpot.floor),
    newBalance,
  };
}

async function getJackpotInfo() {
  const cfg = await getGameConfig(GAME);
  const pool = await getJackpotPool(GAME, cfg.jackpot.floor);
  return {
    pool,
    potentialWin: Number(Math.max(0, pool - cfg.jackpot.floor).toFixed(2)),
  };
}

module.exports = { spin, getJackpotInfo, GameError };
