# T6370: SEO — get the landing pages actually indexed (GSC coverage cleanup + page value)

**Status:** STAGING
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-02
**Updated:** 2026-08-02

## Problem

Google Search Console emailed on 2026-08-02 that pages on `reelballers.com` are not indexed for
four *new* reasons. The full Page Indexing report shows **six buckets, 40 URLs**:

| Reason | Source | Pages |
|---|---|---|
| Page with redirect | Website | 2 |
| Alternate page with proper canonical tag | Website | 2 |
| Excluded by 'noindex' tag | Website | 1 |
| Blocked due to unauthorized request (401) | Website | 1 |
| Discovered - currently not indexed | Google systems | 21 |
| Crawled - currently not indexed | Google systems | 13 |

**The email's four reasons are the small half of the story.** Three of them are working as
designed (see Findings). The number that matters is `21 + 13 = 34` — the sitemap publishes
**30 URLs**, so effectively *the entire marketing site is crawled-or-discovered and not indexed*.
That is the actual SEO problem: pages exist, Google has seen them, and Google is declining to
put them in the index.

Second thing the arithmetic exposes: 40 non-indexed URLs against a 30-URL sitemap means **at
least 10 of the reported URLs are not ours to sitemap** — redirect targets, `app.` subdomain
paths, or old pre-Astro SPA routes. Some of those are worth fixing; the audit has to start from
the actual URL list, not from guesses.

### Honest framing (read before scoping)

The Astro landing site shipped **2026-07-24** (`src/landing/astro.config.ts` first commit) — it
was **nine days old** when Google sent this email. "Discovered/Crawled - currently not indexed"
on a nine-day-old, low-authority domain with 30 templated pages is the *expected* state, not
proof of a defect. Google is saying "I don't yet think these are worth indexing," which is a
site-authority and page-value judgment, not a crawl-blocking bug.

So this task is deliberately two-sided, and the second side is the one with leverage:

- **Part A/B — technical hygiene.** Cheap, verifiable, done once. Closes the six buckets and
  stops the `app.` subdomain polluting the property. Do NOT expect indexing to jump from this.
- **Part C — page value + indexing signals.** Slow, iterative, and where the actual result comes
  from. Ships as a first pass here; the tail may be split into follow-ups.

Do not "fix" Parts A/B and then report the SEO problem as solved.

## Findings (verified live 2026-08-02, `curl` against production)

Everything below was measured, not inferred. Re-verify before acting — the site deploys often.

### 1. "Page with redirect" (2) — working as designed

```
301  https://www.reelballers.com/        -> https://reelballers.com/     (apex is canonical)
307  https://reelballers.com/index.html  -> https://reelballers.com/
307  https://reelballers.com/soccer/     -> https://reelballers.com/soccer   (trailingSlash:'never')
```

All three are intentional canonicalization. GSC reports redirect URLs as "not indexed" because
the *redirecting* URL isn't the indexed one — the target is. **Nothing to fix**, unless the
export shows a redirect we don't recognize. The action is to confirm the 2 URLs are from this
set and then leave them alone.

### 2. "Alternate page with proper canonical tag" (2) — probably also by design

Prime suspect is documented in our own config. `astro.config.ts` (sitemap `serialize`) notes:

> `trailingSlash:'never'` makes the sitemap emit the homepage as `https://reelballers.com` while
> the canonical tag uses `https://reelballers.com/`. Those are the same resource ... so this is
> cosmetic, not a duplicate-content risk.

That comment may be exactly what GSC is now reporting out loud. It is still *harmless* (Google
picked the canonical correctly — that's what "proper canonical tag" means), but we should stop
guessing: identify the 2 URLs from the export and confirm each resolves to a canonical we intend.

### 3. "Excluded by 'noindex' tag" (1) — intentional, but wasteful

`/guides` serves `<meta name="robots" content="noindex,follow">`. That is correct behavior —
`src/pages/guides/index.astro` noindexes the listing while `PUBLISHED_GUIDES` is empty, and
`astro.config.ts` filters it out of the sitemap off the same data, so the two can't disagree.
Good design.

The waste: **`/guides` is linked in the header nav on every page** (confirmed in the rendered
homepage HTML). Every crawl of every page finds a link to a page we've told Google to ignore.
Decide one of:
- hide the nav link while `PUBLISHED_GUIDES` is empty (keeps the noindex, removes the dead link), or
- publish the first guide, which removes the noindex *and* adds the kind of page that gets indexed.

The second is strictly better for Part C. The first is the cheap version.

### 4. "Blocked due to unauthorized request (401)" (1) — NOT reproduced, needs the export

Could not reproduce from outside. As Googlebot, every probed path returns 200:

```
200  https://app.reelballers.com/           200  https://app.reelballers.com/api/me
200  https://app.reelballers.com/robots.txt 200  https://app.reelballers.com/api/admin/users
200  https://app.reelballers.com/this-page-does-not-exist-xyz
```

**Do not fix this blind.** Export the URL from GSC first (Page indexing -> the 401 row -> Export),
then reproduce with `curl -A Googlebot`. Most likely it lives on the API/app host and the GSC
property is a domain property covering subdomains.

### 5. The real technical defect nobody reported: `app.reelballers.com` is a soft-404 catch-all

This is the one genuine find, and it isn't in the email:

- `app.reelballers.com/robots.txt` returns **the SPA's `index.html` with HTTP 200** — there is no
  robots.txt on the app host at all.
- **Every** path returns 200 HTML, including `/api/*` and `/this-page-does-not-exist-xyz`. Every
  URL a crawler invents on that host is an indexable duplicate of the app shell.
- The shell has **no `<meta name="robots">` and no `<link rel="canonical">`.
- Its `<title>` is `Reel Ballers` — which directly violates the rule in `src/landing/src/site.ts`:
  *"Consistent entity name. Never 'Reel Ballers' in prose or schema."* Entity-name consistency is
  a citation/ranking signal and we're contradicting ourselves across our own two hosts.

If the GSC property is a domain property, this host is feeding it junk URLs and is a plausible
source of both the 401 and some of the 21 "Discovered - currently not indexed". The app is a
logged-in tool; it should not be competing for the index.

### 6. Page value: the programmatic pages are ~70% boilerplate

Measured on rendered text, unique lines, `/soccer` vs `/volleyball`: **109 of 156 lines are
identical** — about 30% of each page is genuinely sport-specific, and most of that 30% is the tag
list. Word counts are respectable (`/soccer` 1000, `/volleyball` 1002, `/tennis` 1018,
`/works-with/gopro` 822, `/vs/capcut` 848, `/for-parents` 788), so this is not a thin-content
problem by length — it's a **template-similarity** problem by substance. That is the textbook
profile for "Crawled - currently not indexed" across a family of generated pages.

## Solution

Three parts, in order. A and B are bounded; C is a first pass with an explicit stopping point.

### Part A — Close the six GSC buckets against the real URL list

1. Export all six buckets from GSC (the report's EXPORT button) into `docs/plans/seo/` so the
   audit is reproducible and reviewable.
2. For each URL, record: status code as Googlebot, canonical tag, robots meta, and a verdict of
   **intentional** / **fix**. Intentional entries get a one-line reason; that list becomes the
   answer for the next time this email arrives.
3. Fix only the "fix" rows. Reproduce the 401 before touching anything.
4. In GSC, hit **Validate Fix** on the buckets that had real fixes; leave the intentional ones
   alone (validating a by-design redirect just produces noise).

### Part B — Stop `app.reelballers.com` polluting the index

Serve a real `robots.txt` on the app host with `Disallow: /`, and add `<meta name="robots"
content="noindex,follow">` to the app shell. Fix the `<title>` to `ReelBallers` so the entity name
matches `site.ts`.

**Constraint — do not break sharing.** Public share/unfurl surfaces must stay fetchable: link
previews depend on crawlers/unfurlers reading share pages (see the unfurl work in
`.claude/knowledge/export-pipeline.md`). `Disallow` is a *crawl* directive and OG/unfurl bots
mostly ignore robots.txt, but this must be verified, not assumed: confirm a share link still
unfurls after the change. If share pages are served from the app host and need indexing, scope
the disallow to the authenticated app routes instead of `/`.

### Part C — Make the pages worth indexing (first pass)

1. **Differentiate the programmatic pages.** Raise the unique share of each sport /
   `works-with` / `vs` page well above today's ~30%. Real per-sport substance: what the footage
   actually looks like for that sport, what a reel for that sport needs to show, camera/angle
   realities, position-specific guidance. Boilerplate that appears on 11 pages is the thing
   Google is declining to index — cutting shared filler helps as much as adding words.
2. **Publish the first real guide.** This clears the `/guides` noindex, gives the nav link a
   destination, and adds the one page type on this site that can earn links on its own.
3. **Internal linking with intent.** Today the nav links everything to everything flatly.
   Give the important pages (`/soccer` — ~75% of the audience per `project_target_audience`)
   more internal links from contextually related pages than the long tail gets.
4. **Request indexing** for the handful of pages that matter most, via GSC URL Inspection.
   `scripts/indexnow-submit.mjs` already fires on deploy (Bing/IndexNow); Google does not consume
   IndexNow, so the GSC request is a separate manual step.
5. **Extend `scripts/verify-seo.mjs`** with whatever new invariant this task establishes (e.g.
   "no page in the sitemap is noindex", "no internal link points at a noindex page"), so the
   class of problem can't silently return.

**Explicitly out of scope:** buying links, content farms, or any tactic that trades long-term
domain trust for a short-term index bump. Also out of scope: rewriting all 30 pages — do the
sport pages (the audience core) and hold the rest for a follow-up if the first pass moves the
needle.

## Context

### Relevant Files (REQUIRED)

Landing site (`src/landing`):
- `src/landing/astro.config.ts` — sitemap filter/serialize, `trailingSlash`, `build.format`; source of the homepage-canonical footnote
- `src/landing/src/pages/robots.txt.ts` — generated robots.txt for the apex (AI crawlers deliberately allowed; do not add Disallow rules for them)
- `src/landing/src/layouts/BaseLayout.astro` — `noindex` prop -> robots meta (line ~78), canonical, OG
- `src/landing/src/layouts/PageLayout.astro` — the wrapper every public page must use
- `src/landing/src/components/Header.astro` — the nav that links `/guides`
- `src/landing/src/pages/guides/index.astro` — noindex-while-empty listing
- `src/landing/src/pages/[sport].astro` — the 11-page sport template (the ~70%-boilerplate one)
- `src/landing/src/pages/vs/[comparison].astro`, `src/landing/src/pages/works-with/` — the other programmatic families
- `src/landing/src/data/sports.ts`, `comparisons.ts`, `cameras.ts`, `useCases.ts` — the per-page content data; most differentiation work lands here
- `src/landing/src/site.ts` — `SITE_URL`, `APP_URL`, `BRAND`, `FACTS`; single source of quotable facts
- `src/landing/scripts/verify-seo.mjs` — existing SEO invariant checker; extend it
- `src/landing/scripts/indexnow-submit.mjs` — IndexNow submission on deploy
- `src/landing/SEO.md` — the doc to update with whatever this task decides

App shell (Part B):
- `src/frontend/index.html` — `<title>Reel Ballers</title>`, no robots meta, no canonical
- `src/frontend/public/` — where an app-host `robots.txt` would live

New:
- `docs/plans/seo/gsc-2026-08-02-*.csv` + a verdict table — the exported buckets and per-URL rulings

### Related Tasks
- Follows the 2026-07-24 Astro rebuild (`feat(landing): rebuild marketing site on Astro for SEO + AI engine discovery`)
- Related content work already in PLAN.md: T2330 (before/after examples), T3300 / T1910 (tutorial video) — both add page substance the landing site can use
- Blocks: nothing

### Technical Notes

- **Canonical origin is the apex.** `www` 301s to it; `SITE_URL` in `site.ts` is the single
  source. Never introduce a second origin for the same content.
- **`build.format: 'file'` + `trailingSlash: 'never'`** deliberately yields exactly one URL per
  page. Don't "fix" the 307s by changing this — it would create the duplicate-content split the
  current setup exists to prevent.
- **The AI-crawler allowlist in `robots.txt.ts` is deliberate** (ChatGPT/Claude/Perplexity
  citation is a primary discovery path). Part B disallows the **app** host only. Do not add
  Disallow rules to the apex robots.txt.
- **The sitemap must only list indexable URLs.** The existing `PUBLISHED_GUIDES` filter enforces
  this for `/guides`; any new noindex page needs the same treatment, driven off the same data.
- **`site.ts` is the single source for quotable facts** — the app shell's title/description
  should be consistent with it, not a second independent copy.
- Deploy path: `.github/workflows/deploy-landing.yml`, triggered by pushes to `master` touching
  `src/landing/**`; host is a Cloudflare Worker serving `dist/`.

## Implementation

### Steps

**Part A — GSC audit**
1. [ ] Export all six Page Indexing buckets from GSC to `docs/plans/seo/`
2. [ ] Build the per-URL verdict table (status as Googlebot, canonical, robots meta, intentional/fix + reason)
3. [ ] Reproduce the 401 URL specifically; identify the host and the handler that returns it
4. [ ] Fix only the "fix" rows; leave documented-intentional rows alone
5. [ ] Trigger Validate Fix in GSC for buckets with real fixes

**Part B — app host**
6. [ ] Add `robots.txt` on `app.reelballers.com` (scope: `/` vs authenticated routes only — decided by step 7)
7. [ ] Verify a public share link still unfurls (OG preview) after the disallow; adjust scope if not
8. [ ] Add `<meta name="robots" content="noindex,follow">` to the app shell
9. [ ] Fix the app `<title>` to `ReelBallers` (matches `site.ts` BRAND)

**Part C — page value**
10. [ ] Raise per-page unique content on the 11 sport pages (target: unique share well above today's ~30%; re-measure with the same `/soccer` vs `/volleyball` diff method)
11. [ ] Publish the first guide; drop the `/guides` noindex (or hide the nav link if no guide ships this pass)
12. [ ] Add intentional internal links favoring `/soccer` and the core pages
13. [ ] Request indexing in GSC for the priority pages
14. [ ] Extend `verify-seo.mjs` with the new invariants; update `src/landing/SEO.md`

### Progress Log

**2026-08-02**: Task created from the GSC email. Live diagnosis completed (see Findings) —
redirects/canonical/noindex are by design; the 401 could not be reproduced externally and needs
the GSC export; the unreported real defect is `app.reelballers.com` serving 200 HTML for every
path with no robots.txt, no robots meta, no canonical, and a `<title>` that contradicts
`site.ts`. Measured sport-page template similarity at 109/156 identical rendered-text lines
(`/soccer` vs `/volleyball`). Site was 9 days old at the time of the email — the 34
discovered/crawled-not-indexed pages are as much an authority/value problem as a technical one.

**2026-08-17**: Parts B + C implemented via /dotask container worker, merged to master
(`feature/T6370-seo-indexing-gsc-cleanup`), Branch CI green, auto-deploying to staging.
**Part A excluded from this run** — steps 1-5 need a GSC Page Indexing export only the user
can pull; stays TODO. Part B: `robots.txt` added to `app.reelballers.com` (`Disallow: /` +
`Allow: /shared/` — design doc at `docs/plans/tasks/T6370-design.md` covers why a blanket
disallow was rejected, share previews live on this host); `noindex,follow` +
`<title>ReelBallers</title>` added to the app shell. Verified locally via `wrangler pages dev`
(robots.txt serves `text/plain` ahead of the SPA catch-all) and the 57 existing share-page
unit tests still pass — **a live staging unfurl check with a real share token is the next
step**, merge unblocks it. Part C: sport-page unique-content share re-measured and raised
(whole-page 40.4%→42.6%, content-area-only 63.3%→66.7%, via per-sport
`framingWhy`/`recruitingWhy` FAQ answers that were previously byte-identical across all 11
pages); first guide published (`/guides/filming-youth-sports-from-the-sideline`), lifting the
`/guides` noindex; internal links favoring `/soccer` added from 6 core pages;
`verify-seo.mjs` extended with sitemap-noindex and nav-noindex invariants (stress-tested
against synthetic violations); a pre-existing unrelated `verify-seo.mjs` bug (GSC
ownership-verification file walked as a content page) fixed in the same pass.

**2026-08-18**: Post-merge staging unfurl check completed (closes the item left open above).
Deploy Frontend/Landing/Backend + Master CI all green on the merge commit. Live-verified on
`https://reel-ballers-staging.pages.dev`: `dev-login`'d as the real `imankh@gmail.com`
staging account, created a live public share via `POST /api/gallery/{video_id}/share`,
curled the resulting `/shared/{token}` URL with `facebookexternalhit`/`Googlebot`/`Twitterbot`
user agents — all 200, correct `og:title`/`og:description`/`og:video`/`og:type`, confirming
`Allow: /shared/` correctly overrides the blanket `Disallow: /`. Also confirmed `robots.txt`
serves `text/plain` on the live staging host and the app-shell `noindex`/title fix is live.
**Found, not fixed (out of T6370 scope):** the share page's `og:site_name` still reads
"Reel Ballers" (with a space) — same entity-name rule this task fixed elsewhere, but in a
different file (`functions/shared/[token].js`, not `index.html`); candidate follow-up task.
Still open: GSC "request indexing" (manual GSC action, step 13), the ~4-week indexed-page
re-check (acceptance criteria), and all of Part A (needs the user's GSC export).

## Acceptance Criteria

- [ ] Every one of the 40 reported URLs has a recorded verdict: **intentional** (with reason) or **fixed** (with the commit)
- [ ] The 401 URL is reproduced and either fixed or documented as correct (an authenticated endpoint returning 401 to an anonymous crawler is correct — say so explicitly if that's the answer)
- [ ] `curl https://app.reelballers.com/robots.txt` returns a real robots.txt (`text/plain`), not the SPA shell
- [ ] The app shell serves `noindex` and its `<title>` is `ReelBallers`
- [ ] A public share link still produces a correct link preview after the app-host robots change — verified against a real unfurl, not assumed
- [ ] No page listed in `sitemap-0.xml` serves a `noindex` robots meta (assert in `verify-seo.mjs`)
- [ ] No internal nav link points at a noindex page (assert in `verify-seo.mjs`)
- [ ] Sport-page unique-content share is re-measured and materially above the 2026-08-02 baseline of ~30%, using the documented method
- [ ] `src/landing/SEO.md` records which GSC buckets are permanently by-design, so the next identical email is a 2-minute triage instead of a re-audit
- [ ] `npm run build` in `src/landing` passes and `verify-seo.mjs` is green
- [ ] Indexing outcome is re-checked in GSC **~4 weeks after deploy** and the result recorded in this file — the metric is indexed-page count, not "we shipped the fixes"
