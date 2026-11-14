import { test, expect } from '@playwright/test';
import { deletedReelLeavesNoHighlight, TEST_SEAM_PREFIX } from '../helpers/deletedReelFlow';

/**
 * T16100:C1 - T16090:C3's check creates its published highlight without any dev-only test
 * route and passes on the target (dev stack here, staging after merge). Runs the same flow
 * T16090.check.spec.js runs, and records every request the browser context sends so a
 * setup step that reached for a test route fails here even on a dev stack, where those
 * routes answer.
 */
test.setTimeout(1200000);

test('T16100:C1 the T16090:C3 flow publishes its highlight through the app and passes', async ({ context, page }) => {
  const seamCalls = [];
  const record = (method, url) => {
    if (new URL(url, 'http://relative.invalid').pathname.startsWith(TEST_SEAM_PREFIX)) seamCalls.push(`${method} ${url}`);
  };
  // Requests from the app's pages ...
  context.on('request', (req) => record(req.method(), req.url()));
  // ... and from the spec's own API context (page.request is context.request), which
  // does not emit context 'request' events.
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch']) {
    const original = context.request[method].bind(context.request);
    context.request[method] = (url, ...rest) => {
      record(method === 'fetch' ? (rest[0]?.method || 'GET') : method.toUpperCase(), typeof url === 'string' ? url : url.url());
      return original(url, ...rest);
    };
  }

  try {
    await deletedReelLeavesNoHighlight(context, page);
  } finally {
    // Reported even when a later step fails, so a seam call is named as the cause.
    expect.soft(seamCalls, 'requests to dev-only test routes').toEqual([]);
  }
});
