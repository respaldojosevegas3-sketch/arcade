// backend/src/config/index.js
// Configuración centralizada. En producción, estos valores de "operación"
// (house edge, límites, etc.) deben venir de Redis / DB y ser editables
// desde el Backoffice en caliente, NO hardcodeados aquí.
// Este archivo solo define defaults de arranque + config de infraestructura.

require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 4000,

  db: {
    // Si DATABASE_URL está presente (ej. la connection string que da
    // Supabase en "Connect" > Transaction pooler), se usa esa directamente
    // y se ignoran los campos PG_* sueltos. Esto evita tener que desarmar
    // el string a mano en host/puerto/usuario.
    connectionString: process.env.DATABASE_URL || null,
    host: process.env.PG_HOST || 'localhost',
    port: process.env.PG_PORT || 5432,
    user: process.env.PG_USER || 'arcade_user',
    password: process.env.PG_PASSWORD || 'change_me',
    database: process.env.PG_DATABASE || 'arcade_platform',
    // Supabase (y la mayoría de proveedores cloud de Postgres) requieren
    // SSL. Se activa automáticamente si hay DATABASE_URL.
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'CHANGE_THIS_IN_PROD',
    expiresIn: '2h',
  },

  // Defaults operativos de fábrica. El Backoffice sobreescribe estos valores
  // en Redis bajo la key `config:games:mines`. El servicio siempre lee de
  // Redis primero y cae a estos defaults solo si Redis no responde.
  games: {
    mines: {
      gridSize: 25, // 5x5
      minMines: 1,
      maxMines: 24,
      houseEdge: 0.03, // 3% de margen matemático
      minBet: 1, // en USDT
      maxBet: 500, // en USDT
      maintenanceMode: false,
    },

    // Frutas: tragamonedas de 3 carretes. Todo esto es editable en caliente
    // desde el Backoffice (vía config:games:frutas en Redis), igual que
    // Mines. El pozo del jackpot NO vive acá: vive aparte, en
    // jackpot:frutas:pool (ver src/redis/jackpot.js), porque es un
    // contador que crece solo, no un parámetro que se setea a mano.
    frutas: {
      minBet: 0.15, // 150 créditos a $0.001 = $0.15
      maxBet: 50,
      maintenanceMode: false,

      // Probabilidad de cada símbolo por carrete (deben sumar 1). El 1%
      // de SEVEN da una probabilidad de jackpot de 0.01^3 = 1 en 1,000,000,
      // tal como se definió.
      weights: {
        LEMON: 0.40,
        CHERRY: 0.28,
        BELL: 0.16,
        GEM: 0.09,
        STAR: 0.06,
        SEVEN: 0.01,
      },

      // Multiplicadores sobre la apuesta. "pair" = 2 iguales consecutivos
      // desde la izquierda, "triple" = 3 iguales (o comodín completando).
      // SEVEN no tiene multiplicador fijo: su triple dispara el jackpot.
      paytable: {
        LEMON: { pair: 1, triple: 2 },
        CHERRY: { pair: 1.5, triple: 3 },
        BELL: { pair: 3, triple: 6 },
        GEM: { pair: 7, triple: 15 },
        STAR: { triple: 30 },
      },

      jackpot: {
        contributionPct: 0.02, // 2% de cada apuesta va al pozo
        floor: 50, // piso en USDT: nunca se paga, queda sembrado para el próximo pozo
      },
    },
  },
};
