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
    host: process.env.PG_HOST || 'localhost',
    port: process.env.PG_PORT || 5432,
    user: process.env.PG_USER || 'arcade_user',
    password: process.env.PG_PASSWORD || 'change_me',
    database: process.env.PG_DATABASE || 'arcade_platform',
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
  },
};
