# Landing Page Redesign

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Rebuild reelballers.com from the ground up to fix four critical conversion problems: no CTA above the fold, no visual proof (before/after), no pricing, and redundant feature tiles. The new page puts a CTA above the fold, leads with before/after video proof, shows pricing as a competitive advantage, and cuts features from 6 tiles to 4 (each mapping to a gap vs Veo/Trace).

## Supersedes

- **T445** (Landing Page Before/After Clips) -- absorbed into T2330
- **T1920** (Landing Page Update) -- absorbed into this epic (tutorial video + PWA install can be added as follow-ups)

## Design Spec

Full spec: [reelballers-landing-page-spec.md](../../../../reelballers-landing-page-spec.md) (in Downloads, also saved to Obsidian)

### Key Decisions (Locked)

- **Headline:** "From Upload to IG in 5 minutes." (with period)
- **CTA copy:** "Make my first reel -- free" (hero), "Try it on your own clip" (mid), "Make the reel" (final)
- **Features:** Cut from 6 to 4 -- tracking, upscaling, format flexibility, pay-per-reel
- **Accent color:** Field green or sharp orange (not saturated purple)
- **No "AI" in headlines** -- it appears only in body copy where useful
- **Mobile-first** -- 75-85% of traffic is mobile
- **7 CTAs on page** (8 with mobile sticky bottom bar) -- user never scrolls up to take action
- **Sample reels must include defenders and keepers** -- not just goals

## Tasks

| ID | Task | Status |
|----|------|--------|
| T2300 | [Visual Foundation & Design System](T2300-visual-foundation.md) | TODO |
| T2310 | [Sticky Nav & CTA System](T2310-sticky-nav-cta.md) | TODO |
| T2320 | [Hero Section](T2320-hero-section.md) | TODO |
| T2330 | [Before/After Section](T2330-before-after-section.md) | TODO |
| T2340 | [How It Works Section](T2340-how-it-works.md) | TODO |
| T2350 | [Features Section Redesign](T2350-features-redesign.md) | TODO |
| T2360 | [Sample Reels Grid](T2360-sample-reels-grid.md) | TODO |
| T2370 | [Positioning & Pricing](T2370-positioning-pricing.md) | TODO |
| T2380 | [FAQ, Final CTA & Footer](T2380-faq-cta-footer.md) | TODO |

## Page Architecture

```
Nav (sticky) ............... T2310
Hero ....................... T2320
Before/After ............... T2330
How It Works (3 steps) ..... T2340
Features (4 tiles) ......... T2350
Sample Reels Grid .......... T2360
Why It's Different ......... T2370
Pricing .................... T2370
FAQ ........................ T2380
Final CTA .................. T2380
Footer ..................... T2380
```

## CTA Placement Map

| Location | Copy | Task |
|----------|------|------|
| Nav (sticky) | **Try it free** | T2310 |
| Hero | **Make my first reel -- free** | T2320 |
| After before/after | Try it on your own clip | T2330 |
| End of "Why it's different" | See pricing (text link) | T2370 |
| Pricing packs | Buy [pack name] | T2370 |
| Below pricing | Or try it free first | T2370 |
| Final CTA | **Make the reel** | T2380 |
| Mobile sticky bottom bar | **Try it free** | T2310 |

## Technical Context

- Landing page source: `src/landing/` (React 18 + Vite + Tailwind)
- Deployed via Cloudflare Pages (GitHub Actions trigger on `src/landing/**`)
- Current components: `App.tsx` (194 lines), `Logo.tsx`, signup function
- Existing assets: `before_after_demo.mp4`, `favicon.svg`

## Completion Criteria

- [ ] All 9 tasks complete
- [ ] CTA visible above the fold on both mobile and desktop
- [ ] Before/after section with real synced video loops
- [ ] Pricing section with 3 credit packs
- [ ] Features cut from 6 to 4 with new copy
- [ ] Sample reels grid with 8+ real reels (including defenders/keepers)
- [ ] Mobile sticky bottom CTA bar
- [ ] Page loads fast on mobile (lazy load videos below fold)
- [ ] Deployed to reelballers.com
