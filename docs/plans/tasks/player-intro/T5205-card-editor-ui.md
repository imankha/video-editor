# T5205: Intro card editor UI

**Status:** TODO
**Impact:** 7 | **Complexity:** 5
**Epic:** [Player Intro + Rich Text](EPIC.md) — depends on [T5195](T5195-intro-card-library.md)

> Read [EPIC.md](EPIC.md) (decision 2: templates with named slots, no free dragging in v1).
> UI mockups (library grid + editor): <https://claude.ai/code/artifact/93478a34-c7e5-406f-a56b-3c3724e4b6dd> § 06 A and B.
> Reference: `.claude/references/ui-style-guide.md`, `src/frontend/CLAUDE.md` (MVC, data-always-ready).

## Contract ownership (wave decision 2026-08-04)

T5210 runs in PARALLEL and **owns the shared contract** — slot geometry (normalised rects per
composition, 9:16 and 16:9) and the motion timing constants — landing it on master as an early
standalone commit with a JS mirror for you to import.

**Do not invent either set of numbers.** Start on everything that does not depend on them (library
grid, create/duplicate/default/delete, right-rail TextSpec controls, photo drag + zoom, consent,
public-exposure notice), then rebase on master and consume the contract for the stage geometry and
the motion preview. If you find yourself typing a slot position or an animation duration, stop —
that value belongs to T5210.

## Problem

The card library ([T5195](T5195-intro-card-library.md)) has an API and no way to use it. This task
is the surface where a user creates a card, puts their kid's photo on it, types text, and styles it.

## Scope

### A. Library grid

- Entry point: profile settings ("Intro cards"), reachable from `ManageProfilesModal` / the profile
  menu. One card per tile at the card's own aspect ratio, showing the **rendered preview** (the
  browser preview, not a backend render — no backend call to look at your library).
- The default card is visibly marked. Actions: new, edit, duplicate, set default, delete.
- **Duplicate matters** — epic decision 3 dropped the athlete field set, so "same name and number,
  new title" is the retyping case duplicate exists to cover.
- Deleting a card asks first and says what happens to reels using it (they fall back to the default).

### B. The editor

Two panes: the **stage** (the card at its real aspect ratio) and a **right rail** for the selected
element.

- **NO template picker** (epic decision 2, revised 2026-08-04). The user ticks **which facts to
  show** — position, class, team — and the composition is derived:
  `no photo -> title-only`, `photo + 1 -> hero`, `photo + 2 -> broadcast`, `photo + 3 -> recruiting`.
  Read the mapping from the ONE shared helper T5195 defines; never re-implement it here.
  - The stage re-composes live as facts are ticked, so the rule is visible rather than explained.
  - Name the current composition somewhere quiet on the stage so the change is legible, not magic.
  - Field VALUES come from the profile and are auto-filled; the editor chooses *whether* each
    appears. A ticked field the profile hasn't filled shows an inline prompt to fill it (with a link),
    never a silently missing line.
- **Treatment toggle** — `gold` / `dark` / `photo-forward`, an independent 3-way control
  (epic decision 2b). This is what stops a third fact from silently restyling the card.
- **Photo reposition + zoom** (epic decision 3b) — drag the photo directly on the stage to
  reposition, plus a zoom slider. Stored as normalised `focal_x`/`focal_y`/`zoom`, NOT a crop
  rectangle, so one setting serves both 9:16 and 16:9 output. Commit on drag-end / slider-release
  (one gesture, one surgical PATCH — not per pointer-move).
  - Provide an aspect preview toggle (9:16 / 16:9) so the user can confirm framing for both before
    saving. This is the whole reason a focal point beats a crop; make it visible.
- **Stage** composes the treatment background + the image + one
  [`RichText`](T5180-rich-text-engine.md) component per slot. Clicking a slot selects it.
- **Right rail** edits the selected slot's TextSpec: text, font (the **4**-face catalogue - anton, oswald, graduate, playfair; T5180 cut it from six in f0f28d4a, so read the live manifest rather than hardcoding - with each name
  set in its own face), size (S/M/L/XL mapping to normalised values — not a raw number field),
  colour (swatches + custom picker), alignment. These four controls are the user-facing meaning of
  "control font and font colour".
- **Image**: pick/replace via [T5190](T5190-card-image-upload-consent.md)'s endpoint; show the
  consent checkbox at first use and block saving a card until consent is recorded.
- **Motion preview** — a button that plays the template's animation **in the browser** (CSS/JS
  mirroring the card's timing), so the user can judge the motion without a backend render. It is a
  preview of the real thing, so its timings must be read from the same constants T5210 encodes with;
  duplicating the numbers in two files is how they drift.
- **Public-exposure notice** in the editor: *"Anyone with the share link can see this card."*

### C. Persistence

- **Gesture-based, surgical** (project rule): each edit commits on its own gesture — blur, picker
  close, drag end — sending ONLY the changed field via `PATCH /api/intro-cards/{id}`.
- **No `useEffect` that watches editor state and writes.** Typing does not hit the API on every
  keystroke; it commits on blur or explicit save.
- Local editor state is React; the persisted card list is the Zustand store from T5195. Do not hold
  API data in `useState`.

### D. Structure

Screen -> Container -> View per `src/frontend/CLAUDE.md`. `RichText` stays presentational and
store-free (it is also used by [T5225](../overlay-text/T5225-overlay-text-layer.md) inside the Overlay screen).

## Relevant files
- `src/frontend/src/components/ManageProfilesModal.jsx` — entry point precedent
- `src/frontend/src/components/RichText.jsx` — from T5180
- `src/frontend/src/stores/introCardStore.js` — from T5195
- `src/frontend/src/components/OverlaySettingsCard.jsx` — an existing style/control panel to match
- `.claude/references/ui-style-guide.md`

## Classification hint
L-tier, frontend-only. **ui-designer agent recommended** before implementation (the mockups set
hierarchy, not final pixels). Reviewer required. Real-browser verification is mandatory — selection,
pickers and the motion preview are pointer/visual behaviour that jsdom will pass falsely (T5380).

## Acceptance criteria
- [ ] A user can create, name, duplicate, edit, delete cards and set the default from the grid.
- [ ] **No template picker exists.** Ticking facts re-composes the stage live through all four
      compositions (title-only / hero / broadcast / recruiting), driven by the shared helper.
- [ ] The treatment toggle changes the look **without** changing the composition, and ticking a
      third fact changes the composition **without** changing the look.
- [ ] Removing the photo falls back to `title-only`; re-adding it restores the fact-driven composition.
- [ ] A ticked fact the profile hasn't filled prompts the user inline — the line is never silently absent.
- [ ] The photo can be dragged and zoomed on the stage, and the SAME setting frames correctly in
      both the 9:16 and 16:9 previews.
- [ ] Selecting a slot and changing text / font / size / colour / alignment updates the stage live.
- [ ] The image can be added and replaced; consent is required before a card can be saved.
- [ ] Motion preview plays in the browser with the same timings the renderer uses.
- [ ] Every save is a gesture-driven surgical PATCH; drag/zoom commits once on release, not per move.
- [ ] Verified in a real browser with screenshots, not only unit tests.
