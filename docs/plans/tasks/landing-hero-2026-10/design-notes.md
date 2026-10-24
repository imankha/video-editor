# Hero options for reelballers.com (landing, Astro + Tailwind)

Status: DRAFT proposal, no source files edited. Design-gated: implement only after the owner picks a direction.

Sources read: `src/landing/src/pages/index.astro:110-165`, `src/landing/src/site.ts:20-75`, `Header.astro`, `Logo.tsx`, `BeforeAfterSlider.tsx:200-340`, `BaseLayout.astro`, `index.css`, `.claude/references/ui-style-guide.md`. Plus one grep for `TAGLINE` / `HERO_MEDIA` usages.

---

## 0. What the code says the real problems are

Measured against a 1592x785 viewport (fold = 785px).

| # | Finding | Where | Cost |
|---|---------|-------|------|
| 1 | **Header is ~153px tall** because `LogoWithText` is the stacked `w-[80px]` column (text-xl "Reel" / 64px emblem / text-xl "Ballers" = ~120px + py-4). The app style guide explicitly bans this lockup ("a wrap accident, banned") in favour of a 40px emblem beside a single-line wordmark (~72px header). | `Logo.tsx:50-58`, `Header.astro:12-13` | ~80px of fold on every page. Biggest single win, zero copy risk. |
| 2 | H1 lives in `max-w-3xl` (768px) at 60px bold: 78 characters cannot fit in fewer than 3 lines there. | `index.astro:122-123` | ~190px of fold. |
| 3 | `BeforeAfterSlider` hard-codes `mb-16` on its own wrapper, then the page adds a caption `mt-4`, then CTAs `mt-4`, then the pricing line `mt-4`. Layout margin inside a leaf component plus three stacked `mt-4` blocks is the "unbalanced white space" the owner feels. | `BeforeAfterSlider.tsx:212`, `index.astro:138-160` | 64px dead band under the phone; four ragged text blocks. |
| 4 | Pricing is said twice (subline "no subscription" + 19-word bold white line). The bold white treatment makes a trust line compete with the H1. | `index.astro:125, 158-160` | Noise; the eye has no anchor. |
| 5 | Caption duplicates the slider's `aria-label` and the Before/After pills. | `index.astro:138-140`, `heroMedia.ts:29` | 14 words. |
| 6 | Mobile: the phone is full-width `aspect-[9/16]` (~650px tall on a 390px phone) and the primary CTA sits below it, below the mobile nav row too. | `BeforeAfterSlider.tsx:217` | CTA ~1300px down on phones; this audience is mobile-heavy. |
| 7 | Primary CTA is BELOW the phone on every breakpoint, after a ghost link that comes first in DOM order (ghost renders left of primary). | `index.astro:143-157` | CTA ~1000px down on desktop. Primary should be first in DOM (app CtaBar rule). |

Contrast facts used below (WCAG, against body `bg-slate-900` #0f172a, relative luminance 0.0088):

| Colour | Hex | Ratio | Verdict (normal text needs 4.5:1, large/bold >= 24px needs 3:1) |
|--------|-----|-------|------|
| gray-300 | #d1d5db | 12.1:1 | pass |
| slate-300 | #cbd5e1 | 12.0:1 | pass |
| gray-400 | #9ca3af | 7.0:1 | pass |
| slate-400 | #94a3b8 | 7.0:1 | pass |
| gray-500 | #6b7280 | 3.7:1 | **FAIL** for a trust line; never use for hero body text |
| amber-300 | #fcd34d | 12.4:1 | pass |
| cyan-400 | #22d3ee | 9.9:1 | pass |
| purple-300 | #d8b4fe | 10.1:1 | pass |
| white on purple-600 / indigo-600 (current CTA gradient ends) | #9333ea / #4f46e5 | 5.4:1 / 6.3:1 | pass (so the brand CTA is NOT a contrast failure; it is a salience problem) |
| slate-950 text on cyan-500 (app primary CTA) | #020617 on #06b6d4 | 8.3:1 | pass |
| slate-950 text on amber-400 | #020617 on #fbbf24 | 12.1:1 | pass |

Fold arithmetic assumes the horizontal lockup (header 73px incl. border) in all three directions. Keeping the stacked logo costs each direction ~80px and pushes the slider knob below the fold in direction C and the minimal variant.

Shared mechanics (all directions):

- Web fonts: add to `BaseLayout.astro` head: `<link rel="preconnect" href="https://fonts.googleapis.com">` and `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` before the family link; always `display=swap`; load only the listed weights. Self-host alternative when ready: `@fontsource` packages imported in `index.css` (no third-party request, better LCP). Register the display face in the landing Tailwind config under `theme.extend.fontFamily.display` and use `font-display` on the H1 only; body stays on the system stack in `index.css` unless noted.
- `BeforeAfterSlider` needs two prop-driven changes in every direction: remove the wrapper `mb-16` (line 212, move spacing to the page) and make the desktop frame size a prop (`md:w-[405px] md:h-[720px]` on line 217 becomes the size the direction specifies). Mobile gets `max-w-[300px] mx-auto` on the frame so the phone is ~533px tall instead of ~650px.
- DOM order: primary CTA first, then ghost link (CtaBar rule: primary is first DOM child and first visual position).
- The hero caption (`index.astro:138-140`) is removed in every direction; its meaning moves into the Before/After pill labels, and the long form stays in the slider `aria-label`.

---

## Direction A: "Spotlight"

**Intent:** Warm and personal. The headline is about the parent's athlete, not the software. One warm accent (the spotlight the product literally adds) on a navy field; purple survives as logo and ambient glow.

### Copy

| Slot | Text | Words |
|------|------|-------|
| Eyebrow (optional) | For youth sports parents | 4 |
| H1 | Your athlete, **in focus**. Shareable in minutes. | 7 |
| Subline | Mark the plays, frame your athlete. ReelBallers smooths, spotlights and upscales to a crisp HD highlight. | 16 |
| Primary CTA | Make your first highlight | 4 |
| Ghost link | See how it works | 4 |
| Trust line | Free to start. No subscription. Pay only for the AI you use. | 12 |
| BEFORE / AFTER pills | Your footage / In focus | 2 / 2 |

Words before the CTA: 27 (currently 37 plus the 14-word caption). Claims check: user frames ("frame your athlete"), AI smooths/spotlights/upscales; "highlight" singular; no autonomous tracking; pricing once, muted. "Credits never expire" is left to the pricing section (or swap the trust line for `FACTS.pricingSummary` verbatim at 22 words if the owner wants all four pricing facts in the hero).

### Font

- Display: **Plus Jakarta Sans** 800 (H1) and 700 (eyebrow). Body: system stack (unchanged).
- `<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap" rel="stylesheet">`
- H1: `font-display font-extrabold tracking-[-0.02em] leading-[1.05] text-[2.5rem] md:text-5xl lg:text-[3.25rem]` (40 / 48 / 52px). Plus Jakarta is a wide face; 52px in a ~615px column keeps "Your athlete, in focus." on one line and "Shareable in minutes." on the second.
- Eyebrow: `font-display text-xs md:text-sm font-bold uppercase tracking-[0.18em] text-amber-300/90`.
- Subline: `text-lg md:text-xl text-gray-300 leading-relaxed max-w-[34ch]`.

### Colour

- Background: body `bg-slate-900` (#0f172a), unchanged.
- H1: `text-white`; the two words "in focus" wrapped in `<span class="text-amber-300">` (#fcd34d, 12.4:1). Solid, not gradient: gradient text cannot be contrast-verified and smears at 52px.
- Subline: `text-gray-300` (12.1:1, AA pass). Trust line: `text-slate-400` (7.0:1, AA pass) at `text-sm`.
- Primary CTA: solid `bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-full px-7 py-3 shadow-lg shadow-amber-500/20` (12.1:1). One saturated hue in the hero, and it is the CTA (app rule). Ghost link: `border border-white/15 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-full px-7 py-3`.
- Glow behind the phone: `absolute inset-0 -z-10 pointer-events-none` div with `background: radial-gradient(closest-side, rgba(251,191,36,0.16), rgba(168,85,247,0.10) 55%, transparent 75%)` sized ~1.4x the phone and centred on it. Warm centre, purple rim: reads as a stadium light on a brand-coloured field.
- Header CTA should move to the same amber fill, otherwise the page has two primary colours above the fold.

### Layout

- Section: `container mx-auto px-4 pt-10 lg:pt-14 pb-12`.
- Desktop (`lg`+): `grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-12 max-w-6xl mx-auto`. Copy column (left, ~615px): eyebrow `mb-4`, H1 `mb-5`, subline `mb-8`, CTA row `flex flex-wrap gap-3 mb-4`, trust line. Phone column (right): frame **300 x 533** (`lg:w-[300px] lg:h-[533px]`), centred, glow behind.
- Fold at 785px: header 73 + pt 56 = 129; eyebrow 20 + 16 = 165; H1 2 lines x 55 = 275; +20 = 295; subline 2 lines x 30 = 355; +32 = 387; CTA row 52 = **439 (primary CTA bottom)**; trust ends ~475. Phone frame 565px tall starts at ~129 (items-center within a ~565px row) and ends at ~694: whole phone, both pills and the knob visible.
- `md` (768-1023): stacked, copy centred `max-w-2xl`, phone 300 x 533 below. Two columns at `md` would give the copy ~350px and force 4-line headlines.
- Mobile order: eyebrow, H1 (40px, 3 lines), subline, primary CTA (full width, `min-h-[52px]`), ghost link, trust line, then the phone (`max-w-[300px]`). CTA is reachable before any scrolling past media.

### Tradeoffs

- H1 loses "game film", "highlights" and "AI upscaling" as exact-match terms; they survive in the subline, title tag, meta description and the "What is ReelBallers?" block. Minor H1-keyword cost.
- Amber is a new hue for the brand; purple becomes secondary on the landing. Requires the header CTA to follow, and the OG card still shows purple.
- "Shareable in minutes" is a speed claim; the current tagline already makes it, so no new claim.

---

## Direction B: "Game Day"

**Intent:** Bold, fast, athletic. Short fragments in a condensed face, with the app's own cyan so the landing CTA looks exactly like the button the user meets inside the editor. Media-forward: the phone is the biggest thing on screen.

### Copy

| Slot | Text | Words |
|------|------|-------|
| Eyebrow | none | 0 |
| H1 | Game film in. **Sharp highlight out.** | 6 |
| Subline | Phone footage or a Veo, Trace or Hudl export. You frame your athlete; ReelBallers upscales it. | 16 |
| Primary CTA | Start free | 2 |
| Ghost link | See how it works | 4 |
| Trust line | No subscription. Pay only for the AI you use. | 9 |
| BEFORE / AFTER pills | Raw / Highlight | 1 / 1 |

Words before the CTA: 22. Claims check: "export" keeps the honest input claim (a file, not an integration, per `site.ts:80-84`); user frames; AI upscales; singular "highlight".

### Font

- Display: **Barlow Condensed** 600 (SemiBold). Guardrails that keep it off the gym poster: sentence case (never uppercase), weight 600 not 800, no italics, tracking only slightly negative, generous `leading-[0.95]`.
- Body: **Inter** 400/600 (Barlow's regular widths pair badly with the system stack; Inter sits neutrally beside it). If the owner prefers zero body-font cost, system stack is acceptable here.
- `<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600&family=Inter:wght@400;600&display=swap" rel="stylesheet">`
- H1: `font-display font-semibold tracking-[-0.01em] leading-[0.95] text-5xl md:text-6xl lg:text-[4.5rem]` (48 / 60 / 72px). Condensed glyphs at 72px carry less ink than system bold at 60px, which is the "reads heavy" fix. Force the break after "in." with `<br class="hidden lg:block">` so the accent sentence owns its line.
- Subline: `font-sans text-lg md:text-xl text-gray-300 max-w-[38ch]`.

### Colour

- Background: `bg-slate-900`, unchanged. (Optional: hero band `bg-slate-950` fading to slate-900 over the last 96px; ratios below only improve on slate-950.)
- H1: `text-white`, second sentence `<span class="text-cyan-400">` (#22d3ee, 9.9:1).
- Subline: `text-gray-300` (12.1:1). Trust line: `text-gray-400` (7.0:1) at `text-sm`.
- Primary CTA: the app's exact primary: `bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 text-slate-950 font-bold rounded-xl px-7 py-3 shadow-lg shadow-cyan-950/40` (8.3:1). Ghost: as in A.
- Glow: `radial-gradient(closest-side, rgba(6,182,212,0.18), transparent 70%)` behind the phone. Purple stays in the logo only.
- Header CTA switches to the same cyan fill.

### Layout

- Section: `container mx-auto px-4 pt-10 lg:pt-12 pb-12`.
- Desktop (`lg`+): `grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] items-center gap-10 max-w-6xl mx-auto`. Copy left (~625px), phone right at **330 x 587** (`lg:w-[330px] lg:h-[587px]`), frame total ~619px.
- Fold: header 73 + pt 48 = 121; H1 2 lines x 68 = 257; +20 = 277; subline 2 x 30 = 337; +32 = 369; CTA row 52 = **421**; trust ends ~457. Phone 121 to 740: fully visible with 45px to spare.
- `md`: stacked and centred, phone 300 x 533.
- Mobile order: H1 (48px, 2-3 lines), subline, primary CTA, ghost, trust, phone (`max-w-[300px]`).

### Tradeoffs

- Largest brand shift of the three (new display face, cyan primary, purple demoted). Strong continuity with the app, weaker continuity with the current landing and OG card.
- The H1 has no "AI" and no "minutes". Speed and mechanism move to subline/meta.
- Condensed faces polarise; some parents will read it as "sports brand", which is the intent, but it is the least "premium" of the three.
- Two web fonts (Barlow Condensed + Inter) instead of one.

---

## Direction C: "Quiet confidence"

**Intent:** Editorial, near-monochrome, centred. Keep the current structure and brand palette, fix weight and word count, and let the one coloured object (the brand CTA) be the anchor. Closest to the SEO wording of the current tagline.

### Copy

| Slot | Text | Words |
|------|------|-------|
| Eyebrow | none | 0 |
| H1 | Game film into sharp highlights, in minutes. | 7 |
| Subline | Mark the plays, frame your athlete. AI smooths the motion, adds the spotlight, upscales the picture. | 16 |
| Primary CTA | Get started free | 3 |
| Ghost link | See how it works | 4 |
| Trust line | Free to start. No subscription. Pay only for the AI you use. | 12 |
| BEFORE / AFTER pills | Before / After (unchanged) | 1 / 1 |

Words before the CTA: 23. Keeps "game film", "highlights", "minutes", "AI", "upscales" on the page above the fold.

### Font

- Display: **Inter Tight** 600 (SemiBold). Body: system stack unchanged (Inter Tight next to Segoe/SF is close enough that nobody notices the seam).
- `<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@600&display=swap" rel="stylesheet">`
- H1: `font-display font-semibold tracking-[-0.03em] leading-[1.05] text-4xl md:text-[3.5rem] lg:text-6xl` (36 / 56 / 60px). Weight 600 with tight tracking is the whole "reads heavy" fix: same size as today, roughly 25% less ink.
- Subline: `text-lg md:text-xl text-gray-300 leading-relaxed max-w-2xl mx-auto`.

### Colour

- Background: `bg-slate-900`. One ambient radial at the top of the section: `radial-gradient(60% 50% at 50% 0%, rgba(147,51,234,0.14), transparent 70%)` so the navy has depth without a new hue.
- H1: `text-white`, no coloured word. (Optional: "sharp" in `text-purple-300`, #d8b4fe, 10.1:1; I would leave it white so the CTA is the only colour.)
- Subline: `text-gray-300` (12.1:1). Trust line: `text-slate-400` (7.0:1), `text-sm`.
- Primary CTA: keep the brand gradient `from-purple-600 to-indigo-600` with white text (5.4:1 and 6.3:1 at the two ends, AA pass). To make it the anchor, remove every other saturated element in the hero (the bold white pricing line goes; the ghost link stays glass).
- Glow behind the phone: `bg-purple-600/20 blur-3xl` ellipse ~1.3x the phone.

### Layout

- Centred stack, `max-w-3xl mx-auto text-center`, section `pt-10 lg:pt-12 pb-12`.
- Order on ALL breakpoints: H1 `mb-5`, subline `mb-8`, CTA row (primary first) `mb-3`, trust line, then phone `mt-10`.
- Phone **300 x 533** on desktop (frame ~565px), `max-w-[300px]` on mobile.
- Fold: header 73 + pt 48 = 121; H1 2 lines x 63 = 247; +20 = 267; subline 1 line 30 = 297; +32 = 329; CTA 52 = **381**; trust 20 = 413; phone starts 453, knob at 453 + 16 + 266 = **735** (visible), phone bottom at 1018 (below fold, by design: the visible top half with both pills and the pulsing knob is the scroll cue).
- Side white space on desktop is accepted and made intentional by the symmetric glow; the copy block at 768px and the phone at 300px share a vertical axis, which is what balances it.

### Tradeoffs

- Least differentiated visually; a visitor will not remember a "look", only the clarity.
- The phone remains partly below the fold on desktop.
- No colour anchor in the type; if the owner wants "one word that matters" coloured, this is the wrong direction.

---

## TAGLINE constant: what changes and what does not

Grep results: `TAGLINE` is rendered in exactly two places, the index H1 (`index.astro:123`) and an about-page paragraph (`about.astro:62`). JSON-LD (Organization/SoftwareApplication) and llms.txt use `DEFINITION`, not `TAGLINE`. The index meta description (`index.astro:112`) is a hard-coded string literal that happens to begin with the tagline text; it is not bound to the constant.

Recommendation for all three directions: **keep `TAGLINE` as it is** (it feeds the meta description wording, the about page, and it is the owner's 2026-10-19 brand sentence with the "AI upscaling" keyword), and introduce a separate `HERO_HEADLINE` constant in `site.ts` with a comment that it is the on-page H1 and may be more human than the tagline. Nothing in schema changes. If the owner instead falls in love with the new line as the brand tagline, change `TAGLINE` and rewrite the `index.astro:112` description literal in the same commit so the two do not drift; the `<title>` ("Turn Game Footage Into Highlight Reels | ReelBallers") is unaffected either way.

---

## Minimal variant (keep the current tagline as H1)

Smallest change set that fixes the top two problems (CTA below the fold behind ~50 words; unbalanced white space). No new font, no new colour.

1. **Header lockup** to the horizontal unit the app already standardised (`Logo size={40}` beside a single-line `whitespace-nowrap` "Reel Ballers" wordmark). Header drops from ~153px to ~73px. This is also the style-guide fix the landing never received.
2. **H1 sizing:** `text-4xl md:text-5xl font-bold tracking-tight leading-[1.1] max-w-5xl mx-auto` (48px at md+ instead of 60px, container 1024px instead of 768px). The 78-character tagline lands in 2 lines at most widths, 3 at worst (~158px).
3. **Subline:** drop the pricing clause: "ReelBallers puts the focus on your athlete: zoomed in, crisp HD." (11 words).
4. **Move the CTA row above the phone,** primary first in DOM, followed by one muted trust line: `text-sm text-slate-400` "Free to start. No subscription. Pay only for the AI you use." Delete the bold white 19-word pricing line and the 14-word slider caption (caption meaning goes to pills "Your footage / In focus" or stays Before/After).
5. **Phone:** 280 x 498 on desktop (`md:w-[280px] md:h-[498px]`), `max-w-[280px]` on mobile; remove `mb-16` from `BeforeAfterSlider.tsx:212`; page uses `mt-10` above the phone. Add the purple-600/20 blurred ellipse behind it for depth.

Fold check: 73 + 48 = 121; H1 3 lines 158 = 279; +20 = 299; subline 36 = 335; +32 = 367; CTA 52 = **419**; trust 20 + 12 = 451; phone starts 491, knob at 491 + 16 + 249 = 756 (visible). Words before CTA: 11 + 11 = 22.

---

## Agent's recommendation

Pick **Direction A ("Spotlight")**, with the minimal variant's header fix folded in regardless of direction. Reasons: it is the only one whose headline is about the thing the parent actually cares about (their athlete) while naming the product's real differentiator in the subline (user frames, AI smooths, spotlights, upscales), its accent is the product's own visual signature (the spotlight), and the two-column desktop layout lands the CTA at ~440px with the entire phone visible. B is the strongest if the goal is continuity with the app's cyan CTA and a louder sports identity; C is the safe pick if the owner wants to protect the H1 keyword wording. If A is chosen, carry its cyan-vs-amber question to the app later rather than the other way round: the landing can lead on warmth, the editor can stay cyan.

Where I disagree with or sharpen the orchestrator's critique:

- **Point 6, CTA contrast:** the purple-to-indigo gradient is not a WCAG problem (5.4:1 / 6.3:1 white text, 3.3:1 component edge against slate-900). Its problem is salience: it sits on a purple-glowed navy page next to a purple logo, so nothing in the hero is "the one coloured thing". Fix salience by removing competitors (bold white pricing line) and, if changing hue, pick ONE hue for both the accent word and the CTA; do not add a coloured headline word on top of a differently coloured CTA.
- **Point 5, Barlow Condensed:** viable, but only with the guardrails in B (sentence case, 600 weight, no italics). Uppercase condensed at 88px is the gym poster.
- **Point 4, two-column:** yes at `lg`+ only. At `md` the copy column would be ~350px and the headline turns into four lines; keep `md` stacked.
- **Point 1, word budget:** the budget is right, but the bigger lever is DOM order on mobile. Putting the CTA above the 9:16 phone matters more for this audience than shaving five words on desktop.
- **Not in the critique:** the stacked logo lockup is the single largest fold cost (~80px) and is already banned by the project's own style guide; fix it in the same task.
- **Trust line colour:** whatever direction, never `text-gray-500` for the trust line (3.7:1, fails AA). `slate-400` or `gray-400` at 7.0:1 is the muted floor.

---

## Round 2: copy variants for A-look

Scope: copy only. Look is fixed as Direction A (two-column at `lg`+, Plus Jakarta Sans 800 at 52px in a ~615px column, amber-300 accent on the marked H1 words, amber-400 CTA, slate-400 trust line). Line budget: 52px x 0.55em = ~28.6px per character, so ~21 characters per line; every H1 below is given with its forced break (`<br class="hidden lg:block">`) and per-line character counts. Owner rules applied: no youth-only framing, no camera brands, "any video source" or equivalent, "AI focus" present in every set, user frames first, no em dashes, "highlight" singular, truthful pricing.

Ghost link stays "See how it works" in all five sets (not repeated below).

### Set 1: B verbatim, AI focus in the subline

| Slot | Text | Words / chars |
|------|------|------|
| Eyebrow | none | 0 |
| H1 | Game film in. / **Sharp** highlight out. | 6 words; 13 / 20 chars |
| Accent | "Sharp" only (one word, the quality promise) | |
| Subline | Any video source. You frame your athlete; AI focus smooths, spotlights and upscales the rest. | 15 |
| CTA | Start free | 2 |
| Trust | No subscription. Pay only for the AI you use. | 9 |

Words before CTA: 21. Honesty: clean; "You frame your athlete" precedes "AI focus", and "the rest" names AI's share as what remains after framing.

### Set 2: B verbatim, eyebrow carries the source claim, AI focus in the subline

| Slot | Text | Words / chars |
|------|------|------|
| Eyebrow | Any video source. Any league. | 5 |
| H1 | Game film in. / **Sharp highlight** out. | 6 words; 13 / 20 chars |
| Accent | "Sharp highlight" (the product noun) | |
| Subline | Frame your athlete in the wide shot. AI focus smooths the motion, adds the spotlight, upscales. | 16 |
| CTA | Start free | 2 |
| Trust | Free to start. No subscription. Pay only for the AI you use. | 12 |

Words before CTA: 27. Honesty: clean; imperative "Frame your athlete" is the user's action, "in the wide shot" makes it concrete, AI verbs follow.

### Set 3: AI focus in the H1, user action first

| Slot | Text | Words / chars |
|------|------|------|
| Eyebrow | none | 0 |
| H1 | Frame your athlete. / **AI focus** finishes it. | 7 words; 19 / 21 chars |
| Accent | "AI focus" | |
| Subline | Any video source, any league. Smoother motion, a spotlight on your player, upscaled to crisp HD. | 16 |
| CTA | Start free | 2 |
| Trust | No subscription. Pay only for the AI you use. | 9 |

Words before CTA: 23. Honesty: strongest of the five; the headline itself states the order (you frame, then AI finishes), so "AI focus" cannot be read as tracking. Line 2 is at the 21-character ceiling; if it wraps on a narrow `lg` viewport, "AI focus finishes." (18 chars) is the fallback.

### Set 4: AI focus in the H1, positioning echo

| Slot | Text | Words / chars |
|------|------|------|
| Eyebrow | Any camera, any league | 4 |
| H1 | Your athlete, / in **AI focus**. | 5 words; 13 / 12 chars |
| Accent | "AI focus" | |
| Subline | You frame the play, from any video source. AI focus smooths, spotlights and upscales it. | 15 |
| CTA | Make a highlight free | 4 |
| Trust | No subscription. Pay only for the AI you use. | 9 |

Words before CTA: 24. Honesty: the H1 alone is ambiguous ("in AI focus" can be read as the AI putting the athlete in focus by itself); the subline repairs it with "You frame the play" as the first clause, but the repair happens one line too late. Also the shortest lines of the five; at 52px they fill about 370px of the 615px column (a sizing change is out of scope this round, noted only).

### Set 5: B verbatim, speed and source in the subline

| Slot | Text | Words / chars |
|------|------|------|
| Eyebrow | none | 0 |
| H1 | Game film in. / **Sharp** highlight out. | 6 words; 13 / 20 chars |
| Accent | "Sharp" | |
| Subline | From any video source, in minutes. You frame your athlete; AI focus smooths, spotlights and upscales. | 16 |
| CTA | Try it free | 3 |
| Trust | Free to start. No subscription. Credits never expire. | 8 |

Words before CTA: 22. Honesty: clean; same "You frame ... ; AI focus ..." order as Set 1. "In minutes" is the speed claim already made by the current tagline. Trust line swaps "pay only for the AI you use" for "credits never expire"; both are in `FACTS.pricingSummary`, pick whichever the owner wants above the fold.

### Ranking

1. **Set 1.** It is the owner's chosen starting point unchanged, puts "AI focus" exactly where the honesty rule wants it (after "You frame your athlete", with "the rest" bounding what the AI does), replaces the brand names with "any video source" in three words, and is the shortest set (21 words before the CTA). Accenting only "Sharp" keeps one amber word on line 2 rather than a whole amber line, which reads better against an amber button directly below.
2. **Set 3.** The pick if the owner wants "AI focus" in the headline itself. It is the only set whose H1 tells the visitor their own role, which is the honesty rule built into the biggest type on the page; the cost is losing the "game film in, highlight out" transformation line.
3. **Set 5.** Set 1 with the speed claim; worth it only if "in minutes" is considered a must-keep from the tagline.
4. **Set 2.** The eyebrow earns its place ("any league" answers the adult-league point without a word in the subline), but 27 words before the CTA is the most of the five.
5. **Set 4.** The prettiest and the riskiest; the H1 on its own can be read as auto-focus, and a headline should not need its subline to stay honest.

### "AI Focus" capitalization

Lowercase: **"AI focus"**, as a descriptive phrase, not a capitalized feature name. Reason from the frontend source: the in-app mode is NOT called "Focus". `src/frontend/src/config/displayNames.js:266-270` defines `MODE_NAMES = { ANNOTATE: 'Mark Plays', FRAMING: 'Framing', SPOTLIGHT: 'Spotlight' }` (T9860), the header switcher label is `'Frame'` (`MODE_SWITCHER_NAMES.FRAMING`, line 276), and the comment at lines 162-164 says the verb "Frame" was chosen "deliberately NOT the old 'Focus' mode name". The word "focus" survives in-app only as a lowercase verb in the mode description (`line 300: 'Focus the action on your player, crop out everything else.'`) and in `DIVISION_OF_WORK` (line 421-422: "You mark the best plays and frame your player. We smooth the motion, sharpen the picture, and build a highlight you can share."). A Title Case "AI Focus" on the landing would promise a named feature that a new user then cannot find in the app (they meet "Frame" and "Spotlight"). Lowercase "AI focus" reads as what the AI does after framing, matches the in-app verb usage, and matches the landing's existing "puts the focus on your athlete" line. If the owner wants a capitalized feature name, the app has to adopt the same label first (a separate task); the premise that the in-app mode is called "Focus" is stale (the knowledge doc still says "Focus (formerly Framing)"; the code says the reverse).
