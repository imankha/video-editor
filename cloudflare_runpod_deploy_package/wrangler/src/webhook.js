// webhook.js - stripe webhook handler that credits D1 wallet
export default {
  async fetch(req, event) {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    // Validate signature using Stripe library or manual HMAC with STRIPE_WEBHOOK_SECRET
    // For simplicity this example assumes the event JSON is posted directly (test only)

    let eventObj;
    try {
      eventObj = JSON.parse(body);
    } catch (e) {
      return new Response('invalid event', { status: 400 });
    }

    if (eventObj.type === 'checkout.session.completed') {
      const uid = eventObj.data.object.metadata.uid;
      const amount = eventObj.data.object.amount_total;

      await event.env.DB.exec(`
        INSERT INTO wallet(uid, balance_cents) VALUES ('${uid}', ${amount})
        ON CONFLICT(uid) DO UPDATE SET balance_cents = wallet.balance_cents + ${amount}
      `);
      await event.env.DB.exec(`
        INSERT INTO ledger(uid, change_cents, reason) VALUES ('${uid}', ${amount}, 'topup')
      `);
    }

    return new Response('ok', { status: 200 });
  }
};
