// backend/src/games/frutas/frutas.service.js
// Orquesta: config dinámica (Redis) + pozo progresivo (Redis) + ledger
// (PostgreSQL) + engine (RNG puro). Es la ÚNICA capa que el controller
// debe llamar. Mismo patrón que mines.service.js.

const crypto = require('crypto');
const { getGameConfig } = require('../../redis/client');
const { getJackpotPool, addToJackpotPool, resetJackpotPool } = require('../../redis/jackpot');
const ledger = require('../../models/ledger.service');
const engine = require('./frutas.engine');

class GameError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function spin({ userId, betAmount }) {
  const cfg = await getGameConfig('frutas');

  if (cfg.maintenanceMode) {
    throw new GameError('MAINTENANCE_MODE', 'El juego está en mantenimiento.');
  }
  if (betAmount < cfg.minBet || betAmount > cfg.maxBet) {
    throw new GameError('BET_OUT_OF_RANGE', `La apuesta debe estar entre ${cfg.minBet} y ${cfg.maxBet} USDT.`);
  }

  const sessionId = crypto.randomUUID();

  // 1. Débito atómico de la apuesta ANTES de tirar (igual que Mines).
  await ledger.debitForBet({ userId, amount: betAmount, game: 'frutas', sessionId });

  // 2. Aporte al pozo progresivo. Se descuenta de la CASA (margen), no del
  //    jugador de nuevo — el jugador ya pagó su apuesta completa arriba.
  //    Esto es contabilidad interna del pozo, no un segundo cobro.
  const contribution = Number((betAmount * cfg.jackpot.contributionPct).toFixed(6));
  await addToJackpotPool(contribution);

  // 3. Tirada server-side, nunca visible ni influenciable por el cliente.
  const reels = engine.spinReels(cfg.weights);
  const result = engine.evaluateSpin(reels, cfg.paytable);

  let payoutAmount = 0;
  let jackpotWon = false;
  let poolAfter = null;

  if (result.isJackpot) {
    // El jackpot paga el pozo acumulado MENOS el piso de reserva. El piso
    // nunca se toca — es lo que garantiza que siempre haya con qué pagar
    // el próximo pozo desde cero.
    const currentPool = await getJackpotPool(cfg.jackpot.floor);
    payoutAmount = Number(Math.max(0, currentPool - cfg.jackpot.floor).toFixed(6));
    jackpotWon = true;
    poolAfter = await resetJackpotPool(cfg.jackpot.floor);
  } else {
    payoutAmount = Number((betAmount * result.multiplier).toFixed(6));
  }

  // 4. Liquidación en PostgreSQL, atómica, misma función que usa Mines.
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
    jackpotWon,
    jackpotPool: poolAfter ?? (await getJackpotPool(cfg.jackpot.floor)),
    newBalance,
  };
}

async function getJackpotInfo() {
  const cfg = await getGameConfig('frutas');
  const pool = await getJackpotPool(cfg.jackpot.floor);
  return {
    pool,
    potentialWin: Number(Math.max(0, pool - cfg.jackpot.floor).toFixed(2)),
  };
}

module.exports = { spin, getJackpotInfo, GameError };
