// Entry worker routes incoming requests and dispatches to modules.

import topup from './topup.js';
import webhook from './webhook.js';
import debit from './debit_and_runpod.js';

addEventListener('fetch', event => {
  event.respondWith(router(event.request, event));
});

async function router(req, event) {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/topup')) {
    return topup.fetch(req, event);
  } else if (url.pathname.startsWith('/webhook')) {
    return webhook.fetch(req, event);
  } else if (url.pathname.startsWith('/debit')) {
    return debit.fetch(req, event);
  } else {
    return new Response('Not found', { status: 404 });
  }
}
