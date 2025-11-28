// debit_and_runpod.js - checks wallet, debits, and triggers RunPod job
export default {
  async fetch(req, event) {
    const cookie = req.headers.get('cookie') || '';
    const found = cookie.match(/uid=([-\w]+)/);
    if (!found) return new Response('Missing uid', { status: 401 });
    const uid = found[1];

    const cost = 50; // 50 cents
    const row = await event.env.DB.prepare('SELECT balance_cents FROM wallet WHERE uid = ?').bind(uid).first();
    if (!row || row.balance_cents < cost) return new Response('Insufficient funds', { status: 402 });

    // Debit wallet and add ledger
    await event.env.DB.exec(`
      UPDATE wallet SET balance_cents = balance_cents - ${cost} WHERE uid = '${uid}';
    `);
    await event.env.DB.exec(`
      INSERT INTO ledger(uid, change_cents, reason) VALUES ('${uid}', -${cost}, 'debit');
    `);

    // Trigger RunPod job (REST API)
    const rpRes = await fetch('https://api.runpod.io/v2/instances/create', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + event.env.RUNPOD_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { uid } })
    });
    const data = await rpRes.json();
    return new Response(JSON.stringify({ job: data }), { status: 200 });
  }
};
