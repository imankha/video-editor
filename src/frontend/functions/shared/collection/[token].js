// Edge-rendered unfurl tags for COLLECTION share links (T4890 follow-up).
//
// Unlike the single-reel page (../[token].js), this does NOT replace the page:
// the SPA's collection viewer is the real UI. We fetch the SPA's index.html
// from ASSETS and inject og/twitter meta tags into <head> - crawlers (no JS)
// read the tags; humans get the exact SPA they always got. og:image is the
// FIRST member reel's poster via the stable /poster.jpg proxy (never presigned).
import { apiBase, escapeHtml } from "../[token].js";

const SHARE_CACHE_TTL = 600; // seconds; matches the reel share page
// Same reasoning as the reel page: crawlers arrive with browser UAs and the
// API cold-starts in seconds - a short budget serves them a tagless page.
const UPSTREAM_TIMEOUT_MS = 8000;

export function buildCollectionMetaTags(data, api) {
  const title = escapeHtml(data.title || "Highlights");
  const descRaw = data.context_line
    ? `${data.title} - ${data.context_line} - shared from Reel Ballers.`
    : `${data.title} - shared from Reel Ballers.`;
  const desc = escapeHtml(descRaw);

  const posterAbs = data.poster_url && data.poster_url.startsWith("/")
    ? api + data.poster_url
    : (data.poster_url || "");
  const poster = escapeHtml(posterAbs);
  const w = Number.isInteger(data.poster_width) ? data.poster_width : null;
  const h = Number.isInteger(data.poster_height) ? data.poster_height : null;

  const posterMeta = poster
    ? `<meta property="og:image" content="${poster}">
<meta property="og:image:type" content="image/jpeg">
${w && h ? `<meta property="og:image:width" content="${w}">
<meta property="og:image:height" content="${h}">
` : ""}<meta name="twitter:image" content="${poster}">
`
    : "";

  return `<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
${posterMeta}<meta property="og:site_name" content="Reel Ballers">
<meta name="twitter:card" content="${poster ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
`;
}

export function injectHeadTags(html, tags) {
  const i = html.search(/<\/head>/i);
  if (i === -1) return html; // no <head> -> serve untouched rather than corrupt
  // Strip the SPA's own static og/twitter tags first: crawlers take the FIRST
  // occurrence, so leaving the generic app-wide tags in place would win over
  // the share-specific ones we inject.
  const stripped = html.replace(
    /[ \t]*<meta (?:property="og:|name="twitter:)[^>]*>\r?\n?/gi,
    ""
  );
  const j = stripped.search(/<\/head>/i);
  return stripped.slice(0, j) + tags + stripped.slice(j);
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

async function loadPublicCollection(api, token, request, waitUntil) {
  const cache = caches.default;
  const cacheKey = new Request(
    new URL(`/__collection-share-cache/${encodeURIComponent(token)}`, request.url).toString()
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
    upstream = await fetchWithTimeout(
      `${api}/api/shared/collection/${encodeURIComponent(token)}`,
      UPSTREAM_TIMEOUT_MS
    );
  } catch {
    return null; // timeout / network -> untagged SPA fallthrough
  }
  if (!upstream.ok) {
    return null; // 403 private / 404 / 410 revoked -> SPA handles messaging
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return null;
  }
  if (!data || !data.title) {
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

  // Fallbacks are no-store for the same reason as the reel page: a transient
  // upstream failure must never CDN-poison the URL with a tagless page.
  const serveSpa = async () => {
    const resp = await env.ASSETS.fetch(request);
    const uncached = new Response(resp.body, resp);
    uncached.headers.set("cache-control", "no-store");
    return uncached;
  };

  const data = await loadPublicCollection(api, token, request, waitUntil);
  if (!data) {
    return serveSpa();
  }

  const spaResp = await env.ASSETS.fetch(request);
  const html = await spaResp.text();
  const tagged = injectHeadTags(html, buildCollectionMetaTags(data, api));

  return new Response(tagged, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${SHARE_CACHE_TTL}`,
    },
  });
}
