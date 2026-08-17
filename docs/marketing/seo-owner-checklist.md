# SEO / Marketing — Owner-Gated Checklist

Actions only the site owner can take. Kept separate from the AI-implementable tickets
(T7110 homepage copy, T7120 SEO content, T6370 indexing cleanup) because no agent can do
these. Check items off here; several unblock ticket phases.

## Unblocks ticket work

- [ ] **Approve the five guide outlines** in `src/landing/src/data/guides.ts` (or edit,
  then approve). Each guide's `title`, `targetQuery`, `answer`, and `outline` are the
  contract for the body. → Unblocks T7120 Phase D (bodies get written and published;
  first publish lifts the `/guides` noindex).
- [ ] **Approve homepage copy** on the T7110 branch before it merges (master push
  auto-deploys the marketing site).

## Google Search Console (also referenced by T6370)

- [ ] Verify the `reelballers.com` property (DNS TXT or HTML-file method).
- [ ] Submit `https://reelballers.com/sitemap-index.xml`.
- [ ] After T7110/T7120 deploy, use "Request indexing" on the changed/new URLs —
  IndexNow (already automated on deploy) covers Bing, **not Google**.
- [ ] Export the full GSC coverage report and attach it to T6370 (its 401 finding could
  not be reproduced externally and needs the export).

## Entity / social profiles

`SAME_AS` in `src/landing/src/site.ts` is deliberately empty — a dead profile link hurts
entity resolution. As each REAL profile goes live, tell the AI to add its URL:

- [ ] Instagram
- [ ] TikTok
- [ ] YouTube channel — highest leverage of the four: the tutorial videos already exist,
  so this is upload work, not production work. A real channel also gives the site a
  presence in video search and gives T7120 Phase E (`VideoObject` markup) public URLs to
  reference. Channel name exactly "ReelBallers", link back to `https://reelballers.com`.
- [ ] LinkedIn (company page)

Consistency rule everywhere: always "ReelBallers" (never "Reel Ballers"), always the apex
`https://reelballers.com`.

## Listings / off-site

- [ ] Youth-sports and sports-tech directory listings (consistent name + URL + the
  one-sentence DEFINITION from `site.ts`).
- [ ] Ask early users for testimonials that may be attributed with real names (current
  ones are anonymised by necessity; attributed quotes are stronger and could eventually
  support review markup from a third-party platform — never self-hosted ratings).

## Deliberately NOT owner work (already automated or ticketed)

- Sitemap generation, llms.txt, IndexNow pings — automatic on every deploy.
- robots.txt / soft-404 fixes on `app.reelballers.com` — T6370.
- All page/copy/schema changes — T7110 / T7120.
