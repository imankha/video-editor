# T6620: Shadow blur is inert by construction, the profile name can never reach an existing card, and "Title" should read "Athlete Name"

**Status:** TODO
**Impact:** 7 | **Complexity:** 2
**Follows:** [T6570](T6570-card-title-from-profile-full-name.md) (title from profile),
[T5225](player-intro/T5225-overlay-text-layer.md) (overlay text spec)

Three defects from staging use, 2026-08-05. Items 1 and 2 are **root-caused and proven** — do not
re-investigate, verify the fix instead.

## 1. BUG — the Shadow blur slider can never do anything

User: *"Shadow blur doesn't seem to have any effect."* Correct, and it is structural:

```js
// src/frontend/src/components/RichText.jsx:233
const textShadow = spec.shadow.opacity > 0 ? `0 0 ${blurPx}px ${shadowRgba}` : 'none';

// src/frontend/src/screens/OverlayScreen.jsx:61 — every new overlay text block
shadow: { blur: 0, color: '#000000', opacity: 0 },
```

The shadow is gated entirely on `opacity > 0`; new overlay text defaults to **opacity 0**; and the
overlay editor exposes **only blur**, no opacity. So dragging Shadow blur mutates a value the
renderer refuses to use. The control is inert for every overlay text block ever created.

**Decide and state which fix:**
- (a) **Blur implies a shadow** — when `blur > 0`, treat opacity as a sensible default (e.g. 0.6)
  wherever the spec is resolved. One control, no new UI, matches the user's mental model.
- (b) **Expose opacity** as a second slider. Honest but adds a control to a rail already reported
  as cramped, and leaves "blur with opacity 0" still doing nothing.

(a) is recommended. Whichever is chosen, **it must hold in BOTH the browser preview and the burned-in
export** — `RichText` (preview) and the Python text renderer must agree, or the user sees a shadow
that does not survive export. Check whether the card editor's shadow (which has its own defaults via
`defaultStyling`, `TITLE_SHADOW`/`FACT_SHADOW`) is affected by the same gate before changing shared
code.

**Also check stroke width** for the same class of defect — it sits next to blur in the same rail and
`stroke: { width: 0, color: '#000000' }` has the same shape.

## 2. BUG — an existing card can never show the profile's full name

User: *"I added my players name but don't see it pull into the Card."*

```js
// src/frontend/src/components/introcards/introCardPreviewElements.js:30
export function resolveTitleText(card, profile) {
  const legacy = (card?.title_text || '').trim();
  if (legacy) return legacy;                    // <- always wins
  return (profile?.full_name || '').trim();
}
```

T6570 made legacy `title_text` a **grandfathered override**, and in the same change **removed the
title text box**. So any card created before T6570 (the user's card holds `"New card 1"`) ignores the
profile forever, and there is now **no UI that can clear the override**. The grandfathering was
defensible; deleting the only escape hatch in the same commit is what made it a trap.

**Fix: the profile always wins.** Stop reading `title_text` as an override. Decide and state what
happens to the stored values — dropping them (or a migration that nulls them) is preferable to
leaving dead data that a future reader mistakes for meaningful. Update the schema comment on
`intro_cards.title_text` and the v034 migration comment so neither still claims override semantics.
Preview and export must both change (`resolveTitleText` and `player_intro`'s `field_values`).

## 3. The eye button does not turn the text off — REPRODUCE THIS FIRST

User: *"The 'eye' button on the text doesn't actually turn off that text."*

Supervisor investigation on the REAL Overlay screen established:
- The toggle's **state flips correctly**: the button title alternates `Hide text (keep block)` <->
  `Show text`, and the timeline block's class alternates `bg-opacity-20` <-> `bg-opacity-10`.
- `TextOverlayPreview.jsx:32` DOES filter `if (block.enabled === false) return false;`.
- **Whether the rendered text actually disappears from the preview is UNRESOLVED.** A stage
  screenshot differs between states by ~18 bytes, which is indistinguishable from the next video
  frame, and DOM queries for the rendered text node did not isolate it.

So the state and the filter both look right, which means the defect is likely one of: the preview
element that shows the text is NOT `TextOverlayPreview` (a second render path); `enabled` is
`undefined` rather than `false` on blocks loaded from the DB (the filter tests `=== false`, so
`undefined` renders); or the flag is dropped on the persist/restore round-trip. **Check the
undefined-vs-false case first** — it exactly fits "works in a fresh session, not on a loaded card".

**Also verify the EXPORT honours it.** A block hidden in the preview that still burns into the MP4 is
the worse half of this bug and is not covered by any current test.

To reproduce reliably: pause the video first (so pixels are stable), then compare the stage with the
text shown vs hidden.

## 4. Rename "Title" to "Athlete Name"

User: *"Instead of calling it 'Title' we should call it 'Athlete Name' on the intro card editor."*

Rename the slot label in the card editor. Now that the text comes from the profile's Full Name and
cannot be typed per-card, "Title" describes a text box that no longer exists. Keep the underlying
slot key (`title`) unchanged — this is a LABEL change only; renaming the geometry key would break the
shared contract and its parity test. Check the label in the slot chips, the TEXT/slot picker, and
any aria-label or helper copy that says "Title".

## Relevant files
- `src/frontend/src/components/RichText.jsx:222-233` — the shadow gate
- `src/frontend/src/screens/OverlayScreen.jsx:55-64` — `DEFAULT_TEXT_SPEC`
- `src/frontend/src/components/introcards/introCardPreviewElements.js:30` — `resolveTitleText`
- `src/backend/app/services/player_intro.py` — export-side title resolution (must match)
- `src/frontend/src/components/introcards/IntroCardRail.jsx` — the "Title" label
- `src/backend/app/migrations/profile_db/v034_intro_card_library.py` — the `title_text` comment

## Classification hint
M-tier. Frontend + Backend (export parity). Reviewer required. A migration is only needed if you
choose to null the legacy values — say which.

## VERIFICATION — read this before writing the tests

The T6610/T6480 specs drove `/textdiag.html` and `/textspecdiag.html` and called
`skipOnDeployedTarget`, so they never exercised the real screens and reported green while two of
their acceptance criteria were unmet in the app. **Do not repeat that.**

- Verify on the **REAL Overlay screen and the REAL card editor**, driven as a real user
  (`loginAsRealUser` + the `pendingProjectId` / `pendingProjectMode` sessionStorage breadcrumb, then
  `/overlay`). A diag harness may supplement, never substitute.
- Use an **EXISTING, DB-loaded** card and text block (reload the page first), not only one created
  in-session — the title-override bug only manifests on a pre-existing card.
- **Re-measure element geometry immediately before every pointer interaction.** Clicking opens or
  updates the rail and shifts layout; stale coordinates press on empty space and look exactly like a
  broken feature. Assert `document.elementFromPoint(x, y)` is the intended element BEFORE pressing.
- The timeline lane is far wider than the viewport at zoom — a fraction-of-width coordinate lands
  off-screen. Clamp to the visible area.

## Acceptance criteria
- [ ] Moving Shadow blur produces a visibly different rendered result in the browser preview.
- [ ] The same shadow appears in the exported/burned-in video (preview and export agree).
- [ ] Stroke width checked for the same gate defect; fixed or explicitly cleared.
- [ ] A card created BEFORE this change shows the profile's Full Name, with no per-card edit.
- [ ] Changing the profile's Full Name updates every card, including legacy ones.
- [ ] Stored `title_text` handling is implemented and documented; no comment still claims override.
- [ ] The card editor says "Athlete Name"; the `title` slot key and the shared contract are unchanged.
- [ ] Evidence per criterion from the REAL screens with an EXISTING record, not a harness.
