# Arcade Platform — Arquitectura Base + MVP Mines

## 1. Estructura de carpetas

```
crypto-arcade-platform/
├── backend/
│   ├── server.js                     # entrypoint Express
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── config/index.js           # config estática + defaults operativos
│       ├── db/pool.js                # PostgreSQL (saldo, transacciones atómicas)
│       ├── redis/client.js           # Redis (config dinámica del Backoffice + estado efímero)
│       ├── middlewares/
│       │   └── auth.middleware.js    # JWT — userId nunca viene del body
│       ├── models/
│       │   ├── gameSession.store.js  # estado de partida en curso (Redis)
│       │   └── ledger.service.js     # débito/crédito atómico (PostgreSQL)
│       ├── games/
│       │   └── mines/
│       │       ├── mines.engine.js      # RNG + fórmula de multiplicador (lógica pura)
│       │       ├── mines.service.js     # orquestación start/reveal/cashout
│       │       ├── mines.controller.js  # capa HTTP
│       │       └── mines.routes.js
│       │   # crash/, dice/, plinko/, slot/ se agregan con la MISMA estructura
│       └── routes/index.js           # router raíz, agrega cada módulo de juego
├── frontend/
│   └── mines/
│       ├── index.html
│       ├── style.css                 # mobile-first
│       └── game.js                   # solo consume la API, sin lógica de negocio
└── docs/
    └── schema.sql                    # esquema mínimo PostgreSQL
```

**Principio de modularidad:** cada juego nuevo (Crash, Dice, Plinko, Slot) se agrega como
una carpeta hermana dentro de `backend/src/games/<juego>/` con el mismo patrón
`engine.js` (lógica pura) → `service.js` (orquestación) → `controller.js` (HTTP) →
`routes.js`. Esto permite testear el engine de cada juego de forma aislada y
mantener el código de negocio separado del transporte (HTTP/WebSocket).

## 2. Por qué esta separación de datos

- **PostgreSQL** = única fuente de verdad para saldo real. Todo débito/crédito
  pasa por una transacción SQL (`withTransaction`) para evitar condiciones de
  carrera (doble cobro, doble pago).
- **Redis** = dos usos distintos y separados por namespace de key:
  - `config:games:<juego>` → parámetros editables desde el Backoffice en
    caliente (house edge, límites de apuesta, mantenimiento) sin redeploy.
  - `mines:session:<id>` → estado efímero de la partida en curso (incluye
    la posición real de las minas). Tiene TTL de 30 min y nunca se persiste
    en PostgreSQL — solo el resultado final (bet/payout) queda en el ledger.

## 3. Seguridad del juego Mines (por qué no se puede hacer trampa)

1. Las minas se generan con `crypto.randomInt` (CSPRNG), nunca `Math.random()`.
2. Las posiciones de minas se guardan **solo** en Redis, lado servidor. El
   payload que recibe el cliente en `/start` no incluye `minePositions`.
3. Cada `/reveal` valida server-side: sesión pertenece al usuario del JWT,
   partida sigue activa, casilla no fue revelada antes.
4. El multiplicador se calcula **siempre** en el backend
   (`fairMultiplier * (1 - houseEdge)`) — el frontend solo muestra el número
   que el servidor le manda, nunca lo calcula.
5. Provably fair: se genera un `serverSeedHash` (SHA-256) antes de jugar y se
   revela el `serverSeed` real al cerrar la partida, para que el usuario
   pueda verificar que el resultado no fue alterado a mitad de juego.
6. El tablero completo (`minePositions`) solo se revela al cliente cuando la
   partida termina (mina tocada o cashout), nunca antes.

## 4. Próximos pasos sugeridos (orden recomendado)

1. **Auth real**: registro/login, hash de password (argon2/bcrypt), emisión JWT.
2. **Backoffice** (Next.js/Vue admin aparte, mismo backend, rutas `/admin/*`
   protegidas por rol): CRUD sobre `config:games:*` en Redis, gestión de
   billeteras activas, modo mantenimiento, límites de riesgo por usuario.
3. **Módulo Wallet USDT**:
   - Generación de direcciones de depósito por usuario (BEP-20 vía BSC RPC /
     TRC-20 vía TronGrid), una dirección derivada por usuario (HD wallet) para
     poder identificar el depósito sin depender de memos.
   - Servicio worker que escucha bloques nuevos (o Webhooks del nodo/proveedor)
     y acredita el saldo tras N confirmaciones.
   - Cola de retiros (manual con aprobación admin, o automática con límites y
     firma de transacción server-side, idealmente con un HSM o multisig).
4. **Crash**: requiere WebSocket real (Socket.IO) porque el multiplicador
   sube en tiempo real y muchos jugadores comparten la misma ronda —
   arquitectura pub/sub con Redis para sincronizar múltiples instancias Node.
5. **Dice / Plinko / Slot 3x3**: mismo patrón que Mines (apuesta única,
   resultado inmediato), reutilizando `ledger.service.js` y el patrón de
   `engine → service → controller → routes`.
6. **Tests**: unit tests sobre cada `*.engine.js` (matemática pura, fácil de
   verificar RTP/house edge) + tests de integración sobre los endpoints con
   una base de datos de test.

## 5. Cómo correr el MVP de Mines localmente

```bash
cd backend
cp .env.example .env
npm install
# requiere PostgreSQL corriendo con docs/schema.sql aplicado
# y Redis corriendo en localhost:6379
npm run dev
```

Luego abre `frontend/mines/index.html` en el navegador (ajusta `API_BASE`
en `game.js` si el backend corre en otro host/puerto). En producción, generar
un JWT real desde el flujo de login en lugar del `DEV_TOKEN_PLACEHOLDER`.
