// Recovery endpoint for clients whose bundle was built without VITE_API_BASE.
// Those clients request /api/version from the Pages origin; returning the
// production API response here lets the normal PWA update gate move them onto
// the corrected bundle instead of serving index.html from the SPA fallback.

const API_BY_HOST = {
  'app.reelballers.com': 'https://reel-ballers-api.fly.dev',
};

const DEFAULT_API = 'https://reel-ballers-api-staging.fly.dev';

export function apiBase(hostname) {
  return API_BY_HOST[hostname] || DEFAULT_API;
}

export async function onRequestGet({ request }) {
  const hostname = new URL(request.url).hostname;
  const upstream = await fetch(`${apiBase(hostname)}/api/version`, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 0 },
  });

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', 'no-store');

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
