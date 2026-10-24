# Landing Hero Redesign (reelballers.com first screen)

**Status:** TODO
**Started:** 2026-10-24
**Impact:** 8
**Complexity:** 4

## Goal

The first screen at reelballers.com makes a visitor understand the value prop in three seconds and feel good about it: one headline about the outcome, one honest subline that names the magic ("AI focus") without overclaiming, the primary button above the fold on desktop and before any media on phones, pricing said once and quietly.

## Decision record (2026-10-24)

Decision artifact with live previews at the real fold: https://claude.ai/artifact/WFcFDoGNHHnUMmXmTziwrp
Full agent analysis, fold arithmetic, contrast ratios and all copy variants: [design-notes.md](design-notes.md).

Owner chose **direction A ("Spotlight") look + copy set 1b**:

| Slot | Final |
|------|-------|
| Eyebrow | none |
| H1 | Game film in. **Sharp** highlight out. ("Sharp" is the only accented word; forced line break after "in." at `lg`+) |
| Subline | Any video source. You frame your athlete; AI focus smooths, spotlights and upscales. |
| Primary CTA | Start free |
| Ghost link | See how it works |
| Trust line | Free to start. No subscription. Pay only for the AI you use. |
| Before / After pills | Your footage / In focus |
| Display face | Plus Jakarta Sans 800 (H1 only); body stays on the system stack |
| Accent | amber-300 word, amber-400 button with slate-950 text; header button follows. Fallback if the owner changes their mind: brand purple (purple-300 word, existing gradient button). Accent word and button always share one hue. |
| Layout | Two columns at `lg`+ (copy left, phone right, 300x533 frame); stacked and centered at `md`; on phones copy, button, then the phone (`max-w-[300px]`) |

Measured costs of the current hero at 1592x785 that this epic removes: ~153px header (stacked "Reel / Ballers" lockup, banned by the style guide), primary button ~1000px from the top (about 1300px on phones), four text blocks (~50 words) with pricing said twice.

## Copy rules (owner rules, apply to every word shipped)

- Never claim autonomous framing or tracking. The user frames the athlete; the AI smooths motion, adds the spotlight, upscales. "AI focus" is lowercase and reads as what happens after the user frames.
- "AI focus" is NOT a feature name. The in-app mode is "Framing" (header verb "Frame", `src/frontend/src/config/displayNames.js` MODE_NAMES, T9860); a Title Case "AI Focus" would promise a feature a new user cannot find.
- One finished clip is a "highlight"; "highlight reel" is a collection.
- No em dashes. No camera brand names in the hero ("any video source"). Not limited to youth sports.
- Pricing truthfully, once: free to start, no subscription, pay only for the AI you use.

## Tasks (in order)

| ID | Task | Status |
|----|------|--------|
| T13340 | [Horizontal logo lockup in the landing header](T13340-horizontal-logo-lockup.md) | TODO |
| T13350 | [Hero: Spotlight layout, set 1b copy, Plus Jakarta Sans, amber accent](T13350-hero-spotlight-set-1b.md) | TODO |

T13340 goes first: every fold number in T13350 assumes the 73px header.

## Shipping

The landing deploys by landing on `master` (`.github/workflows/deploy-landing.yml` fires on `src/landing/**`, see the `deploy-landing` skill, including its CI-identical build pre-flight). It does not wait for the app's Deploy Candidate. Landmine: a landing push ships EVERYTHING under `src/landing` that is on master; check for unshipped landing changes from other milestones (Pricing Rebalance's worked example) before merging.

## Completion Criteria

- [ ] Header is a single row with a 40px emblem and a one-line wordmark on every landing page
- [ ] Hero shows set 1b copy exactly, no caption under the slider, no bold pricing line
- [ ] At 1592x785 the primary button and the whole phone frame are visible without scrolling (real screenshot, not arithmetic)
- [ ] At 390x844 the primary button appears before the phone frame
- [ ] `TAGLINE` constant, meta description and schema unchanged; about page still renders the tagline
- [ ] `astro check` and the CI-identical build pass; live on reelballers.com
