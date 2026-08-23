// backend/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./src/config');
const routes = require('./src/routes');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limit básico anti-abuso en endpoints de juego (ajustar en prod).
const gameLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 20, // 20 requests / 10s por IP
});
app.use('/api/games', gameLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', routes);

// Manejador de errores no capturados (última barrera).
app.use((err, req, res, next) => {
  console.error('[Unhandled]', err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

app.listen(config.port, () => {
  console.log(`🎮 Arcade backend escuchando en puerto ${config.port} (${config.env})`);
});
