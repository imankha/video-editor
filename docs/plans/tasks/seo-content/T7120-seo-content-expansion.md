# T7120: SEO content expansion — comparison pages, use-case & privacy pages, guide bodies

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-08-16
**Updated:** 2026-08-16

## Problem

The marketing site's technical SEO layer is strong (static Astro, JSON-LD @graph,
llms.txt from a single source of truth, IndexNow, build verifier), but **content coverage
is thin** — and thin/duplicative content is exactly what T6370 diagnosed as the cause of
"crawled, currently not indexed":

- `/vs/` covers only `editing-by-hand` and `capcut`. The highest-intent searches in this
  niche are brand comparisons (Hudl, Veo, Trace) and "the free editor I already have"
  (iMovie). All missing.
- The share→claim loop and the kids'-privacy stance (the two strongest differentiators,
  per `docs/marketing/feature-inventory.md`) have no citable deep page. When someone asks
  an AI engine "is ReelBallers safe for kids?", there is no page to quote.
- Five guides exist as approved-format outlines in `src/landing/src/data/guides.ts`, all
  `published: false`, so `/guides` is noindex and the site has zero long-tail content.
  Every draft targets a real query ("how long should a recruiting video be", "how to make
  a highlight reel for free", ...).
- Tutorial videos play on the homepage with no `VideoObject` markup.

## Solution

Four phases, all in `src/landing`. Phases A–C are ready to implement; Phase D is gated on
the owner approving guide outlines (see `docs/marketing/seo-owner-checklist.md`).

### Phase A — Comparison pages (data-driven, existing template)

Add to `src/landing/src/data/comparisons.ts` (each entry auto-creates `/vs/{slug}` via
`src/pages/vs/[comparison].astro`):

1. `hudl` 2. `veo` 3. `trace` 4. `imovie`

Content rules (from `SEO.md`, enforced by credibility not just the verifier):
- **Honest framing is the strategy**: Hudl/Veo/Trace are camera/team-video systems;
  ReelBallers edits footage you already have. Credit what they do better (full-match
  auto-capture, team analytics) and say plainly when to choose them. That honesty is what
  earns the AI citation.
- Never claim an integration. The truthful line: "export the video file from
  Veo/Trace/Hudl and it works here" — and cross-link the existing
  `/works-with/veo`, `/works-with/trace` pages.
- Answer-first opening (1–2 sentences), 4–8 real FAQs with matching FAQPage markup.
- Mirror the structure/tone of the existing `capcut` entry — study it before writing.

### Phase B — Use-case page + privacy page

1. **`/share-team-highlights`** — explicit page file (use-case convention:
   `src/data/useCases.ts` + one file per URL). Target query: "how to share team
   highlights with parents". Content: the film-once → one link in the team chat →
   each family claims their player's clips → builds their own reel loop, with the
   per-recipient-scope and no-signup-to-watch facts. This gives the homepage C3 section
   (T7110) its deep link.
2. **`/kids-privacy`** — explicit page. Target query: "is ReelBallers safe for kids" /
   "youth sports video privacy". States in full: parent-created consent-gated profiles;
   no birthdate/school/biometric fields; full export and deletion; footage stays private
   until a parent shares it. Sources: `FACTS.privacySummary` (added in T7110).
   Renders `TrustStrip.astro` + the privacy FAQ items.
3. **Slug-collision check** (SEO.md rule): a root-level slug must not exist in both
   `data/sports.ts` and as an explicit page file. Neither `share-team-highlights` nor
   `kids-privacy` collides with a sport slug — verify at build anyway.

### Phase C — Internal linking + component reuse

- Re-point the homepage C3 section link from `/for-parents` to `/share-team-highlights`;
  link the C5 trust strip heading to `/kids-privacy`.
- Render `TrustStrip.astro` (created in T7110) on `/for-parents`,
  `/recruiting-videos`, and the `[sport].astro` template.
- Add the C8 privacy + claim-and-import FAQ items to `/for-parents` and sport pages
  (per-page FAQPage schema multiplies the citable surface). This also increases per-page
  unique text on the sport family — directly serving T6370's Part C (~70% boilerplate
  across sport pages is the indexing blocker).
- Descriptive anchor text everywhere ("share team highlights with every parent", not
  "learn more").

### Phase D — Guide bodies (OWNER-GATED: outlines need approval first)

Per the header comment in `data/guides.ts`, outlines await owner approval. For each
approved outline:
1. Write the body at `src/content/guides/{slug}.mdx`, following the approved outline
   headings exactly; the `answer` field runs verbatim under the H1 (answer-first rule).
2. Flip `published: true`, set `datePublished`/`dateModified`.
3. First publish automatically lifts the `/guides` noindex and enters the sitemap.

Practical, specific, honest content — the guides are useful-first (filming advice,
recruiting-video norms), with ReelBallers mentioned only where genuinely relevant.
1200–2000 words each. If only some outlines are approved, publish those; do not block the
phase on all five.

### Phase E (optional, smallest) — VideoObject markup

Add a `videoObject()` builder to `src/lib/schema.ts` (name, description, thumbnailUrl,
duration, contentUrl, uploadDate) and attach it on pages that render tutorial videos.
Benefit is modest but real: video rich-result eligibility (thumbnail + duration in
search listings). Skip if time-boxed out — do not let it delay Phases A–C.

## Context

### Relevant Files (REQUIRED)
- `src/landing/src/data/comparisons.ts` — Phase A entries
- `src/landing/src/data/useCases.ts` + new explicit page files — Phase B
- `src/landing/src/pages/share-team-highlights.astro` — NEW
- `src/landing/src/pages/kids-privacy.astro` — NEW
- `src/landing/src/content/guides/*.mdx` — NEW (Phase D)
- `src/landing/src/data/guides.ts` — publish flips
- `src/landing/src/pages/index.astro`, `for-parents.astro`, `recruiting-videos.astro`, `[sport].astro` — Phase C links/reuse
- `src/landing/src/components/TrustStrip.astro` — from T7110
- `src/landing/src/lib/schema.ts` — Phase E
- `src/landing/SEO.md` — read BEFORE anything

### Related Tasks
- Part of: [SEO Content & Landing Value Props epic](EPIC.md) — child 2/2, sequenced after Milestone TOP completes (not merely after the T5140 reshoot — see the epic's Sequencing note)
- Depends on: T7110 (TrustStrip component, FACTS entries, homepage sections to re-point)
- Sibling: T6370 — **do not duplicate**: app-subdomain robots/soft-404 work, GSC
  cleanup, and index-request submission belong to T6370. This task feeds T6370's Part C
  (page value / boilerplate reduction) from the content side.
- Owner gate: `docs/marketing/seo-owner-checklist.md` (guide-outline approval, YouTube
  channel, Search Console, social profiles)

### Technical Notes
- Every page through `PageLayout` (unique title ≤60 chars, description ≤155, canonical,
  one h1, FAQ text matching markup). The sitemap picks new pages up automatically.
- Never `AggregateRating`/`Review`; never fabricate user counts or ratings.
- Facts come from `site.ts` FACTS only — if a new number is needed, add it there first.
- Guides need `article()` schema with real `dateModified` (freshness signal).
- Verify with `npm run build && node scripts/verify-seo.mjs dist` before pushing.
- Landing deploys automatically on master push touching `src/landing/**`.

## Implementation

### Steps
1. [ ] Read `SEO.md`, the `capcut` comparison entry, and one existing use-case page
2. [ ] Phase A: 4 comparison entries
3. [ ] Phase B: 2 new pages + slug-collision check
4. [ ] Phase C: links + TrustStrip/FAQ reuse across pages
5. [ ] Phase D: guide bodies for every outline the owner has approved (check checklist status; skip cleanly if none yet)
6. [ ] Phase E: videoObject() if within budget
7. [ ] Build + verify-seo green; commit; branch for user copy review

### Progress Log

**2026-08-16**: Task filed from the marketing proposal (artifact: "Selling the whole
product"). Phases A–C unblocked; D awaiting outline approval; E optional.

## Acceptance Criteria

- [ ] `/vs/hudl`, `/vs/veo`, `/vs/trace`, `/vs/imovie` live, honest-framing rules followed, works-with cross-links present
- [ ] `/share-team-highlights` and `/kids-privacy` live; homepage links re-pointed
- [ ] TrustStrip + privacy/claim FAQs rendered on `/for-parents`, `/recruiting-videos`, sport pages
- [ ] Approved guides published with bodies; `/guides` noindex lifted iff ≥1 published
- [ ] `verify-seo.mjs` passes; no duplicate titles/descriptions across the new pages
- [ ] No changes outside `src/landing/`
