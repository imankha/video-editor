# Landing Page Redesign

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Rebuild reelballers.com to fix the biggest conversion problems: no CTA above the fold, weak hero, and no sticky mobile CTA. Alpha scope focuses on the three highest-impact changes (hero, nav, visual refresh). Polish tasks (more before/after examples, how-it-works, feature tile cut, sample reels, FAQ/footer) deferred to For Launch. Pricing section dropped entirely -- freemium model, no need to show pricing on the landing page.

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

### Alpha (must ship)

| ID | Task | Status |
|----|------|--------|
| T2300 | [Visual Foundation & Design System](T2300-visual-foundation.md) | TODO |
| T2310 | [Sticky Nav & CTA System](T2310-sticky-nav-cta.md) | TODO |
| T2320 | [Hero Section](T2320-hero-section.md) | TODO |

### For Launch (polish)

| ID | Task | Status |
|----|------|--------|
| T2330 | [Before/After Examples](T2330-before-after-section.md) | TODO |
| T2340 | [How It Works Section](T2340-how-it-works.md) | TODO |
| T2350 | [Features Section Redesign](T2350-features-redesign.md) | TODO |
| T2360 | [Sample Reels Grid](T2360-sample-reels-grid.md) | TODO |
| T2380 | [FAQ, Final CTA & Footer](T2380-faq-cta-footer.md) | TODO |

### Dropped

| ID | Task | Reason |
|----|------|--------|
| T2370 | [Positioning & Pricing](T2370-positioning-pricing.md) | Freemium model -- no need to show pricing on landing page |

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

### Alpha
- [ ] CTA visible above the fold on both mobile and desktop
- [ ] New hero with "From Upload to IG in 5 minutes." headline
- [ ] Mobile sticky bottom CTA bar
- [ ] Visual refresh (navy palette, new typography)
- [ ] Deployed to reelballers.com

### For Launch
- [ ] More before/after examples (diverse positions)
- [ ] How it works section with real UI screen recordings
- [ ] Features cut from 6 to 4 with new copy
- [ ] Sample reels grid with 8+ real reels (including defenders/keepers)
- [ ] FAQ accordion + final CTA + footer redesign
- [ ] Page loads fast on mobile (lazy load videos below fold)
