// routes/payments.js
//
// Monta este router en tu app.js / index.js principal, por ejemplo:
//   const paymentsRouter = require('./routes/payments');
//   app.use('/api/payments', paymentsRouter);
//
// IMPORTANTE: el webhook necesita el body RAW (sin parsear como JSON todavía)
// para que la verificación de firma funcione. Ver nota en la ruta /webhook.

const express = require("express");
const rateLimit = require("express-rate-limit");
const nowpayments = require("../services/nowpayments");
const pool = require("../db"); // asumiendo que ya tenés un módulo pg Pool exportado como './db'
const authMiddleware = require("../middleware/auth"); // tu middleware de JWT existente
const isAdmin = require("../middleware/isAdmin");

const router = express.Router();

const depositLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // máximo 10 intentos de depósito cada 15 min por IP
});

// ---------- Regex simple de validación de dirección TRC20 ----------
// Direcciones Tron empiezan con "T" y tienen 34 caracteres alfanuméricos.
const TRC20_REGEX = /^T[a-zA-Z0-9]{33}$/;

/**
 * POST /api/payments/wallet
 * Guarda o actualiza la wallet TRC20 del usuario logueado (para recibir retiros).
 */
router.post("/wallet", authMiddleware, async (req, res) => {
  const { walletAddress } = req.body;

  if (!walletAddress || !TRC20_REGEX.test(walletAddress)) {
    return res.status(400).json({ error: "Dirección TRC20 inválida." });
  }

  await pool.query(
    `UPDATE users SET wallet_address = $1, wallet_network = 'TRC20' WHERE id = $2`,
    [walletAddress, req.user.id]
  );

  res.json({ ok: true });
});

/**
 * POST /api/payments/deposit
 * Crea una solicitud de depósito. El usuario indica cuánto quiere cargar en USD;
 * NOWPayments genera la dirección/QR para que pague en la cripto que prefiera.
 */
router.post("/deposit", authMiddleware, depositLimiter, async (req, res) => {
  const { amountUsd } = req.body;

  if (!amountUsd || amountUsd <= 0) {
    return res.status(400).json({ error: "Monto inválido." });
  }

  const orderId = `deposit_${req.user.id}_${Date.now()}`;

  try {
    const payment = await nowpayments.createDeposit({
      priceAmount: amountUsd,
      orderId,
      ipnCallbackUrl: `${process.env.PUBLIC_BACKEND_URL}/api/payments/webhook`,
    });

    // Guardamos el depósito como "pendiente" hasta que llegue el webhook confirmando.
    await pool.query(
      `INSERT INTO deposits (order_id, user_id, amount_usd, payment_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW())`,
      [orderId, req.user.id, amountUsd, payment.payment_id]
    );

    res.json({
      paymentId: payment.payment_id,
      payAddress: payment.pay_address,
      payAmount: payment.pay_amount,
      payCurrency: payment.pay_currency,
    });
  } catch (err) {
    console.error("Error creando depósito NOWPayments:", err.response?.data || err.message);
    res.status(502).json({ error: "No se pudo crear el depósito. Intenta de nuevo." });
  }
});

/**
 * POST /api/payments/webhook
 * NOWPayments llama a esta ruta cuando el estado de un pago cambia.
 * Acá es donde se acredita el saldo en créditos al usuario, una sola vez.
 *
 * NOTA: para que la verificación de firma funcione, esta ruta necesita el
 * body RAW. En tu app.js, antes de app.use(express.json()) global, agregá:
 *
 *   app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
 *
 * y en esta ruta parseás vos mismo con JSON.parse(req.body.toString()).
 */
router.post("/webhook", async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).send("Body inválido");
  }

  const signature = req.headers["x-nowpayments-sig"];
  const isValid = nowpayments.verifyIpnSignature(payload, signature);

  if (!isValid) {
    return res.status(401).send("Firma inválida");
  }

  const { order_id, payment_status, price_amount } = payload;

  // Solo acreditamos cuando el pago está totalmente confirmado.
  if (payment_status === "finished" || payment_status === "confirmed") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `SELECT * FROM deposits WHERE order_id = $1 AND status != 'completed' FOR UPDATE`,
        [order_id]
      );

      if (rows.length > 0) {
        const deposit = rows[0];
        const credits = Math.round(Number(price_amount) * 1000); // $1 = 1000 créditos

        await client.query(
          `UPDATE users SET credits_balance = credits_balance + $1 WHERE id = $2`,
          [credits, deposit.user_id]
        );

        await client.query(
          `UPDATE deposits SET status = 'completed', completed_at = NOW() WHERE order_id = $1`,
          [order_id]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error procesando webhook de depósito:", err);
      return res.status(500).send("Error interno");
    } finally {
      client.release();
    }
  }

  res.status(200).send("OK");
});

/**
 * POST /api/payments/withdraw/request
 * El usuario solicita un retiro. Queda en estado "pending" hasta que
 * el admin lo apruebe manualmente desde el panel (nunca automático).
 */
router.post("/withdraw/request", authMiddleware, async (req, res) => {
  const { amountUsd } = req.body;

  const { rows } = await pool.query(
    `SELECT wallet_address, credits_balance FROM users WHERE id = $1`,
    [req.user.id]
  );
  const user = rows[0];

  if (!user?.wallet_address) {
    return res.status(400).json({ error: "Primero configura tu wallet TRC20 en tu perfil." });
  }

  const creditsNeeded = Math.round(amountUsd * 1000);
  if (creditsNeeded > user.credits_balance) {
    return res.status(400).json({ error: "Saldo insuficiente." });
  }

  await pool.query(
    `INSERT INTO withdrawals (user_id, amount_usd, wallet_address, status, requested_at)
     VALUES ($1, $2, $3, 'pending', NOW())`,
    [req.user.id, amountUsd, user.wallet_address]
  );

  // Se descuenta el saldo al solicitar, para que no lo pueda gastar mientras espera aprobación.
  await pool.query(
    `UPDATE users SET credits_balance = credits_balance - $1 WHERE id = $2`,
    [creditsNeeded, req.user.id]
  );

  res.json({ ok: true, message: "Retiro solicitado. Será revisado por el equipo." });
});

/**
 * POST /api/payments/withdraw/:id/approve
 * SOLO ADMIN. Dispara el payout real en NOWPayments hacia la wallet del usuario.
 * Protegé esta ruta con tu middleware de admin (no incluido acá).
 */
router.post("/withdraw/:id/approve", authMiddleware, isAdmin, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM withdrawals WHERE id = $1`, [req.params.id]);
  const withdrawal = rows[0];

  if (!withdrawal || withdrawal.status !== "pending") {
    return res.status(404).json({ error: "Retiro no encontrado o ya procesado." });
  }

  try {
    const payout = await nowpayments.createPayout({
      address: withdrawal.wallet_address,
      amount: withdrawal.amount_usd,
      withdrawalId: `withdrawal_${withdrawal.id}`,
    });

    await pool.query(
      `UPDATE withdrawals SET status = 'processing', payout_id = $1, approved_at = NOW() WHERE id = $2`,
      [payout.id, withdrawal.id]
    );

    res.json({ ok: true, payout });
  } catch (err) {
    console.error("Error creando payout:", err.response?.data || err.message);
    res.status(502).json({ error: "No se pudo procesar el payout." });
  }
});

/**
 * POST /api/payments/withdraw/:id/reject
 * SOLO ADMIN. Rechaza el retiro y devuelve el saldo al usuario.
 */
router.post("/withdraw/:id/reject", authMiddleware, isAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    const withdrawal = rows[0];

    if (!withdrawal || withdrawal.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Retiro no encontrado o ya procesado." });
    }

    const creditsToRefund = Math.round(Number(withdrawal.amount_usd) * 1000);

    await client.query(
      `UPDATE users SET credits_balance = credits_balance + $1 WHERE id = $2`,
      [creditsToRefund, withdrawal.user_id]
    );
    await client.query(`UPDATE withdrawals SET status = 'rejected' WHERE id = $1`, [req.params.id]);

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error rechazando retiro:", err);
    res.status(500).json({ error: "Error interno." });
  } finally {
    client.release();
  }
});

module.exports = router;
