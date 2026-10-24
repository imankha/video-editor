# T13350: Hero: Spotlight layout, set 1b copy, Plus Jakarta Sans, amber accent

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Tier:** M (landing only, one layer, no new abstractions; ~7 files but every change is display or copy. Design gate already passed: the decision artifact below is the approved design.)
**Created:** 2026-10-24
**Updated:** 2026-10-24
**Milestone:** Landing Hero Redesign, see [EPIC.md](EPIC.md)

## Problem

The hero at reelballers.com (`src/landing/src/pages/index.astro:121-161`) puts a 12-word,
three-line 60px headline that sells mechanism ("high-quality", "using AI upscaling") over a
405x720 phone frame, with the primary button and a 19-word bold pricing line BELOW the phone.
On a 1592x785 desktop the button is about 1000px from the top; on a 390px phone about 1300px.
Four text blocks (~50 words) compete, pricing is said twice, and the slider caption repeats the
Before/After pills. The owner's read: too many words upfront and unbalanced white space create
anxiety. Full measurement and the three directions weighed: [design-notes.md](design-notes.md).

## Solution

Direction A ("Spotlight") look with copy set 1b, as chosen by the owner on 2026-10-24
(https://claude.ai/artifact/WFcFDoGNHHnUMmXmTziwrp, "Set 1b" + "Amber accent" selected).

### Copy (exact, no changes without owner sign-off)

| Slot | Text |
|------|------|
| Eyebrow | none |
| H1 | `Game film in.<br class="hidden lg:block"> <span class="text-amber-300">Sharp</span> highlight out.` |
| Subline | Any video source. You frame your athlete; AI focus smooths, spotlights and upscales. |
| Primary CTA | Start free |
| Ghost link | See how it works (keeps `href="#how-heading"`) |
| Trust line | Free to start. No subscription. Pay only for the AI you use. |
| Before / After pills | Your footage / In focus |

Removed: the slider caption ("Same play, same phone. ..."), the bold white pricing paragraph under
the buttons, and the existing subline. The hero `aria-label` (`heroMedia.ts` `alt`) stays as is.

Constants: add `HERO_HEADLINE`-style constants in `src/landing/src/site.ts` beside `TAGLINE`, with
a comment that they are the on-page hero copy and may be more human than the brand tagline.
**`TAGLINE` is unchanged**: it still feeds `about.astro:62` and the wording of the index meta
description literal (`index.astro:112`); schema uses `DEFINITION`. The `<title>` is unchanged.

### Type

- Plus Jakarta Sans 800 for the H1 only. In `BaseLayout.astro` `<head>` (the only place the head is built): `<link rel="preconnect" href="https://fonts.googleapis.com">`, `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`, then `https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@800&display=swap`.
- `tailwind.config.js`: `theme.extend.fontFamily.display = ['"Plus Jakarta Sans"', ...system stack]`.
- H1: `font-display font-extrabold tracking-[-0.02em] leading-[1.05] text-[2.5rem] md:text-5xl lg:text-[3.25rem] text-white`. Body text stays on the system stack (`index.css`).

### Color

- Accent word `text-amber-300` (#fcd34d, 12.4:1 on slate-900).
- Primary button: `bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-full px-7 py-3 shadow-lg shadow-amber-500/20` (12.1:1). The header button in `Header.astro:35-41` takes the same fill so the page has one primary color. The in-app CTA stays cyan; this is a landing decision only.
- Ghost link unchanged (`bg-white/5 border-white/15`).
- Subline `text-lg md:text-xl text-gray-300 leading-relaxed max-w-[34ch]`; trust line `text-sm text-slate-400` (7.0:1; never gray-500, which fails AA).
- Glow behind the phone: an absolutely positioned, `-z-10`, `pointer-events-none` ellipse about 1.4x the frame with `radial-gradient(closest-side, rgba(251,191,36,0.16), rgba(168,85,247,0.10) 55%, transparent 75%)`.

### Layout

- Section `container mx-auto px-4 pt-10 lg:pt-14 pb-12`.
- `lg`+: `grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-12 max-w-6xl mx-auto`. Copy column: H1 `mb-5`, subline `mb-8`, button row `flex flex-wrap gap-3 mb-4` with the PRIMARY FIRST in DOM order, then the trust line. Phone column: frame 300x533.
- `md` (768 to 1023): stacked and centered (`max-w-2xl`), phone 300x533 below the copy. Two columns at `md` would force a four-line headline.
- Phones: H1, subline, primary button (full width, `min-h-[52px]`), ghost link, trust line, then the phone at `max-w-[300px] mx-auto`.
- `BeforeAfterSlider.tsx`: remove the wrapper `mb-16` (line 212; spacing belongs to the page), make the desktop frame size a prop (line 217 hard-codes `md:w-[405px] md:h-[720px]`), make the pill labels props (lines 276-287) with "Before"/"After" defaults so other callers are unaffected.

## Context

### Relevant Files (REQUIRED)
- `src/landing/src/pages/index.astro` - hero markup lines 121-161; meta description literal line 112 (unchanged)
- `src/landing/src/site.ts` - `TAGLINE` line 27 (unchanged), new hero copy constants, `FACTS.pricingSummary` line 69
- `src/landing/src/components/BeforeAfterSlider.tsx` - `mb-16` line 212, frame size line 217, pills lines 276-287
- `src/landing/src/components/Header.astro` - header button fill lines 35-41
- `src/landing/src/layouts/BaseLayout.astro` - font preconnect + stylesheet link in `<head>`
- `src/landing/tailwind.config.js` - `fontFamily.display`
- `src/landing/src/config/heroMedia.ts` - `alt` stays; read for the poster paths

### Related Tasks
- Depends on: T13340 (73px header; all fold numbers assume it)
- Related: T7110 (homepage value-props overhaul, TODO) rewrites sections BELOW the hero; it must not reintroduce a hero subline or pricing line. T12780 (STAGING) removed the hero's `data-tutorial` trigger; do not add a video promise back.

### Technical Notes
- Copy rules in [EPIC.md](EPIC.md) are owner rules. "AI focus" lowercase; the user frames, the AI smooths, spotlights, upscales.
- Fold numbers (button at ~440px, phone fully inside 785px) were computed from Tailwind spacing and glyph widths. They are a target, not evidence: the acceptance criteria require real screenshots.
- UX rule: live-verify phone and desktop before handing over ("nothing should be hard to see").
- Landing has no unit tests. Verification is `npm run check` (astro check), the CI-identical build from the `deploy-landing` skill (frontend `node_modules` absent), and Playwright screenshots against `astro preview`.
- Landmine: pushing `src/landing/**` to master deploys the whole landing directory. Check for unshipped landing changes from other milestones before merging.

## Implementation

### Steps
1. [ ] `T13340` merged (header at 73px)
2. [ ] Add hero copy constants to `site.ts`; leave `TAGLINE` untouched
3. [ ] Font: preconnects + stylesheet link in `BaseLayout.astro`, `fontFamily.display` in Tailwind config
4. [ ] `BeforeAfterSlider.tsx`: frame-size prop, pill-label props, drop `mb-16`
5. [ ] Rewrite the hero section in `index.astro` per Layout above; delete caption and pricing paragraph; primary button first in DOM
6. [ ] Header button to the amber fill
7. [ ] `npm run check`; CI-identical build in a clean worktree
8. [ ] Playwright screenshots against `astro preview`: 1592x785 and 390x844; attach to the PR and record measured positions in the Progress Log
9. [ ] Land on master per the `deploy-landing` skill; confirm the live page

### Progress Log

**2026-10-24**: Filed from the hero review. Owner picked direction A look + set 1b, amber accent.

## Acceptance Criteria

- [ ] Hero text is exactly the set 1b copy above; no caption under the slider; no pricing paragraph; pills read "Your footage" / "In focus"
- [ ] H1 renders in Plus Jakarta Sans 800 with "Sharp" in amber-300; falls back to the system stack cleanly if the font fails to load
- [ ] Primary "Start free" button is first in DOM order and uses the amber fill; header button matches
- [ ] Real screenshot at 1592x785: primary button fully visible and the whole phone frame (both pills and the handle) inside the viewport
- [ ] Real screenshot at 390x844: the primary button is reachable before the phone frame
- [ ] `TAGLINE`, meta description, `<title>`, schema and the about page are unchanged (diff shows no change to those lines)
- [ ] Trust line uses slate-400 (AA 7.0:1); no hero text below 4.5:1
- [ ] `astro check` and the CI-identical build pass; the live page matches the screenshots
