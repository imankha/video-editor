// topup.js - create stripe checkout session and set cookie uid
export default {
  async fetch(req, event) {
    const uid = getOrCreateUid(req);
    const amountCents = 500; // $5 top-up

    // Create Stripe Checkout Session via REST API call
    // (Use environment secret STRIPE_SECRET and fetch to create session)
    const stripeSecret = event.env.STRIPE_SECRET;
    const createRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + stripeSecret,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        payment_method_types: 'card',
        mode: 'payment',
        success_url: event.env.SUCCESS_URL,
        cancel_url: event.env.CANCEL_URL,
        'payment_intent_data[metadata][uid]': uid,
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': 'Credit Top-up',
        'line_items[0][price_data][unit_amount]': String(amountCents),
        'line_items[0][quantity]': '1'
      })
    });
    const created = await createRes.json();
    const sessionUrl = created.url || created.redirect_url || created.id ? (`https://checkout.stripe.com/pay/${created.id}`) : null;

    const res = Response.redirect(sessionUrl || event.env.CANCEL_URL, 302);
    res.headers.set('Set-Cookie', `uid=${uid}; HttpOnly; Path=/; Secure; SameSite=Strict`);
    return res;
  }
};

function getOrCreateUid(req) {
  const cookie = req.headers.get('cookie') || '';
  const found = cookie.match(/uid=([-\w]+)/);
  if (found) return found[1];
  return crypto.randomUUID();
}
