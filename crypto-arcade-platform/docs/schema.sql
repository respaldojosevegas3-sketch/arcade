-- docs/schema.sql
-- Esquema mínimo transaccional. Ampliar con tablas de depósitos/retiros
-- cripto (direcciones BEP-20/TRC-20, tx hashes, confirmaciones) en el
-- módulo wallet cuando se implemente esa fase.

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    balance_usdt    NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (balance_usdt >= 0),
    risk_limit_usdt NUMERIC(18,6), -- límite de pérdida diaria, editable en backoffice
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bets (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id),
    game        VARCHAR(50) NOT NULL,          -- 'mines', 'crash', 'dice', ...
    session_id  UUID NOT NULL UNIQUE,
    amount      NUMERIC(18,6) NOT NULL,
    payout      NUMERIC(18,6),
    status      VARCHAR(20) NOT NULL DEFAULT 'open', -- open | closed | lost
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at   TIMESTAMPTZ
);

CREATE TABLE ledger_entries (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id),
    type        VARCHAR(30) NOT NULL,  -- bet_debit | payout_credit | deposit | withdrawal
    amount      NUMERIC(18,6) NOT NULL,
    ref_id      TEXT,                  -- session_id, tx_hash, etc.
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para consultas frecuentes del backoffice / historial de usuario.
CREATE INDEX idx_bets_user_id ON bets(user_id);
CREATE INDEX idx_bets_game ON bets(game);
CREATE INDEX idx_ledger_user_id ON ledger_entries(user_id);
