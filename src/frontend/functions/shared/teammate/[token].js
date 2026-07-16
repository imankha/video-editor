// Edge-rendered unfurl tags for TEAMMATE (game) share links (T4890 follow-up).
//
// Same injection approach as ../collection/[token].js: og/twitter tags go into
// the SPA's index.html; crawlers read tags, humans get the unchanged SPA claim
// flow. T5180: when the game has a recap, og:image is the recap's clearest frame
// via the stable token-gated poster proxy (never a presigned URL); with no recap
// we keep the branded site card served from THIS origin (never a broken image).
// Deliberately excludes the sharer's email from the unfurl - the chat preview
// is visible to anyone the link is forwarded to.
import { apiBase, escapeHtml } from "../[token].js";
import { injectHeadTags } from "../collection/[token].js";

const SHARE_CACHE_TTL = 600;
const UPSTREAM_TIMEOUT_MS = 8000; // cold-start budget; see ../[token].js

export function buildTeammateMetaTags(data, origin, api) {
  const game = escapeHtml(data.game_name || "Shared Game");
  const clips = Number.isInteger(data.clip_count) ? data.clip_count : null;
  const desc = escapeHtml(
    clips
      ? `${clips} highlight clip${clips === 1 ? "" : "s"} from ${data.game_name || "a game"} - shared with you on Reel Ballers.`
      : `Game highlights shared with you on Reel Ballers.`
  );

  // Real recap frame when the backend resolved one (relative proxy path ->
  // absolutize with the API base); otherwise the branded card from this origin.
  const posterAbs = data.poster_url && data.poster_url.startsWith("/") && api
    ? api + data.poster_url
    : data.poster_url || "";
  const image = escapeHtml(posterAbs || `${origin}/og-card.jpg`);
  // Recap frame dimensions aren't known at tag time -> omit the optional
  // width/height; the fixed branded card keeps its 1200x630.
  const dims = posterAbs
    ? ""
    : `<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
`;

  return `<meta property="og:type" content="website">
<meta property="og:title" content="${game} - shared highlights">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${image}">
<meta property="og:image:type" content="image/jpeg">
${dims}<meta property="og:site_name" content="Reel Ballers">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${game} - shared highlights">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
`;
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

async function loadTeammateShare(api, token, request, waitUntil) {
  const cache = caches.default;
  const cacheKey = new Request(
    new URL(`/__teammate-share-cache/${encodeURIComponent(token)}`, request.url).toString()
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
      `${api}/api/shared/teammate/${encodeURIComponent(token)}`,
      UPSTREAM_TIMEOUT_MS
    );
  } catch {
    return null;
  }
  if (!upstream.ok) {
    return null; // 404 / 410 revoked -> untagged SPA handles messaging
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return null;
  }
  if (!data || !data.game_name) {
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

  // no-store fallbacks: a transient upstream failure must never CDN-poison
  // the URL with a tagless page (same lesson as the reel page).
  const serveSpa = async () => {
    const resp = await env.ASSETS.fetch(request);
    const uncached = new Response(resp.body, resp);
    uncached.headers.set("cache-control", "no-store");
    return uncached;
  };

  const data = await loadTeammateShare(api, token, request, waitUntil);
  if (!data) {
    return serveSpa();
  }

  const spaResp = await env.ASSETS.fetch(request);
  const html = await spaResp.text();
  const tagged = injectHeadTags(html, buildTeammateMetaTags(data, url.origin, api));

  return new Response(tagged, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${SHARE_CACHE_TTL}`,
    },
  });
}
