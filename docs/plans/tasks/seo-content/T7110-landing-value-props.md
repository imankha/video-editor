# T7110: Landing homepage — sell all four value stories (copy overhaul)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-16
**Updated:** 2026-08-16

## Problem

The homepage (`src/landing/src/pages/index.astro`) sells one story well — "editing is a
grind, we remove it" — but `docs/marketing/feature-inventory.md` (2026-08-16) identifies four
sellable stories. Audit result:

| Value add | On the page today | Verdict |
|---|---|---|
| Broadcast package (core): spotlight + slow-mo + intro card + text overlays + 4K | "Elevate" names upscale/framing/highlights; slow motion, intro cards, text overlays appear nowhere on the site | Undersold |
| Share → claim loop: public link, per-recipient scope, teammate tags, claim & import | One clause ("tag teammates so everyone gets their clips") | Absent |
| Season organizes itself: auto compilations, ranking, poster library | Nothing | Absent |
| Built for kids' sports: consent gates, no biometrics, export/purge | Nothing | Absent |
| Instant payoff: annotated recaps play tonight, before any editing | Nothing | Absent |
| Transparent pricing: live cost before export, ~5¢/finished second | FAQ says only "free to start" | Undersold |

Two live claims also **overrun the feature inventory** (accuracy risk — `site.ts`'s own rule:
unverifiable claims get the site contradicted and dropped from AI answers):
- Comparison card: "Generate reels from simple queries" — no such feature exists.
- Elevate: "auto-frames to follow your player" — framing is keyframed by hand; the
  *spotlight* is what auto-detects/tracks.

## Solution

Eight copy changes (C1–C8) on the homepage plus supporting `site.ts` FACTS entries. Final
copy is embedded below — implement it verbatim unless the build verifier forces trims.

Two new sections and one strip are added. New homepage order:
hero (C1) → what-is → how-it-works (C7 verb fix) → Educate/Elevate/Celebrate (C2, C6) →
**share-loop section (C3)** → **season section (C4)** → problem card (C7) → sports grid →
testimonials → **trust strip (C5)** → FAQ (C8) → CTA.

### C1 — Hero subhead + fact chips

Replace the subhead under the `{TAGLINE}` h1:

> A spotlight that follows your player, the big moment in slow motion, their name in
> lights up front — pro highlight reels from the footage you already film.

Add a chip to the fact list in the "What is ReelBallers?" block: `Built for kids' privacy`
(C5 pays it off below the fold).

### C2 — Elevate paragraph (full broadcast stack, fixes the auto-frame overclaim)

Replace the Elevate paragraph with:

> Turn sideline footage into a broadcast package. A spotlight locks onto your player so
> nobody has to ask which kid is yours. The key touch drops to half speed. An animated
> intro card opens the reel with your athlete's name, photo, and position. AI upscaling
> keeps it crisp toward {FACTS.upscaleTarget} — even cropped-in phone video.

Add a small chip row under it: `Player spotlight · Slow motion · Intro card · Text
overlays · 4K upscale · Vertical for social`.

### C3 — NEW section: the share → claim loop

Place after the Educate/Elevate/Celebrate showcase. This is the product's only
un-copyable differentiator, and many first visits ARE shared-link recipients — the section
tells them the link they clicked is the product working.

Heading: **One parent films. Every family gets a reel.**

Three numbered steps (styled like the existing "How it works" cards):
1. Tag teammates by name as you clip — capturing their plays costs you nothing extra.
2. Drop one link in the team chat. Everyone watches tonight's highlights — no app, no signup.
3. Each family claims their player's clips into their own account and builds their own athlete's reel.

Closing line: *You film once. Ten families get their kid's season. Guess who's the most
popular parent on the sideline.*

Link target: `/for-parents` for now. (T7120 creates a dedicated
`/share-team-highlights` use-case page and re-points this link.)

### C4 — NEW section: the season builds itself

Short section after C3 (retention story; nothing on the page currently sells the fiftieth reel):

Heading: **The season builds itself**

> Every reel you publish files itself: Top Plays, per-game highlights, tournament and
> monthly compilations assemble on their own. Browse your athlete's year like a streaming
> app — and download the whole tournament as one video for the end-of-season banquet.

Quiet sub-line: *A two-minute this-or-that ranking game keeps the strongest plays in
front. (It's more fun than it should be.)*

### C5 — NEW trust strip: built for kids' sports

Directly above the closing `<Cta />` (where the last objection lives). Build as a reusable
component (`src/components/TrustStrip.astro`) — T7120 renders it on `/for-parents`,
`/recruiting-videos`, and sport pages.

Heading: **Built for kids' sports, from the ground up**

Four short chips/lines:
- Parents create every profile — with an explicit consent step
- No birthdates, no school names, no biometric data
- Export or delete everything, any time
- Price shown before every export — about a nickel per finished second

### C6 — Celebrate addition (time-to-value)

Append to the Celebrate paragraph:

> The payoff starts tonight: as soon as you've tagged the game, annotated recaps play its
> best moments back-to-back — before you've edited anything.

### C7 — Accuracy fixes

- Problem-card bullet: ~~"Generate reels from simple queries"~~ → **"Reels group themselves
  into Top Plays and tournament compilations"**.
- "How it works" step 3: ~~"crops and follows your player"~~ → **"adds the spotlight,
  upscales, and stitches it together"** (spotlight tracks; the crop follows the user's framing).

### C8 — FAQ + FACTS additions

Add three FAQ items (visible text and FAQPage markup must match — verifier enforces):

- **Is my child's data safe on ReelBallers?** — ReelBallers profiles are created by
  parents with an explicit consent step. There are no birthdate, school, or biometric
  fields, and you can export or permanently delete all of your family's data at any time.
- **Another parent filmed the game — can I still make a reel for my kid?** — Yes. When a
  filming parent shares a game with you, you can claim your player's tagged clips into
  your own account and build your own reels from them.
- **What does exporting a reel cost?** — Exports use credits and cost roughly a nickel per
  finished second of video. The exact cost shows on the Export button before you commit,
  slow motion included.

New FACTS in `src/landing/src/site.ts` (single-source rule — every new claim on the page
must trace here):
- `privacySummary`: consent-gated parent-created profiles; no birthdate, school, or
  biometric fields; full data export and deletion.
- `pricingPerSecond`: 'about 5 cents per finished second of video'.

Flow `privacySummary` into `llms.txt` and the SoftwareApplication schema description if
the generators don't pick it up automatically (check `src/pages/llms.txt.ts` and
`src/lib/schema.ts`).

## Context

### Relevant Files (REQUIRED)
- `src/landing/src/pages/index.astro` — all section changes
- `src/landing/src/site.ts` — FACTS additions
- `src/landing/src/components/TrustStrip.astro` — NEW (C5)
- `src/landing/src/lib/schema.ts` — only if softwareApplication description gains privacy claim
- `src/landing/src/pages/llms.txt.ts` (or wherever llms.txt is generated) — verify new FACTS flow through
- `src/landing/SEO.md` — read BEFORE touching anything; content rules are enforced by the verifier

### Related Tasks
- Part of: [SEO Content & Landing Value Props epic](EPIC.md) — child 1/2, sequenced after the T5140 reshoot
- Blocks: T7120 (reuses TrustStrip, re-points C3 link, adds C8 FAQs to other pages)
- Sibling: T6370 (GSC indexing cleanup — do NOT duplicate its app-subdomain work here)

### Technical Notes
- **Every claim must be verifiable in the product** (`site.ts` header rule). All copy
  above is traceable to `docs/marketing/feature-inventory.md`, which lists only live
  features. Do not embellish beyond it.
- Never emit `AggregateRating`/`Review` schema; never invent numbers. The verifier fails
  the build on both.
- This is static content in `src/landing` only — no editor/backend code. Pushing to
  master with `src/landing/**` changes auto-deploys the marketing site
  (`deploy-landing.yml`), so land the branch only when the user has approved the copy.
- The `@editor` alias / `resolve.dedupe` note in SEO.md: do not touch `astro.config.ts`.

## Implementation

### Steps
1. [ ] Read `src/landing/SEO.md` in full
2. [ ] C7 accuracy fixes (smallest, do first)
3. [ ] C1 hero subhead + chip
4. [ ] C2 Elevate rewrite + chip row
5. [ ] C6 Celebrate addition
6. [ ] C3 share-loop section
7. [ ] C4 season section
8. [ ] C5 TrustStrip component + render on homepage
9. [ ] C8 FAQs + FACTS + llms.txt/schema flow-through
10. [ ] `npm run build && node scripts/verify-seo.mjs dist` — must pass
11. [ ] Commit; leave branch for user review (copy approval = merge gate)

### Progress Log

**2026-08-16**: Task filed from the marketing proposal (artifact: "Selling the whole
product"). Copy finalized in this file; artifact is reference-only.

## Acceptance Criteria

- [ ] All 8 changes implemented with the copy above
- [ ] Both overclaims removed; no new claim lacks a feature-inventory source
- [ ] New FAQ text identical in visible HTML and FAQPage JSON-LD
- [ ] `verify-seo.mjs` passes on the built site
- [ ] TrustStrip is a reusable component, rendered on the homepage only (T7120 does the rest)
- [ ] No changes outside `src/landing/`
