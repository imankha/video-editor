# SEO / AEO setup for reelballers.com

This is the marketing site (`src/landing`). It is a **static Astro build** deployed to a
Cloudflare Worker. Every public page is fully rendered HTML — a crawler with JavaScript
disabled sees the complete page.

**Read this before adding or changing a public page.** The build enforces some of it; the
rest is on you.

---

## The one rule

> Every public page needs: a unique title, a unique description, a canonical URL, OG +
> Twitter tags, JSON-LD, exactly one `<h1>`, and a sitemap entry.

All of that comes free if you render through `PageLayout`. Don't hand-roll a `<head>`.

---

## Architecture

| Thing | Where | Notes |
|---|---|---|
| Framework | Astro 5, static output | `astro.config.ts` |
| Deploy | `.github/workflows/deploy-landing.yml` | Push to `master` touching `src/landing/**` |
| Host | Cloudflare Worker `video-editor` | `wrangler.toml`, assets from `dist/` |
| Canonical origin | `https://reelballers.com` | `www` 301s to apex. Apex is canonical. |
| URL format | `build.format: 'file'` + `trailingSlash: 'never'` | `/soccer.html` served at `/soccer` |

### Why Astro and not the old React SPA

The site used to be a client-rendered Vite SPA. A crawler received a 1,729-byte shell with
an empty `<div id="root">` and **zero** content. Astro renders content pages to static HTML
with no client JS; only two small React islands hydrate (the before/after slider and the
tutorial modal launcher).

---

## Adding a public page

1. Create `src/pages/your-page.astro`.
2. Render through `PageLayout`:

```astro
---
import PageLayout from '../layouts/PageLayout.astro'
import Faq from '../components/Faq.astro'
import { faqPage, softwareApplication, webPage, breadcrumbs, type FaqItem } from '../lib/schema'

const path = '/your-page'
const faqs: FaqItem[] = [{ q: '...', a: '...' }]

const schemas = [
  softwareApplication(),
  webPage({ name: 'H1 text', description: '...', path }),
  breadcrumbs([{ name: 'Your Page', path }]),
  faqPage(faqs),
]
---

<PageLayout
  title="<=60 chars"
  description="<=155 chars"
  path={path}
  schemas={schemas}
  trail={[{ name: 'Your Page', path }]}
>
  <h1>...</h1>
  <p>The direct answer, 1-2 sentences, before any elaboration.</p>
  <Faq items={faqs} />
</PageLayout>
```

3. The sitemap picks it up automatically. Nothing to register.
4. Run the verifier (below) before pushing.

### Page-type conventions

| Page type | Lives in | Add data to |
|---|---|---|
| Sport landing | `src/pages/[sport].astro` | `src/data/sports.ts` |
| Camera / source | `src/pages/works-with/[camera].astro` | `src/data/cameras.ts` |
| Use case | one explicit file per URL | `src/data/useCases.ts` |
| Comparison | `src/pages/vs/[comparison].astro` | `src/data/comparisons.ts` |
| Guide (blog) | `src/pages/guides/` | `src/data/guides.ts` |

Adding a sport to `data/sports.ts` creates a whole new indexed page. Same for cameras and
comparisons. Use-case pages get an explicit file per URL so every public URL is greppable
in `src/pages/`.

> A root-level slug must never exist in **both** `data/sports.ts` and as an explicit page
> file — `[sport].astro` and e.g. `for-parents.astro` share the same URL space.

---

## Content rules (these are what actually earn citations)

1. **Answer first.** Every page opens with a 1–2 sentence direct answer to its target
   question, before elaboration. AI engines quote the first clean answer they find.
2. **Specifics, not adjectives.** "10 sports, 42 positions, 123 play types" gets quoted;
   "comprehensive sport support" never does. Numbers live in `site.ts` → `FACTS`.
3. **One source of truth.** Any factual claim on a page, in JSON-LD, or in `llms.txt` comes
   from `src/site.ts`. Three different numbers for the same fact is how you get dropped
   from an AI answer.
4. **FAQ blocks** of 4–8 real questions on every landing page, marked up as `FAQPage`.
   The visible text and the markup must match — the verifier enforces this.
5. **Honesty on integrations.** ReelBallers has **no** hardware integrations. It accepts
   uploaded video files. Never write "integrates with Veo/Trace/Hudl"; write "works with
   the file you export from them". An AI engine that finds a contradiction drops the cite.
6. **Fair comparisons.** Comparison pages must credit what the alternative does better and
   say when to choose it. That is what makes the rest credible.

### Never do this

- **Never invent testimonials, ratings, review counts, or user numbers.**
- **Never emit `AggregateRating` or `Review` JSON-LD.** We have no verifiable star
  ratings, the testimonials are anonymised, and Google excludes self-serving reviews from
  rich results. The verifier fails the build if this markup appears.
- Never add a `Disallow` for an AI crawler in `robots.txt` — see below.

---

## Structured data

Built by `src/lib/schema.ts`, merged by `BaseLayout` into a single `@graph` per page so
nodes cross-reference by `@id`.

| Type | Where | Count |
|---|---|---|
| `Organization` | every page | 30 |
| `SoftwareApplication` | every content page | 29 |
| `WebPage` | every content page | 29 |
| `BreadcrumbList` | every page with a trail | 28 |
| `FAQPage` | every page with a visible FAQ | 27 |
| `HowTo` | step-by-step pages | 17 |
| `WebSite` | homepage only | 1 |
| `ItemList` | index pages | 3 |

`SAME_AS` in `site.ts` is intentionally empty. Populate it with **real** social profile
URLs when they exist — a dead `sameAs` weakens entity resolution rather than helping.

---

## AI crawlers

`src/pages/robots.txt.ts` explicitly **allows** GPTBot, OAI-SearchBot, ChatGPT-User,
ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended,
Applebot-Extended, CCBot, meta-externalagent, Bingbot, DuckAssistBot, Amazonbot, YouBot.

This is deliberate. Being in AI training data and AI search indexes is a primary discovery
path for this product. **Do not add Disallow rules for these agents**, and do not enable
Cloudflare's "Block AI bots" / "AI Labyrinth" features on this zone — they would undo this
at the edge regardless of what `robots.txt` says.

`/llms.txt` is generated from `site.ts` + the data files, so it cannot contradict the
pages. It is the structured summary AI crawlers read.

---

## Performance

Hero video handling is the thing most likely to regress:

- Hero clips live on public R2 and are **~73 MB combined**. They are gated behind
  visibility + idle and `preload="none"`, with WebP poster frames (~45 KB) painting
  immediately. LCP is the poster, not the video.
- Save-Data connections never auto-load them.
- **If you swap the hero videos you must regenerate the posters.** See
  `docs/plans/tasks/T-hero-video-swap.md`.
- `src/config/heroMedia.ts` is the only place the hero URLs live.

Caching is set in `public/_headers`. `/_astro/*` is content-hashed and cached immutably for
a year; HTML always revalidates.

---

## Verifying before you push

```bash
cd src/landing
npm run build          # build-time guards: title/description length, missing description
node scripts/verify-seo.mjs dist
```

`verify-seo.mjs` checks every built page for: title/description presence and length,
duplicate titles or descriptions across pages, canonical, OG + Twitter tags, exactly one
`<h1>`, `<main>` and `<nav>`, valid JSON-LD, FAQ answers actually being visible in the
page text, and the banned rating/review markup. It exits non-zero on failure.

Two more (T6370): **no sitemap URL may serve `noindex`** (a sitemap entry actively asks
Google to index that URL -- a noindex page listed there contradicts itself), and **no
`<nav>` link may point at a noindex page** (the exact waste T6370 found: `/guides` was
noindex while empty, but still linked from the header nav on every page, so every crawl
of every page found a dead-end link). Both are cross-page checks, driven off the same
`noindex` computed per page -- there is nowhere else for this data to drift from.

**The CI-identical build check still applies** (see the `deploy-landing` skill): the
landing shares editor files via the `@editor` alias, and `resolve.dedupe` in
`astro.config.ts` is what makes them resolve in CI where `src/frontend/node_modules` does
not exist. Removing that line breaks the deploy but not your local build.

---

## Things only the site owner can do

Tracked separately — Search Console verification, sitemap submission, social profiles, and
directory listings. See the handoff checklist in the task write-up.

## GSC Page Indexing report: by-design buckets (T6370, 2026-08-02)

When a "Page indexing" email arrives, triage against this table first — it's the record of
which buckets are *expected* on this site and why, so re-reading it takes two minutes
instead of re-running the whole audit. Full evidence (curl output, live checks) is in
[T6370's Findings section](../../docs/plans/tasks/T6370-seo-indexing-gsc-cleanup.md#findings-verified-live-2026-08-02-curl-against-production)
— this table is a pointer to that record, not a replacement for it.

| GSC reason | Verdict | Why |
|---|---|---|
| Page with redirect | By design | `www` → apex (301), `/index.html` → `/` (307), `/soccer/` → `/soccer` (307, `trailingSlash:'never'`). GSC reports the redirecting URL as "not indexed" because the target is the indexed one. |
| Alternate page with proper canonical tag | By design (probable) | The sitemap emits the homepage as `https://reelballers.com` while the canonical is `https://reelballers.com/` — same resource (RFC 3986), cosmetic only. Confirm each reported URL resolves to a canonical we intend before dismissing. |
| Excluded by 'noindex' tag | By design, now smaller | `/guides` was noindex while `PUBLISHED_GUIDES` was empty. Fixed 2026-08-17 (T6370 Part C) by publishing the first guide — `/guides` is indexable again. Any *future* noindex page here should also be by design (check `astro.config.ts`'s sitemap filter uses the same source data). |
| Blocked due to unauthorized request (401) | **Not yet triaged** | Needs the GSC export to identify the exact URL (Part A, out of scope for T6370's implementation pass). Could not be reproduced externally as of 2026-08-02 (every probed `app.reelballers.com` path returned 200). Most likely candidate given the Part B robots.txt work: an `/api/*` route on the app host, which the app-host robots.txt (`Disallow: /` + `Allow: /shared/`) now also keeps out of the crawl anyway. |
| Discovered / Crawled - currently not indexed | Partially addressed | This was the bulk of the 40 URLs (34) and a page-authority/value problem, not a crawl-blocking bug — see T6370 Part C (sport-page content, first guide, internal linking). Re-check indexed-page count in GSC ~4 weeks after this deploys; that outcome still needs recording in the task file. |

## Known gaps

- `/guides` carries `noindex` only while `PUBLISHED_GUIDES` is empty; it flips to
  indexable automatically once a guide is published (`data/guides.ts` → `published: true`
  + `src/content/guides/{slug}.mdx`). The first guide,
  `filming-youth-sports-from-the-sideline`, published 2026-08-17 (T6370 Part C) --
  `/guides/[slug].astro` is the route, metadata lives in `data/guides.ts`, the body is
  the sibling MDX file. Four more guides are outlined in `data/guides.ts` and awaiting
  approval before their bodies get written.
- `/about` has no founder story yet; the section is deliberately absent rather than
  placeholder text.
- Pricing is stated only as "Free to start". If paid tiers become public, update
  `FACTS.pricingSummary` and `softwareApplication()`'s `offers` — those two places only.
- ~~The app at `app.reelballers.com` still serves `/*` as a 200 SPA shell...~~ Fixed
  2026-08-17 (T6370 Part B): `src/frontend/public/robots.txt` now disallows the whole app
  host except `/shared/` (public share links stay crawlable for link-preview unfurls),
  and the app shell carries `noindex,follow`. See
  `docs/plans/tasks/T6370-design.md` for the scope reasoning -- a blanket `Disallow: /`
  would have broken Slack/X/LinkedIn unfurls of `/shared/*`, which lives on that host.

## IndexNow (Bing / Yandex auto-submit)

Every deploy pings IndexNow with the live URLs, so Bing and other participating
engines re-crawl changed pages immediately instead of waiting. Google does not
participate (it uses Search Console + the sitemap).

- Key: `8bd3e9e92808827bf0fa0e10875af105`, served at
  `https://reelballers.com/8bd3e9e92808827bf0fa0e10875af105.txt`
  (`public/<key>.txt`). **This file must persist** -- if it 404s, IndexNow
  rejects submissions. The same key is hard-coded in
  `scripts/indexnow-submit.mjs`; keep the two in sync if you ever rotate it.
- Submission runs as the last step of `deploy-landing.yml`
  (`node scripts/indexnow-submit.mjs`), after `wrangler deploy`, with
  `continue-on-error: true` so it can never fail a deploy. URLs come from the
  built sitemap.
