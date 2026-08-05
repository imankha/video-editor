# T6540 — Card editor information-design critique

**Author:** UX specialist pass, 2026-08-05
**User signal (first real use):** *"TBH this UX is hard to parse."*
**Premise:** every control is correct and behaves correctly. The defect is
*arrangement* — how the controls are grouped, weighted, and labelled. This doc is
the reasoning trail; implementation follows it directly (the approval gate was
waived by the user, who wants to review a finished result).

The editor is two columns inside a modal: a **Stage** (left — the live card, aspect
toggle, photo drag, zoom slider, motion-preview button, composition badge) and a
**Rail** (right — a flat scrolling column of five sections: *Show on the card*,
*Treatment*, *Photo*, *Text*, and a public-exposure notice). The critique is
organised by named UX principle; each names the concrete violation and the fix.

---

## 1. Visual hierarchy — nothing is "first"

**Principle.** A view should answer "where do I look first?" before it answers
anything else. Hierarchy is created by *differences* in weight, size, position and
spacing. When every element carries the same weight, the eye has no entry point and
must read everything to find anything — which is exactly the "hard to parse"
complaint.

**Violation.** The rail is five `text-xs font-semibold uppercase tracking-wide
text-gray-400` section headers, identical in every visual dimension, stacked in one
`space-y-5` column. "Show on the card" (the primary decision — *what facts appear*)
looks exactly like "Treatment" (a look tweak) looks exactly like "Text" (a
per-slot styling drawer). Eight-ish uppercase labels compete equally, so none wins.

**Why it matters here specifically.** The epic's whole model is two independent
axes: **content** (which facts show → the composition re-lays-out) and **look**
(treatment / font / colour / shadow / stroke). A flat list hides that structure.
The user cannot see that facts are one kind of thing and styling is another.

**Fix.** Impose a two-tier hierarchy that mirrors the mental model:
- **Content tier (top, always open):** *Show on the card* — the facts, the primary
  decision. Give it the most prominent treatment.
- **Look tier (grouped):** treatment + the selected slot's typography. These are
  refinements; they should read as secondary.
- Demote the fifth "section" (the exposure notice) to a quiet footer — it is not a
  control and should not sit at control weight.

---

## 2. Proximity / grouping (Gestalt) — one object split across two columns

**Principle.** *Law of Proximity:* elements placed close together are perceived as
one group; elements placed apart are perceived as unrelated. Controls that operate
on one object must be co-located, or the user won't know they belong together.

**Violation (the sharpest one).** The **photo** is one object with three controls —
*reframe by dragging*, *zoom*, *remove/replace* — split across both columns: drag +
zoom live under the Stage on the **left**, while Remove/Replace live in the Rail's
"Photo" section on the **right**. Proximity actively signals they are unrelated.
The user reads zoom as "a stage thing" and Replace as "a rail thing," when they are
the same object.

**Fix.** Unify the photo. The zoom slider belongs with Remove/Replace under a single
"Photo" heading. Two viable placements:
- (a) Move zoom into the Rail's Photo section (all photo controls in one place), or
- (b) Keep zoom on the Stage (it is spatially bound to the image the user is
  dragging) but make the Rail's Photo section clearly the *same* object.

I take **(a)**: the drag gesture stays on the Stage (it is direct manipulation of
the image and must be), but the *sliders and buttons* — the indirect controls —
consolidate into one Photo group in the rail: thumbnail, Replace, Remove, and Zoom
together. Direct manipulation (drag) on the canvas; indirect controls in the panel.
That is the standard editor split (Figma, Canva) and it removes the cross-column
tear without moving the one control (drag) that must stay on the image.

---

## 3. Progressive disclosure — expert dials at equal weight

**Principle.** Show the essential; reveal the advanced on demand. Rarely-touched
expert controls at the same weight as primary ones add noise and slow the common
task.

**Violation.** In the per-slot styling drawer (shared `TextSpecEditor`), **Shadow
blur** and **Stroke width** are full-weight rows sitting level with Font and Colour.
For a card editor the common edits are the facts, the treatment, and maybe the
title colour; shadow/stroke are fine-tuning that most users never touch. They pad
the rail and push more important things below the fold.

**Fix.** Put Shadow blur + Stroke width behind a disclosure ("Effects" /
`<details>`), collapsed by default, inside the styling drawer. This must be done via
the shared editor's existing opt-in prop pattern so the **overlay** host (T5225) is
unaffected — a new `collapseEffects`-style prop the card rail opts into, default
off. Font and Colour stay visible; the two effect sliders move one click away.

---

## 4. Recognition over recall + affordance — the composition badge reads as debug

**Principle.** *Recognition over recall:* the UI should show the current state in
plain language, not require the user to remember or decode it. *Affordance/feedback:*
a status readout should look like product copy, not like a developer's console.

**Violation.** The single visible explanation of the editor's most distinctive
behaviour — *ticking facts re-lays-out the card, there is no template picker
(epic decision 2)* — is a `text-[11px] text-gray-200` lowercase token
(`hero` / `broadcast` / `recruiting` / `title-only`) tucked in the stage's
bottom-left corner. It reads as a debug label. A first-time user has no way to
connect "I ticked Team" to "the layout changed" because the only signpost looks
like leaked internal state.

**Fix.** Two moves:
- Make the composition legible as **product feedback**. Give it a human sentence
  ("Layout: Hero" with a one-line "adjusts as you choose facts" rather than a bare
  lowercase slug), and title-case the name. Anchor it where the causal link is
  visible — near the *Show on the card* control that causes it, and/or as a clean
  caption on the stage rather than a corner console string.
- **Signpost the causality** at the facts group: a short helper line ("The card's
  layout adapts to the facts you choose") so the re-layout reads as *designed*, not
  as a glitch.

---

## 5. Recognition over recall — the lone `TEXT → Title` slot chip

**Principle.** A selector implies a choice. Offering a "selector" with exactly one
option is a recognition failure: it looks like a button that does something, but
there is nothing to choose, so it only raises "what is this?"

**Violation.** The Rail's "Text" section renders a row of slot chips (`Title`,
plus one chip per shown fact). With the default card (title + one fact) it is
often a **single** `Title` chip — a highlighted pill that selects the only slot
that exists. It reads as a stray, unexplained button.

**Fix.** The slot chips are a *picker across styleable text slots*. When there is
only one styleable slot, don't render the picker at all — just show that slot's
styling under a clear heading ("Title style"). Render the chip row only when there
are ≥2 slots to switch between (i.e. when facts are shown). This also ties the
styling drawer to the current selection made on the stage.

---

## 6. Consistency — match the established rail pattern

**Principle.** Reuse the app's existing vocabulary rather than inventing a new one;
consistency lowers the learning cost of every new surface.

**Observation.** `OverlaySettingsCard` is the app's established right-rail idiom, and
`.claude/references/ui-style-guide.md` codifies a "borderless inline filter row"
pattern (uppercase mini-label + wrapping controls; card chrome reserved for content,
not control clusters) and dark-theme card panels (`bg-gray-800 border-gray-700
rounded-lg p-4`) for grouped content. The redesign should express its two tiers with
these existing tokens (a subtle grouping container for the "look" tier, borderless
label rows for chip groups) rather than a bespoke divider system.

---

## 7. Touch targets — 44px floor on coarse pointers

**Principle.** A coarse-pointer (finger) target below ~44px is a mis-tap risk;
WCAG/native guidance sets 44px as the floor. The repo already ships `coarse-pointer:`
and `fine-pointer:` Tailwind variants for exactly this.

**Violation.** At 375px the fact checkboxes are `w-4 h-4` (16px) with a text label,
the slot chips are `px-2.5 py-1 text-xs` (short), and the treatment buttons are
narrow thirds. None guarantees a 44px hit height on a phone.

**Fix.** Give the interactive rows/chips `coarse-pointer:min-h-[44px]` (the pattern
the style guide's filter-chip and DraftTile entries already use) so mobile taps meet
the floor while desktop stays compact. Ensure the checkbox *row* (label included) is
the hit target, not just the 16px box.

---

## 8. Mobile (375px) layout — the column stacks; verify no cramping

**Principle.** A narrow viewport must not clip, overflow horizontally, or cram
controls. The container already switches `flex-col lg:flex-row`, so on mobile the
Stage stacks above the Rail.

**What to verify in the browser (not from source):** the stage box math
(`STAGE_MAX_W 480`) vs a 375px viewport with modal padding; that the treatment
3-across row doesn't crush its labels; that nothing scrolls horizontally; that the
rail's own `overflow-y-auto` scrollbar isn't fighting the modal's scrollbar (a
double-scroll region is itself a parse problem). Captured before/after at 375px.

---

## 9. The modal-bounds question (item 6)

**Report:** a reel card ("Brilliant Dribble / Move to My Reels / Preview") appeared
inside the modal's left column in the user's screenshot.

**Reading from source.** `IntroCardsModal` is `fixed inset-0 z-50 flex items-center
justify-center bg-black/70 backdrop-blur-sm` with an **opaque** `bg-gray-900` panel
`max-w-5xl h-[85vh]`. The editor's Stage column contains only: aspect toggle, card,
zoom, motion-preview button — *nothing* renders below the motion button. So misplaced
*content inside the panel* is not possible from this tree. At 1440px the `max-w-5xl`
(1024px) panel leaves ~200px of margin each side, over which the semi-transparent
(`/70`) backdrop shows the **page behind** (the My Reels drawer, which contains reel
cards) dimmed but visible. A reel card sitting to the *left of / behind* the panel is
almost certainly that bleed-through, not leaked content.

**To confirm in-browser and decide:** reproduce the full modal over a populated page
and check whether the reel card is inside the opaque panel (a real layering bug → fix
by raising panel opacity / z-index / bounds) or outside it in the dimmed margin
(expected backdrop behaviour → optionally deepen the scrim so it reads less like
"content," but not a bug). Resolution recorded in the final report.

---

## Summary of moves (each tied to a principle)

| # | Change | Principle |
|---|--------|-----------|
| 1 | Two-tier rail: **Content** (facts, prominent) vs **Look** (grouped) | Hierarchy |
| 2 | Unify Photo: zoom slider joins Remove/Replace in one Photo group | Proximity |
| 3 | Shadow/stroke behind a collapsed "Effects" disclosure (opt-in prop) | Progressive disclosure |
| 4 | Composition badge → human "Layout: Hero" caption + causal helper line | Recognition, affordance |
| 5 | Hide the slot picker when there's one slot; label it "Title style" | Recognition over recall |
| 6 | Express tiers with existing style-guide tokens, not a bespoke system | Consistency |
| 7 | `coarse-pointer:min-h-[44px]` on fact rows, chips, treatment buttons | Touch targets |
| 8 | Verify 375px: no overflow, no cramping, single scroll region | Responsive |
| 9 | Resolve the reel-card-in-modal question in the browser | Correctness |
</content>
</invoke>
