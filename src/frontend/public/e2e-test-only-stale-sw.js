// T6630 round 4 -- E2E TEST FIXTURE ONLY. Not loaded by any app code path;
// referenced only by e2e/T6630-round4-evidence.qa.spec.js's SW1/SW2 hygiene
// tests, which register it to simulate a controlling service worker left
// over from a past `vite build && vite preview` session and assert that
// evictStaleDevServiceWorker() (src/utils/pwaUpdate.js) unregisters it.
// Playwright's page.route() cannot intercept a service worker's OWN
// registration fetch (Chromium routes it outside CDP's Fetch domain), so
// this has to be a real static file with a real JS MIME type rather than a
// mocked response.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('r2.cloudflarestorage.com')) {
    event.respondWith(Promise.reject(new TypeError('Failed to fetch (simulated stale SW)')));
  }
});
