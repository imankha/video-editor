// T5720: Edge-rendered PUBLIC GAME LINK watch page (Cloudflare Pages Function).
//
// Route: matches ONLY the two-segment `/shared/game/{token}`. The single-segment
// `[token].js` matcher (`/shared/{token}`) and the `/shared/collection/*`,
// `/shared/teammate/*` siblings never collide with this path. Functions take
// precedence over `public/_redirects` (`/* /index.html 200`), so this file owns
// `/shared/game/{token}` for public game links.
//
// Behavior: fetch the resolve JSON server-side, edge-cache it (public game links
// only, 10 min), and render a self-contained HTML page with a muted-autoplay
// <video> playing the TEAM RECAP, a static clip rail, and an "Add this game to
// your account" CTA (the T5730 claim seam, token carried in the path). ZERO
// external JS/CSS. Anonymous scope is the team recap ONLY -- the resolve API
// never returns a full-game URL, so there is nothing here to leak. Anything
// non-public / error / timeout falls through to the SPA byte-identical to a
// direct navigation. THE FUNCTION MUST NEVER make a link less accessible than
// today -- any doubt -> SPA fallthrough.

const API_BY_HOST = {
  "app.reelballers.com": "https://api.reelballers.com",
};
const DEFAULT_API = "https://reel-ballers-api-staging.fly.dev";

const SHARE_CACHE_TTL = 600; // seconds (10 min) -- comfortably < 4h presign expiry
const UPSTREAM_TIMEOUT_MS = 8000;

export function apiBase(hostname) {
  return API_BY_HOST[hostname] || DEFAULT_API;
}

// The API returns the poster as a STABLE relative proxy path (never a presigned
// URL -- crawlers refetch og:image after the 4h signature expires, and the
// edge-cached HTML would bake in a dead link). Crawlers don't resolve relative
// URLs, so absolutize against the API base before rendering.
export function absolutizePosterUrl(share, api) {
  if (share.poster_url && share.poster_url.startsWith("/")) {
    share.poster_url = api + share.poster_url;
  }
  return share;
}

// Server-rendered HTML: every interpolated value MUST pass through this so a
// crafted game/clip name cannot break out of an attribute or inject markup.
export function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Build the self-contained watch page. Pure function of the resolve JSON so it
// is unit-testable without the Workers runtime.
export function renderGamePage(share, token) {
  const gameName = escapeHtml(share.game_name || "Shared Game");
  const gameDate = share.game_date ? escapeHtml(share.game_date) : "";
  const title = gameDate ? `${gameName} -- ${gameDate}` : gameName;
  const sharer = escapeHtml(share.sharer_name || "");
  const attribution = sharer ? `Filmed by ${sharer}'s family` : "Team recap";
  const recapUrl = escapeHtml(share.recap_url);
  const preconnectOrigin = originOf(share.recap_url || "");
  const preconnect = preconnectOrigin
    ? `<link rel="preconnect" href="${escapeHtml(preconnectOrigin)}" crossorigin>`
    : "";
  // The CTA carries the token toward T5730's claim flow (which does not exist
  // yet). Until then this route falls through to the SPA signup with the token
  // preserved in the path -- nothing auto-materializes on auth.
  const claimUrl = escapeHtml(`/claim/game/${token}`);
  const desc = `${attribution} -- watch the team recap on ReelBallers.`;

  const rawPosterUrl = share.poster_url || "";
  const posterUrl = escapeHtml(rawPosterUrl);
  const posterMeta = rawPosterUrl
    ? `<meta property="og:image" content="${posterUrl}">
<meta property="og:image:type" content="image/jpeg">
<meta name="twitter:image" content="${posterUrl}">
`
    : "";
  const posterAttr = rawPosterUrl ? ` poster="${posterUrl}"` : "";

  const clips = Array.isArray(share.clips) ? share.clips : [];
  const clipRail = clips.length
    ? `<ol id="rail">${clips
        .map((c) => {
          const name = escapeHtml(c.name || "Clip");
          const tags = Array.isArray(c.player_tags) && c.player_tags.length
            ? `<span class="rt">${escapeHtml(c.player_tags.join(", "))}</span>`
            : "";
          return `<li><span class="rn">${name}</span>${tags}</li>`;
        })
        .join("")}</ol>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} | ReelBallers</title>
<meta name="description" content="${escapeHtml(desc)}">
${preconnect}
<meta property="og:type" content="video.other">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:video" content="${recapUrl}">
<meta property="og:video:type" content="video/mp4">
${posterMeta}<meta property="og:site_name" content="ReelBallers">
<meta name="twitter:card" content="${rawPosterUrl ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:#030712;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;min-height:100%}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #1f2937;background:#0b1220}
header h1{font-size:15px;font-weight:600;color:#f9fafb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%}
.brand{font-size:13px;font-weight:700;color:#22d3ee;letter-spacing:.02em;white-space:nowrap}
.attr{padding:6px 16px;font-size:12px;color:#9ca3af;background:#0b1220;border-bottom:1px solid #111827}
main{flex:1;display:flex;align-items:center;justify-content:center;background:#000;position:relative;overflow:hidden;min-height:40vh}
video{max-width:100%;max-height:100%;width:auto;height:auto;display:block;background:#000}
#unmute{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:10;display:flex;align-items:center;gap:8px;padding:10px 18px;border:0;border-radius:9999px;background:rgba(34,211,238,.92);color:#03151a;font-size:14px;font-weight:600;cursor:pointer;backdrop-filter:blur(4px)}
#unmute:hover{background:#22d3ee}
#rail{list-style:none;padding:8px 12px;margin:0;display:flex;gap:8px;overflow-x:auto;background:#0b1220;border-top:1px solid #1f2937}
#rail li{flex:0 0 auto;display:flex;flex-direction:column;gap:2px;padding:8px 12px;background:#111827;border:1px solid #f59e0b55;border-radius:8px;min-width:120px}
.rn{font-size:13px;font-weight:600;color:#fde68a}
.rt{font-size:11px;color:#9ca3af}
footer{display:flex;align-items:center;justify-content:center;gap:12px;padding:14px 16px;border-top:1px solid #1f2937;background:#0b1220}
.cta{display:inline-flex;align-items:center;gap:6px;padding:12px 22px;border-radius:9999px;background:#22d3ee;color:#03151a;font-weight:700;font-size:15px;text-decoration:none}
.cta:hover{background:#67e8f9}
</style>
</head>
<body>
<header>
<h1>${title}</h1>
<span class="brand">REEL BALLERS</span>
</header>
<div class="attr">${escapeHtml(attribution)}</div>
<main>
<video id="v" src="${recapUrl}"${posterAttr} autoplay muted playsinline controls preload="auto"></video>
<button id="unmute" type="button">Tap to unmute</button>
</main>
${clipRail}
<footer>
<a class="cta" href="${claimUrl}">Add this game to your account</a>
</footer>
<script>
(function(){
var v=document.getElementById("v"),b=document.getElementById("unmute");
function hide(){b.style.display="none"}
if(!v||v.muted===false)hide();
if(b){b.addEventListener("click",function(){v.muted=false;v.play();hide()});}
if(v){v.addEventListener("volumechange",function(){if(!v.muted)hide()});}
})();
</script>
</body>
</html>`;
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Returns the resolve JSON for a public game link (edge-cached), or null when
// the caller should fall through to the SPA (non-public, missing recap url,
// error, revoked, or timeout). Never throws.
async function loadPublicGameLink(api, token, request, waitUntil, upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS) {
  const cache = caches.default;
  const cacheKey = new Request(
    new URL(`/__game-link-cache/${encodeURIComponent(token)}`, request.url).toString()
  );

  const cached = await cache.match(cacheKey);
  if (cached) {
    try {
      return await cached.json();
    } catch {
      return null;
    }
  }

  let upstream;
  try {
    upstream = await fetchWithTimeout(`${api}/api/shared/game/${encodeURIComponent(token)}`, upstreamTimeoutMs);
  } catch {
    return null; // timeout / network error -> SPA fallthrough
  }
  if (!upstream.ok) {
    return null; // 404 / 410 revoked / 5xx -> SPA fallthrough, never cached
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return null;
  }
  // Only public links with a usable recap URL render on the edge.
  if (!data || data.is_public !== true || !data.recap_url) {
    return null;
  }

  const toCache = new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, s-maxage=${SHARE_CACHE_TTL}`,
    },
  });
  waitUntil(cache.put(cacheKey, toCache));
  return data;
}

export async function onRequestGet(context) {
  const { request, params, env, waitUntil } = context;
  const token = params.token;
  const url = new URL(request.url);
  const api = apiBase(url.hostname);

  // Fall through to the SPA: hand the ORIGINAL request to ASSETS, which applies
  // `public/_redirects` and returns index.html at 200 with the URL preserved
  // (revoked, not-found, sign-in flows unchanged). Fallbacks are no-store so a
  // transient upstream failure never CDN-caches a tagless page under the link.
  const serveSpa = async () => {
    const resp = await env.ASSETS.fetch(request);
    const uncached = new Response(resp.body, resp);
    uncached.headers.set("cache-control", "no-store");
    return uncached;
  };

  const share = await loadPublicGameLink(api, token, request, waitUntil);
  if (!share) {
    return serveSpa();
  }

  absolutizePosterUrl(share, api);

  // Fire-and-forget view beacon on EVERY render (cache hit or miss) so view
  // analytics don't regress when the JSON is edge-cached.
  waitUntil(
    fetch(`${api}/api/shared/game/${encodeURIComponent(token)}/viewed`, { method: "POST" }).catch(() => {})
  );

  return new Response(renderGamePage(share, token), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${SHARE_CACHE_TTL}`,
    },
  });
}
