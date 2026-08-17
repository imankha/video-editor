# T6370 Design — Part B robots.txt scope for `app.reelballers.com`

**Status:** AWAITING APPROVAL (design gate)
**Scope of this doc:** ONLY the Part B robots.txt scope decision (`Disallow: /` vs
scoped). Everything else in Part B (the `noindex` meta + `<title>` fix on the app shell)
and all of Part C is mechanical and not design-gated — it will be implemented after this
decision is approved. Part A remains out of scope for this run (needs the GSC export).

---

## The decision

Where a new `robots.txt` is served on the app host `app.reelballers.com`, should it be:

- **(A) blanket `Disallow: /`**, or
- **(B) `Disallow: /` with an explicit `Allow:` for the public share paths**, or
- **(C) disallow scoped only to authenticated app routes**?

**Recommendation: (B).** `Disallow: /` with the share paths allow-listed.

```
# app.reelballers.com — the logged-in editor SPA. It should not compete for the
# search index: every unknown path is a soft-404 copy of the app shell (see
# public/_redirects `/* /index.html 200`). Block crawling of the app, but KEEP
# the public share surfaces fetchable so link unfurls still work.
User-agent: *
Allow: /shared/
Disallow: /
```

`Allow` is placed before `Disallow` so first-match crawlers also honour the exception;
Google/Bing use longest-match specificity, where `/shared/` (7 chars) already beats `/`
(1 char). No `Sitemap:` line — the sitemap lives on the apex marketing host, not here.

**Only `/shared/` needs allow-listing, not `/api/shared/`.** The crawler/unfurler fetches
the app-host page at `app.reelballers.com/shared/{token}`; the JSON and og:image poster it
depends on (`/api/shared/{token}`, `/api/shared/{token}/poster.jpg`) are served from the
**separate** API origin `api.reelballers.com` (see `API_BY_HOST` in
`functions/shared/[token].js`), which this file does not govern — robots.txt is per-origin.
On the app host itself, `/api/*` has no proxy (`_redirects` is only `/* /index.html 200`), so
it is just more soft-404 shell we WANT disallowed. The API host's own robots posture is a
separate concern (and the likely source of the GSC "401" bucket — Part A, out of scope here).

---

## Why not (A) blanket `Disallow: /`

Because public sharing lives on this exact host and several major unfurl crawlers
**do** obey `robots.txt`, so a blanket disallow would silently break link previews.

Evidence (verified in this repo, code-expert pass 2026-08-17):

| Share type | Public URL on app host | Preview served by |
|---|---|---|
| Single reel | `/shared/{token}` | Cloudflare Pages Function `functions/shared/[token].js` — full standalone OG HTML |
| Collection | `/shared/collection/{token}` | `functions/shared/collection/[token].js` — injects OG tags into `index.html` |
| Game link | `/shared/game/{token}` | `functions/shared/game/[token].js` — full standalone OG HTML |
| Teammate | `/shared/teammate/{token}` | `functions/shared/teammate/[token].js` — injects OG tags into `index.html` |

Each preview also depends on backend endpoints on the same host:
`/api/shared/{token}` (JSON) and `/api/shared/{token}/poster.jpg` (the stable, never-
presigned `og:image` proxy), and the collection/game/teammate variants of both.

The task's own Part B constraint is explicit: *"Public share/unfurl surfaces must stay
fetchable ... If share pages are served from the app host and need indexing, scope the
disallow."* They are, so a blanket disallow is ruled out. `robots.txt` is a **crawl**
directive: crawlers that respect it (facebookexternalhit, Twitterbot, Slackbot-
LinkExpanding, LinkedInBot) would refuse to fetch `/shared/*` and render no preview.
(iMessage/Applebot and some others ignore robots.txt, but we cannot rely on the ones
that don't — the constraint says verify, not assume.)

## Why not (C) scope to authenticated routes

The app is a client-rendered SPA behind a `/* → index.html 200` catch-all: **every**
path returns the shell, so there is no static list of "authenticated routes" to disallow
and the soft-404 pollution (the actual Part B problem) comes from *arbitrary invented*
paths, not a known route set. Enumerating auth routes would be fragile and would miss the
junk URLs entirely. Blocking broadly and carving out the one public surface (`/shared/`)
is both simpler and more correct.

## Serving mechanism (so the file actually lands)

`app.reelballers.com` is the Cloudflare-hosted `src/frontend` build. Today
`GET /robots.txt` returns the SPA shell because `_redirects` rewrites `/*` to
`index.html`. A real static file in `src/frontend/public/robots.txt` is emitted to
`dist/robots.txt` and served **before** the `_redirects` catch-all (static assets take
precedence over rewrites), so it returns `text/plain`, satisfying the acceptance
criterion `curl .../robots.txt` returns a real robots.txt, not the shell.

---

## Interaction with the app-shell `noindex` meta (heads-up, not a separate gate)

Adding `<meta name="robots" content="noindex,follow">` to `src/frontend/index.html`
(Part B step 8) also lands on the two share types whose edge function *injects* into
`index.html` — collection and teammate. This is **fine and arguably desirable**:

- `noindex` is an *indexing* directive, not a *fetch* directive — OG unfurl crawlers
  still read `og:` tags and render previews on a noindexed page. Previews keep working.
- We likely do **not** want a child's collection/teammate reel in Google's index anyway.

The two *standalone* share pages (single reel, game link) are full edge-rendered HTML and
do **not** inherit `index.html`'s meta, so they stay indexable unless we add noindex to
those edge functions.

### Open question for approval

Do we want the public share pages **indexed by Google**, or only **unfurlable**?

- **Approve as recommended (B):** share pages are crawlable (unfurls work) and *may* be
  indexed. Minimal change, no edge-function edits. This is the default I will implement.
- **If unfurl-but-never-index is preferred:** we additionally add
  `<meta name="robots" content="noindex">` to the two standalone share edge functions
  (`functions/shared/[token].js`, `functions/shared/game/[token].js`). That is a small
  extra change to Part B — tell me and I'll fold it in; otherwise I proceed without it.

I recommend the default (B) for this pass: it unblocks unfurls (the hard requirement) and
does not touch the edge functions. Indexing of share pages, if unwanted, is a clean
follow-up and does not block the robots.txt landing.

---

## Verification plan (post-approval, in-container best effort)

1. `cd src/frontend && npm run build` (or the frontend's build) → confirm `dist/robots.txt`
   exists and contains the approved rules with `text/plain` served ahead of the catch-all.
2. Live unfurl check: fetch a real `app.reelballers.com/shared/{token}` with an OG-scraper
   UA (`facebookexternalhit`) and confirm OG tags return 200. If a live share token cannot
   be minted inside the container, this is flagged in the QA evidence as needing a
   post-push staging check (per kickoff step 4).
