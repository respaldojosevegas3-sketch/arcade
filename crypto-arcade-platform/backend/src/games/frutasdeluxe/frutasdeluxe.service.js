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

  // 4a. CAMINO NORMAL: gana o pierde, se liquida al instante, igual que
  //     cualquier otro juego.
  if (!result.isJackpot) {
    const payoutAmount = Number((betAmount * result.multiplier).toFixed(6));
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
      jackpotPool: await getJackpotPool(GAME, cfg.jackpot.floor),
      newBalance,
    };
  }

  // 4b. CAMINO JACKPOT: NO se acredita solo. Queda "abierta" la apuesta
  //     (bet.status sigue 'open') y se crea un reclamo pendiente para
  //     que un admin lo revise y apruebe manualmente antes de pagar. El
  //     pozo YA se resetea acá (no se puede volver a ganar dos veces el
  //     mismo pozo mientras se revisa), pero el dinero no le llega al
  //     jugador hasta la aprobación.
  const currentPool = await getJackpotPool(GAME, cfg.jackpot.floor);
  const claimedAmount = Number(Math.max(0, currentPool - cfg.jackpot.floor).toFixed(6));
  const poolAfter = await resetJackpotPool(GAME, cfg.jackpot.floor);

  await jackpotClaims.createClaim({
    userId,
    game: GAME,
    sessionId,
    amount: claimedAmount,
  });

  return {
    sessionId,
    reels,
    outcome: 'jackpot',
    multiplier: 0,
    payoutAmount: claimedAmount,
    jackpotWon: true,
    jackpotPending: true, // el frontend debe mostrar "en revisión", no "acreditado"
    jackpotPool: poolAfter,
    newBalance: null, // el saldo todavía NO cambió — se acredita cuando el admin aprueba
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
