// backend/src/games/mines/mines.service.js
// Orquesta: config dinámica (Redis) + ledger (PostgreSQL) + engine (RNG puro)
// + sesión de partida (Redis). Es la ÚNICA capa que el controller debe llamar.

const crypto = require('crypto');
const { getGameConfig } = require('../../redis/client');
const sessionStore = require('../../models/gameSession.store');
const ledger = require('../../models/ledger.service');
const engine = require('./mines.engine');

class GameError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function startGame({ userId, betAmount, mineCount }) {
  const cfg = await getGameConfig('mines');

  if (cfg.maintenanceMode) {
    throw new GameError('MAINTENANCE_MODE', 'El juego está en mantenimiento.');
  }
  if (betAmount < cfg.minBet || betAmount > cfg.maxBet) {
    throw new GameError('BET_OUT_OF_RANGE', `La apuesta debe estar entre ${cfg.minBet} y ${cfg.maxBet} USDT.`);
  }
  if (mineCount < cfg.minMines || mineCount > cfg.maxMines) {
    throw new GameError('INVALID_MINE_COUNT', `Cantidad de minas inválida (${cfg.minMines}-${cfg.maxMines}).`);
  }

  const sessionId = crypto.randomUUID();

  // 1. Débito atómico del saldo ANTES de generar el tablero.
  await ledger.debitForBet({ userId, amount: betAmount, game: 'mines', sessionId });

  // 2. Generación server-side de minas + seed provably-fair.
  const minePositions = engine.generateMinePositions(cfg.gridSize, mineCount);
  const { serverSeed, serverSeedHash } = engine.buildServerSeed();

  // 3. Estado completo (incluye minas) SOLO en Redis, del lado servidor.
  const session = {
    sessionId,
    userId,
    betAmount,
    mineCount,
    gridSize: cfg.gridSize,
    houseEdge: cfg.houseEdge,
    minePositions: Array.from(minePositions), // se serializa en Redis, no al cliente
    revealedTiles: [],
    status: 'active', // active | busted | cashed_out
    serverSeed,
    serverSeedHash,
    createdAt: Date.now(),
  };

  await sessionStore.createSession(sessionId, session);

  // Respuesta pública: SIN minePositions ni serverSeed (se revela al cerrar).
  return {
    sessionId,
    gridSize: cfg.gridSize,
    mineCount,
    betAmount,
    serverSeedHash, // el usuario puede verificar después que no cambió
    currentMultiplier: 1,
  };
}

async function revealTile({ userId, sessionId, tileIndex }) {
  const session = await sessionStore.getSession(sessionId);

  if (!session) throw new GameError('SESSION_NOT_FOUND', 'Partida no encontrada o expirada.');
  if (session.userId !== userId) throw new GameError('FORBIDDEN', 'Esta partida no pertenece al usuario.');
  if (session.status !== 'active') throw new GameError('GAME_ALREADY_ENDED', 'La partida ya finalizó.');
  if (tileIndex < 0 || tileIndex >= session.gridSize) throw new GameError('INVALID_TILE', 'Casilla fuera de rango.');
  if (session.revealedTiles.includes(tileIndex)) throw new GameError('TILE_ALREADY_REVEALED', 'Casilla ya revelada.');

  const isMine = session.minePositions.includes(tileIndex);

  if (isMine) {
    session.status = 'busted';
    session.revealedTiles.push(tileIndex);
    await sessionStore.updateSession(sessionId, session);
    await ledger.settleAsLoss({ sessionId });

    return {
      result: 'mine',
      tileIndex,
      // Al perder, SÍ se revela el tablero completo + seed, para
      // transparencia/provably-fair. Antes de esto, nunca.
      minePositions: session.minePositions,
      serverSeed: session.serverSeed,
      multiplier: 0,
      payout: 0,
    };
  }

  session.revealedTiles.push(tileIndex);
  const picks = session.revealedTiles.length;
  const multiplier = engine.payoutMultiplier(
    session.gridSize,
    session.mineCount,
    picks,
    session.houseEdge
  );

  // Si ya no quedan casillas seguras por revelar, se fuerza auto-cashout.
  const safeTilesTotal = session.gridSize - session.mineCount;
  const boardCleared = picks === safeTilesTotal;

  await sessionStore.updateSession(sessionId, session);

  if (boardCleared) {
    return finalizeCashout(session, multiplier);
  }

  return {
    result: 'safe',
    tileIndex,
    revealedCount: picks,
    currentMultiplier: Number(multiplier.toFixed(4)),
  };
}

async function cashout({ userId, sessionId }) {
  const session = await sessionStore.getSession(sessionId);

  if (!session) throw new GameError('SESSION_NOT_FOUND', 'Partida no encontrada o expirada.');
  if (session.userId !== userId) throw new GameError('FORBIDDEN', 'Esta partida no pertenece al usuario.');
  if (session.status !== 'active') throw new GameError('GAME_ALREADY_ENDED', 'La partida ya finalizó.');
  if (session.revealedTiles.length === 0) {
    throw new GameError('NOTHING_TO_CASHOUT', 'Debes revelar al menos una casilla antes de retirar.');
  }

  const multiplier = engine.payoutMultiplier(
    session.gridSize,
    session.mineCount,
    session.revealedTiles.length,
    session.houseEdge
  );

  return finalizeCashout(session, multiplier);
}

async function finalizeCashout(session, multiplier) {
  session.status = 'cashed_out';
  await sessionStore.updateSession(session.sessionId, session);

  const payoutAmount = Number((session.betAmount * multiplier).toFixed(6));
  const newBalance = await ledger.creditPayout({
    userId: session.userId,
    sessionId: session.sessionId,
    payoutAmount,
  });

  return {
    result: 'cashed_out',
    multiplier: Number(multiplier.toFixed(4)),
    payoutAmount,
    newBalance,
    minePositions: session.minePositions, // transparencia post-partida
    serverSeed: session.serverSeed,
  };
}

module.exports = { startGame, revealTile, cashout, GameError };
