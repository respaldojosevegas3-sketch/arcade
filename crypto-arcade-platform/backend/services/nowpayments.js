// services/nowpayments.js
//
// Envoltorio (wrapper) sobre la API de NOWPayments.
// Requiere las siguientes variables de entorno en Railway:
//
//   NOWPAYMENTS_API_KEY       -> tu API key del dashboard de NOWPayments
//   NOWPAYMENTS_IPN_SECRET    -> secreto IPN (Configuración > Herramientas de pago > IPN)
//   NOWPAYMENTS_BASE_URL      -> https://api.nowpayments.io/v1  (producción)
//                                https://api-sandbox.nowpayments.io/v1 (sandbox, para probar)
//   PAYOUT_CURRENCY           -> usdttrc20  (moneda fija de retiro: USDT sobre TRC20)
//
// Instalar dependencia si no está: npm install axios

const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = process.env.NOWPAYMENTS_BASE_URL || "https://api.nowpayments.io/v1";
const API_KEY = process.env.NOWPAYMENTS_API_KEY;

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    "x-api-key": API_KEY,
    "Content-Type": "application/json",
  },
  timeout: 15000,
});

/**
 * Crea un pago (depósito) para que el usuario mande cripto en la moneda que quiera.
 * NOWPayments se encarga de la conversión a tu moneda de liquidación (payCurrency destino).
 *
 * @param {Object} params
 * @param {number} params.priceAmount - Monto en USD que el usuario quiere cargar.
 * @param {string} params.orderId - ID único interno (ej. `deposit_<userId>_<timestamp>`).
 * @param {string} params.ipnCallbackUrl - URL pública de tu webhook, ej. https://tu-backend/api/payments/webhook
 */
async function createDeposit({ priceAmount, orderId, ipnCallbackUrl }) {
  const { data } = await client.post("/payment", {
    price_amount: priceAmount,
    price_currency: "usd",
    // pay_currency se omite a propósito: así NOWPayments deja que el usuario elija
    // con qué moneda quiere pagar en la pantalla de pago que él genera.
    order_id: orderId,
    ipn_callback_url: ipnCallbackUrl,
  });
  return data; // incluye payment_id, pay_address, pay_amount, pay_currency, etc.
}

/**
 * Consulta el estado actual de un pago por su payment_id.
 */
async function getPaymentStatus(paymentId) {
  const { data } = await client.get(`/payment/${paymentId}`);
  return data;
}

/**
 * Crea un payout (retiro) real hacia la wallet TRC20 del usuario.
 * OJO: en tu flujo esto se dispara solo cuando el admin aprueba manualmente
 * el retiro desde el panel — nunca automático por ahora.
 *
 * @param {Object} params
 * @param {string} params.address - Dirección TRC20 del usuario (ya validada).
 * @param {number} params.amount - Monto en USDT a enviar.
 * @param {string} params.withdrawalId - ID único interno del retiro (para trazabilidad).
 */
async function createPayout({ address, amount, withdrawalId }) {
  const { data } = await client.post("/payout", {
    ipn_callback_url: process.env.PAYOUT_IPN_CALLBACK_URL,
    withdrawals: [
      {
        address,
        currency: process.env.PAYOUT_CURRENCY || "usdttrc20",
        amount,
        unique_external_id: withdrawalId,
      },
    ],
  });
  return data;
}

/**
 * Verifica que un webhook (IPN) realmente venga de NOWPayments,
 * usando el header `x-nowpayments-sig` y el NOWPAYMENTS_IPN_SECRET.
 * El body debe pasarse tal cual llegó (sin reordenar), como string u objeto.
 */
function verifyIpnSignature(rawBody, signatureHeader) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !signatureHeader) return false;

  // NOWPayments firma el JSON con las claves ordenadas alfabéticamente.
  const sortedBody = JSON.stringify(sortObjectKeys(rawBody));
  const hmac = crypto.createHmac("sha512", secret).update(sortedBody).digest("hex");

  return hmac === signatureHeader;
}

function sortObjectKeys(obj) {
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortObjectKeys(obj[key]);
        return acc;
      }, {});
  }
  return obj;
}

module.exports = {
  createDeposit,
  getPaymentStatus,
  createPayout,
  verifyIpnSignature,
};
