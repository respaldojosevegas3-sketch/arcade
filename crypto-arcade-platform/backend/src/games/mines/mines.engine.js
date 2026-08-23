// backend/src/games/mines/mines.engine.js
// Lógica PURA del juego (sin I/O). Fácil de testear unitariamente.
// Principio de seguridad #1: la posición de las minas se genera y guarda
// SOLO en el servidor (Redis session). Jamás se serializa hacia el cliente.

const crypto = require('crypto');

/**
 * Genera N posiciones de minas únicas dentro de una grilla de `gridSize`
 * casillas (0..gridSize-1), usando el CSPRNG de Node (crypto.randomInt),
 * no Math.random(). Esto es indispensable: Math.random() no es apto para
 * lógica de apuestas porque su semilla es predecible/reproducible.
 */
function generateMinePositions(gridSize, mineCount) {
  const positions = new Set();
  while (positions.size < mineCount) {
    positions.add(crypto.randomInt(0, gridSize));
  }
  return positions;
}

/**
 * (Opcional recomendado) Provably Fair: genera un hash del resultado
 * ANTES de que el usuario juegue (server seed hasheado), y revela el
 * seed real al finalizar la partida para que el usuario pueda verificar
 * que las minas no fueron manipuladas a mitad de juego.
 */
function buildServerSeed() {
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const serverSeedHash = crypto
    .createHash('sha256')
    .update(serverSeed)
    .digest('hex');
  return { serverSeed, serverSeedHash };
}

/**
 * Multiplicador justo (fair, house edge = 0) para haber revelado `picks`
 * casillas seguras de forma consecutiva, en una grilla de `gridSize`
 * casillas con `mineCount` minas.
 *
 * fairMultiplier = C(gridSize, picks) / C(gridSize - mineCount, picks)
 *
 * Se calcula iterativamente para evitar overflow con factoriales grandes:
 *   mult = Π_{i=0}^{picks-1} (gridSize - i) / (gridSize - mineCount - i)
 */
function fairMultiplier(gridSize, mineCount, picks) {
  if (picks <= 0) return 1;
  let mult = 1;
  for (let i = 0; i < picks; i++) {
    mult *= (gridSize - i) / (gridSize - mineCount - i);
  }
  return mult;
}

/**
 * Multiplicador REAL pagado al jugador = fairMultiplier * (1 - houseEdge).
 * Este es el número que determina el margen matemático del casino y es
 * el parámetro editable desde el Backoffice.
 */
function payoutMultiplier(gridSize, mineCount, picks, houseEdge) {
  const fair = fairMultiplier(gridSize, mineCount, picks);
  return fair * (1 - houseEdge);
}

module.exports = {
  generateMinePositions,
  buildServerSeed,
  fairMultiplier,
  payoutMultiplier,
};
