// backend/services/nowpayments.js
//
// Envoltorio sobre la API de NOWPayments. Usa fetch nativo (Node 18+),
// así no hace falta agregar axios como dependencia nueva.
//
// Variables de entorno requeridas (ya están en Railway):
//   NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET,
//   NOWPAYMENTS_BASE_URL, PAYOUT_CURRENCY, PUBLIC_BACKEND_URL

const crypto = require('crypto');

const BASE_URL = process.env.NOWPAYMENTS_BASE_URL || 'https://api.nowpayments.io/v1';
const API_KEY = process.env.NOWPAYMENTS_API_KEY;

async function callApi(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data.message || `NOWPayments error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * Crea un pago de depósito. No fijamos pay_currency a propósito:
 * así NOWPayments deja que el usuario elija con qué cripto paga.
 */
async function createDeposit({ priceAmount, orderId, ipnCallbackUrl }) {
  return callApi('/payment', {
    method: 'POST',
    body: JSON.stringify({
      price_amount: priceAmount,
      price_currency: 'usd',
      order_id: orderId,
      ipn_callback_url: ipnCallbackUrl,
    }),
  });
}

async function getPaymentStatus(paymentId) {
  return callApi(`/payment/${paymentId}`);
}

/**
 * Crea un payout real hacia la wallet TRC20 del usuario.
 * Se dispara SOLO cuando el admin aprueba el retiro manualmente.
 */
async function createPayout({ address, amount, withdrawalId }) {
  return callApi('/payout', {
    method: 'POST',
    body: JSON.stringify({
      ipn_callback_url: process.env.PAYOUT_IPN_CALLBACK_URL || undefined,
      withdrawals: [
        {
          address,
          currency: process.env.PAYOUT_CURRENCY || 'usdttrc20',
          amount,
          unique_external_id: withdrawalId,
        },
      ],
    }),
  });
}

/**
 * Verifica que un webhook (IPN) venga realmente de NOWPayments.
 */
function verifyIpnSignature(rawBody, signatureHeader) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret || !signatureHeader) return false;

  const sortedBody = JSON.stringify(sortObjectKeys(rawBody));
  const hmac = crypto.createHmac('sha512', secret).update(sortedBody).digest('hex');

  return hmac === signatureHeader;
}

function sortObjectKeys(obj) {
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortObjectKeys(obj[key]);
        return acc;
      }, {});
  }
  return obj;
}

module.exports = { createDeposit, getPaymentStatus, createPayout, verifyIpnSignature };
