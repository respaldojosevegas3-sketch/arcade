// backend/routes/payments.js
//
// Ajustado al sistema real: requireAuth deja req.userId (no req.user),
// el saldo vive en users.balance_usdt (dólares reales, no "créditos"
// separados), y las operaciones de saldo van todas por ledger_entries
// para mantener el mismo patrón que ya usa mines.service.js.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool, withTransaction } = require('../src/db/pool');
const { requireAuth } = require('../src/middlewares/auth.middleware');
const { isAdmin } = require('../src/middlewares/isAdmin');
const nowpayments = require('../services/nowpayments');

const router = express.Router();

const depositLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

const TRC20_REGEX = /^T[a-zA-Z0-9]{33}$/;

/**
 * POST /api/payments/wallet
 * Guarda/actualiza la wallet TRC20 del usuario logueado.
 */
router.post('/wallet', requireAuth, async (req, res) => {
  const { walletAddress } = req.body;

  if (!walletAddress || !TRC20_REGEX.test(walletAddress)) {
    return res.status(400).json({ error: 'INVALID_WALLET_ADDRESS' });
  }

  await pool.query(
    `UPDATE users SET wallet_address = $1, wallet_network = 'TRC20' WHERE id = $2`,
    [walletAddress, req.userId]
  );

  res.json({ ok: true });
});

/**
 * POST /api/payments/deposit
 * Crea la solicitud de depósito en NOWPayments (cualquier moneda).
 */
router.post('/deposit', requireAuth, depositLimiter, async (req, res) => {
  const { amountUsd } = req.body;

  if (!amountUsd || amountUsd <= 0) {
    return res.status(400).json({ error: 'INVALID_AMOUNT' });
  }

  const orderId = `deposit_${req.userId}_${Date.now()}`;

  try {
    const payment = await nowpayments.createDeposit({
      priceAmount: amountUsd,
      orderId,
      ipnCallbackUrl: `${process.env.PUBLIC_BACKEND_URL}/api/payments/webhook`,
    });

    await pool.query(
      `INSERT INTO deposits (order_id, user_id, amount_usd, payment_id, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [orderId, req.userId, amountUsd, payment.payment_id]
    );

    res.json({
      paymentId: payment.payment_id,
      payAddress: payment.pay_address,
      payAmount: payment.pay_amount,
      payCurrency: payment.pay_currency,
    });
  } catch (err) {
    console.error('[Payments] Error creando depósito:', err.data || err.message);
    res.status(502).json({ error: 'DEPOSIT_CREATION_FAILED' });
  }
});

/**
 * POST /api/payments/webhook
 * NOWPayments notifica acá los cambios de estado. Acredita balance_usdt
 * directo (sin conversión a créditos: eso es solo visual en el frontend).
 *
 * IMPORTANTE: necesita el body RAW. Ver instrucciones para server.js.
 */
router.post('/webhook', async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).send('Body inválido');
  }

  const signature = req.headers['x-nowpayments-sig'];
  if (!nowpayments.verifyIpnSignature(payload, signature)) {
    return res.status(401).send('Firma inválida');
  }

  const { order_id, payment_status, price_amount } = payload;

  if (payment_status === 'finished' || payment_status === 'confirmed') {
    try {
      await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM deposits WHERE order_id = $1 AND status != 'completed' FOR UPDATE`,
          [order_id]
        );
        if (rows.length === 0) return; // ya procesado o no existe

        const deposit = rows[0];
        const amount = Number(price_amount);

        await client.query(
          `UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2`,
          [amount, deposit.user_id]
        );

        await client.query(
          `UPDATE deposits SET status = 'completed', completed_at = NOW() WHERE order_id = $1`,
          [order_id]
        );

        await client.query(
          `INSERT INTO ledger_entries (user_id, type, amount, ref_id) VALUES ($1, 'deposit', $2, $3)`,
          [deposit.user_id, amount, order_id]
        );
      });
    } catch (err) {
      console.error('[Payments] Error procesando webhook:', err);
      return res.status(500).send('Error interno');
    }
  }

  res.status(200).send('OK');
});

/**
 * POST /api/payments/withdraw/request
 * El usuario pide un retiro. Se descuenta el saldo al pedirlo (para que
 * no se pueda gastar dos veces mientras se revisa). Queda pendiente
 * hasta que un admin lo apruebe manualmente.
 */
router.post('/withdraw/request', requireAuth, async (req, res) => {
  const { amountUsd } = req.body;

  if (!amountUsd || amountUsd <= 0) {
    return res.status(400).json({ error: 'INVALID_AMOUNT' });
  }

  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT wallet_address, balance_usdt FROM users WHERE id = $1 FOR UPDATE`,
        [req.userId]
      );
      const user = rows[0];

      if (!user?.wallet_address) {
        throw Object.assign(new Error('NO_WALLET'), { status: 400 });
      }
      if (Number(user.balance_usdt) < amountUsd) {
        throw Object.assign(new Error('INSUFFICIENT_BALANCE'), { status: 400 });
      }

      await client.query(
        `UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2`,
        [amountUsd, req.userId]
      );

      await client.query(
        `INSERT INTO withdrawals (user_id, amount_usd, wallet_address, status)
         VALUES ($1, $2, $3, 'pending')`,
        [req.userId, amountUsd, user.wallet_address]
      );

      await client.query(
        `INSERT INTO ledger_entries (user_id, type, amount, ref_id) VALUES ($1, 'withdrawal_request', $2, NULL)`,
        [req.userId, amountUsd]
      );
    });

    res.json({ ok: true, message: 'Retiro solicitado. Será revisado por el equipo.' });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('[Payments] Error solicitando retiro:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/payments/withdraw/:id/approve   (solo admin)
 * Dispara el payout real en NOWPayments.
 */
router.post('/withdraw/:id/approve', requireAuth, isAdmin, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM withdrawals WHERE id = $1`, [req.params.id]);
  const withdrawal = rows[0];

  if (!withdrawal || withdrawal.status !== 'pending') {
    return res.status(404).json({ error: 'WITHDRAWAL_NOT_FOUND_OR_PROCESSED' });
  }

  try {
    const payout = await nowpayments.createPayout({
      address: withdrawal.wallet_address,
      amount: Number(withdrawal.amount_usd),
      withdrawalId: `withdrawal_${withdrawal.id}`,
    });

    await pool.query(
      `UPDATE withdrawals SET status = 'processing', payout_id = $1, approved_at = NOW() WHERE id = $2`,
      [payout.id, withdrawal.id]
    );

    res.json({ ok: true, payout });
  } catch (err) {
    console.error('[Payments] Error creando payout:', err.data || err.message);
    res.status(502).json({ error: 'PAYOUT_FAILED' });
  }
});

/**
 * POST /api/payments/withdraw/:id/reject   (solo admin)
 * Rechaza y devuelve el saldo al usuario.
 */
router.post('/withdraw/:id/reject', requireAuth, isAdmin, async (req, res) => {
  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const withdrawal = rows[0];

      if (!withdrawal || withdrawal.status !== 'pending') {
        throw Object.assign(new Error('WITHDRAWAL_NOT_FOUND_OR_PROCESSED'), { status: 404 });
      }

      await client.query(
        `UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2`,
        [withdrawal.amount_usd, withdrawal.user_id]
      );
      await client.query(`UPDATE withdrawals SET status = 'rejected' WHERE id = $1`, [req.params.id]);
      await client.query(
        `INSERT INTO ledger_entries (user_id, type, amount, ref_id) VALUES ($1, 'withdrawal_rejected_refund', $2, $3)`,
        [withdrawal.user_id, withdrawal.amount_usd, req.params.id]
      );
    });

    res.json({ ok: true });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    console.error('[Payments] Error rechazando retiro:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
