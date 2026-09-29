// Keep stale PWA shells bootable across deployments. Cloudflare Pages serves
// the SPA fallback (index.html, status 200) when an asset from an older shell
// is no longer present, which leaves the static preloader on screen forever.
// The immutable recovery deployment contains the assets referenced by the
// affected production shell; current assets still pass through untouched.

const RECOVERY_ASSET_ORIGIN = 'https://cd02fcba.reel-ballers-prod.pages.dev';

export async function onRequestGet(context) {
  const current = await context.next();
  const contentType = current.headers.get('content-type') || '';

  if (!contentType.includes('text/html')) return current;

  const requestUrl = new URL(context.request.url);
  const recoveryUrl = new URL(requestUrl.pathname, RECOVERY_ASSET_ORIGIN);
  const recovered = await fetch(recoveryUrl, {
    headers: { Accept: context.request.headers.get('accept') || '*/*' },
  });

  const recoveredType = recovered.headers.get('content-type') || '';
  if (!recovered.ok || recoveredType.includes('text/html')) return current;

  const headers = new Headers(recovered.headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-ReelBallers-Asset-Recovery', '1');

  return new Response(recovered.body, {
    status: recovered.status,
    headers,
  });
}
