// T4840: Edge-rendered share page (Cloudflare Pages Function).
//
// Route: matches ONLY single-segment `/shared/{token}`. `/shared/collection/*`
// and `/shared/teammate/*` are two segments and never match `[token]`, so they
// keep hitting the SPA via public/_redirects (`/* /index.html 200`). Functions
// take precedence over that rewrite, so this file owns `/shared/{token}` for
// public video shares only.
//
// Behavior: fetch the share JSON from the API server-side, edge-cache it (public
// shares only, 10 min), and render a self-contained HTML page with a muted
// autoplay <video> and ZERO external JS/CSS (no app bundle, Stripe, GSI, or
// service worker). Anything non-public / error / timeout falls through to the
// SPA byte-identical to today. THE FUNCTION MUST NEVER make a share less
// accessible than today -- any doubt -> SPA fallthrough.

// API base resolved by hostname (no dashboard env vars -- staging vars flow from
// the deploy workflow; production is the only host with the prod API).
const API_BY_HOST = {
  "app.reelballers.com": "https://api.reelballers.com",
};
const DEFAULT_API = "https://reel-ballers-api-staging.fly.dev";

const SHARE_CACHE_TTL = 600; // seconds (10 min) -- comfortably < 4h presign expiry
const UPSTREAM_TIMEOUT_MS = 2000;

export function apiBase(hostname) {
  return API_BY_HOST[hostname] || DEFAULT_API;
}

// Server-rendered HTML: every interpolated value MUST pass through this. A
// crafted video_name must not be able to break out of an attribute or inject
// markup.
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

// Build the self-contained share page. Pure function of the share JSON so it is
// unit-testable without the Workers runtime. Target: < 15KB.
export function renderSharePage(share) {
  const name = escapeHtml(share.video_name || "Shared Video");
  const videoUrl = escapeHtml(share.video_url);
  const rawVideoUrl = share.video_url || "";
  const preconnectOrigin = originOf(rawVideoUrl);
  const preconnect = preconnectOrigin
    ? `<link rel="preconnect" href="${escapeHtml(preconnectOrigin)}" crossorigin>`
    : "";
  const appHome = "https://app.reelballers.com/";
  const desc = `${name} -- shared from Reel Ballers.`;

  // T4890: first-frame poster for the unfurl card + instant first paint. Crawlers
  // don't run JS and need an ABSOLUTE URL, which the API supplies (presigned R2).
  // Omitted entirely when the reel has no poster (no silent fallback / dead URL);
  // platforms render their own play button over og:image when og:video is present.
  const rawPosterUrl = share.video_poster_url || "";
  const posterUrl = escapeHtml(rawPosterUrl);
  const posterW = Number.isInteger(share.video_poster_width) ? share.video_poster_width : null;
  const posterH = Number.isInteger(share.video_poster_height) ? share.video_poster_height : null;
  const posterDims = rawPosterUrl && posterW && posterH
    ? `<meta property="og:image:width" content="${posterW}">
<meta property="og:image:height" content="${posterH}">
`
    : "";
  const posterMeta = rawPosterUrl
    ? `<meta property="og:image" content="${posterUrl}">
<meta property="og:image:type" content="image/jpeg">
${posterDims}<meta name="twitter:image" content="${posterUrl}">
`
    : "";
  const posterAttr = rawPosterUrl ? ` poster="${posterUrl}"` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${name} | Reel Ballers</title>
<meta name="description" content="${desc}">
${preconnect}
<meta property="og:type" content="video.other">
<meta property="og:title" content="${name}">
<meta property="og:description" content="${desc}">
<meta property="og:video" content="${videoUrl}">
<meta property="og:video:type" content="video/mp4">
${posterMeta}<meta property="og:site_name" content="Reel Ballers">
<meta name="twitter:card" content="player">
<meta name="twitter:title" content="${name}">
<meta name="twitter:description" content="${desc}">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:#030712;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;min-height:100%}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #1f2937;background:#0b1220}
header h1{font-size:15px;font-weight:600;color:#f9fafb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%}
.brand{font-size:13px;font-weight:700;color:#22d3ee;letter-spacing:.02em;white-space:nowrap}
main{flex:1;display:flex;align-items:center;justify-content:center;background:#000;position:relative;overflow:hidden}
video{max-width:100%;max-height:100%;width:auto;height:auto;display:block;background:#000}
#unmute{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:10;display:flex;align-items:center;gap:8px;padding:10px 18px;border:0;border-radius:9999px;background:rgba(34,211,238,.92);color:#03151a;font-size:14px;font-weight:600;cursor:pointer;backdrop-filter:blur(4px)}
#unmute:hover{background:#22d3ee}
#end-card{display:none;position:absolute;inset:0;z-index:20;flex-direction:column;align-items:center;justify-content:center;background:rgba(11,15,26,.97)}
#end-card.show{display:flex}
#end-card p.wm{font-size:clamp(18px,4vw,28px);font-weight:700;color:#fff;text-align:center;padding:0 16px}
#end-card p.url{font-size:clamp(12px,2.5vw,16px);color:#9ca3af;margin-top:8px}
#replay{margin-top:24px;padding:10px 24px;border:0;border-radius:9999px;background:#22d3ee;color:#03151a;font-size:14px;font-weight:600;cursor:pointer}
#replay:hover{background:#67e8f9}
footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-top:1px solid #1f2937;background:#0b1220}
footer a{color:#e5e7eb;text-decoration:none;font-size:14px}
.dl{display:inline-flex;align-items:center;gap:6px;color:#9ca3af}
.cta{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#22d3ee;color:#03151a;font-weight:600}
</style>
</head>
<body>
<header>
<h1>${name}</h1>
<span class="brand">REEL BALLERS</span>
</header>
<main>
<video id="v" src="${videoUrl}"${posterAttr} autoplay muted playsinline controls preload="auto"></video>
<button id="unmute" type="button">Tap to unmute</button>
<div id="end-card" role="region" aria-label="Made with Reel Ballers">
<p class="wm">Made with Reel Ballers</p>
<p class="url">reelballers.com</p>
<button id="replay" type="button">Replay</button>
</div>
</main>
<footer>
<a class="dl" href="${videoUrl}" download>Download</a>
<a class="cta" href="${escapeHtml(appHome)}">Open Reel Ballers</a>
</footer>
<script>
(function(){
var v=document.getElementById("v"),b=document.getElementById("unmute"),ec=document.getElementById("end-card"),rp=document.getElementById("replay");
function hide(){b.style.display="none"}
if(!v.muted)hide();
b.addEventListener("click",function(){v.muted=false;v.play();hide()});
v.addEventListener("volumechange",function(){if(!v.muted)hide()});
v.addEventListener("ended",function(){ec.classList.add("show");v.controls=false});
rp.addEventListener("click",function(){ec.classList.remove("show");v.controls=true;v.currentTime=0;v.play()});
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

// Returns the share JSON for a PUBLIC share (edge-cached), or null when the
// caller should fall through to the SPA (non-public, missing url, error, or
// timeout). Never throws.
async function loadPublicShare(api, token, request, waitUntil) {
  const cache = caches.default;
  const cacheKey = new Request(
    new URL(`/__share-cache/${encodeURIComponent(token)}`, request.url).toString()
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
    upstream = await fetchWithTimeout(`${api}/api/shared/${encodeURIComponent(token)}`, UPSTREAM_TIMEOUT_MS);
  } catch {
    return null; // timeout / network error -> SPA fallthrough
  }
  if (!upstream.ok) {
    return null; // 403 / 404 / 410 / 5xx -> SPA fallthrough, never cached
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return null;
  }
  // Only public shares with a usable video URL render on the edge.
  if (!data || data.is_public !== true || !data.video_url) {
    return null;
  }

  // Cache the JSON for public shares only. TTL < presign expiry so a cached
  // page never embeds a dead video URL; revoke is honored within the TTL.
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

  // Fall through to the SPA: hand the ORIGINAL request to the ASSETS binding,
  // which applies `public/_redirects` (`/* /index.html 200`) and returns
  // index.html at 200 with the `/shared/{token}` URL preserved -- byte- and
  // status-identical to today's direct SPA navigation (sign-in, revoked,
  // not-found flows all unchanged). Verified locally: ASSETS.fetch on the
  // original path returns 200 index.html (NOT a 308 canonicalization).
  const serveSpa = () => env.ASSETS.fetch(request);

  const share = await loadPublicShare(api, token, request, waitUntil);
  if (!share) {
    return serveSpa();
  }

  // Fire-and-forget view beacon on EVERY render (cache hit or miss) so view
  // analytics don't regress when the JSON is edge-cached.
  waitUntil(
    fetch(`${api}/api/shared/${encodeURIComponent(token)}/viewed`, { method: "POST" }).catch(() => {})
  );

  return new Response(renderSharePage(share), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${SHARE_CACHE_TTL}`,
    },
  });
}
