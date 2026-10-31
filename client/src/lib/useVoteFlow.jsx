import { useState } from 'react';
import { api, unwrap, errMsg, errCode } from './api';
import { loadRazorpay } from './hooks';

/**
 * Drives the free and paid voting flows. The browser sends category + celebrity ids and the amount the voter chose;
 * the server validates that amount (whole rupees 0..7, custom amounts allowed or not) and decides campaign and eligibility. A Razorpay "success" callback
 * is never trusted by itself - it is sent to /payments/verify which re-checks with the gateway.
 */
export function useVoteFlow() {
  const [state, setState] = useState({ step: 'idle', error: null, receipt: null });

  const reset = () => setState({ step: 'idle', error: null, receipt: null });
  const fail = (e, fallback) => setState({ step: 'error', error: { message: errMsg(e, fallback), code: errCode(e) }, receipt: null });

  async function pollPayment(paymentId, tries = 12) {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const { payment } = await unwrap(api.get(`/payments/${paymentId}`));
      if (payment.receiptId) return payment;
      if (['failed', 'cancelled', 'expired', 'requires_reconciliation', 'refunded', 'refund_pending'].includes(payment.status)) return payment;
    }
    return null;
  }

  async function submit({ categoryId, celebrityId, amountInr }) {
    const free = amountInr === 0;
    setState({ step: 'processing', error: null, receipt: null });
    try {
      if (free) {
        const key = crypto.randomUUID?.() || String(Date.now());
        const d = await unwrap(api.post('/votes', { categoryId, celebrityId, amountInr }, { headers: { 'Idempotency-Key': key } }));
        return setState({ step: 'done', error: null, receipt: d.receipt });
      }
      if (!(await loadRazorpay())) throw Object.assign(new Error('Could not load the payment window. Check your connection.'), { isLocal: true });
      const order = await unwrap(api.post('/payments/order', { categoryId, celebrityId, amountInr }));
      await new Promise((resolve) => {
        const rz = new window.Razorpay({
          key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency,
          name: 'FameVote', description: `Vote for ${order.celebrityName}`, prefill: order.prefill, theme: { color: '#566F12' },
          modal: {
            ondismiss: async () => { await api.post(`/payments/${order.paymentId}/cancel`).catch(() => {}); setState({ step: 'cancelled', error: null, receipt: null }); resolve(); },
          },
          handler: async (resp) => {
            setState({ step: 'verifying', error: null, receipt: null });
            try {
              const d = await unwrap(api.post('/payments/verify', resp));
              if (d.status === 'paid' && d.receipt) setState({ step: 'done', error: null, receipt: d.receipt });
              else if (d.status === 'pending') {
                const p = await pollPayment(order.paymentId);
                if (p?.receiptId) { const r = await unwrap(api.get(`/receipts/${p.receiptId}`)); setState({ step: 'done', error: null, receipt: r.receipt }); }
                else setState({ step: 'pending', error: null, receipt: null });
              } else setState({ step: 'refund', error: { message: 'Your payment could not be turned into a vote' + (d.reason === 'paid_after_campaign_close' ? ' because voting had just closed' : '') + '. It will be refunded automatically.' }, receipt: null });
            } catch (e) { fail(e, 'We could not confirm your payment yet. Check your dashboard in a minute.'); }
            resolve();
          },
        });
        rz.on('payment.failed', (r) => { setState({ step: 'error', error: { message: r?.error?.description || 'Payment failed. You have not been charged for a vote.' }, receipt: null }); resolve(); });
        rz.open();
      });
    } catch (e) { fail(e); }
    return undefined;
  }

  return { ...state, submit, reset };
}
