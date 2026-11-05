// T15100: the viewer's ISO 3166-1 alpha-2 country. The browser calls the API on Fly
// directly, so only this edge hop sees Cloudflare's geo data. Stamped on the sign-up row
// as a hint; null when the runtime gives none, never a guess.

export async function onRequestGet({ request }) {
  return new Response(JSON.stringify({ country: request.cf?.country ?? null }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
