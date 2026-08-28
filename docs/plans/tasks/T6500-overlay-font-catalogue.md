# T6500: A font catalogue for overlay text (the current four are intro-card faces)

**Status:** STAGING
**Impact:** 6 | **Complexity:** 4
**Follows:** [T5180](player-intro/T5180-rich-text-engine.md), [T5225](player-intro/T5225-overlay-text-layer.md)

## Problem

User, 2026-08-04, after using the overlay text editor on staging:

> Need some more fonts for overlay purposes as opposed to intro cards which the current font set is
> optimized for.

The four-face catalogue (`anton`, `oswald`, `graduate`, `playfair`) was chosen for **intro cards** —
a full-frame, mostly-caps, display context. It was deliberately cut from six during T5180
(`f0f28d4a`). Overlay text is a different job: short callouts burned over live footage, read at a
glance, often small and competing with a busy background.

The existing rationale, worth carrying (from the T5180 font review):
- **Anton is display-only** — genuinely cramped at ~15px.
- **Graduate is wide** — a badge face for a number or a short word, not a detail line.
- **No neutral sans was added, deliberately.** The concern that nothing reads well at support size
  did not survive looking at Oswald at 15px. If small print reads badly in real use, add one THEN.

Overlay use is exactly the "THEN" that condition was waiting for.

## Scope

- Decide whether the catalogue **splits by context** (an overlay set + an intro-card set) or simply
  **grows** with every face available everywhere. Splitting keeps each picker short and honest;
  growing is less machinery. This is the task's main design question — put it to the user with
  rendered samples, not prose.
- Add faces suited to burned-in overlay text: at least one genuinely neutral sans that holds up
  small over video, and something with enough weight to survive a bright background.
- **Both sides must ship the face.** A font is only real when `text_render.py` (Pillow, backend) and
  `RichText.jsx` (browser) resolve the SAME file — the T5180 parity test is what proves it.
- Licensing: every face must be redistributable (the current four are OFL). Record the licence.

## Landmines
- Fonts load from `/api/fonts/...` and MUST be resolved through `config.resolveApiUrl` — a bare path
  hits the SPA catch-all in staging/prod and silently falls back for every face (fixed in
  `5e535e78`; do not reintroduce).
- Variable faces need `@font-face` `font-weight` declared as the full **range**, with the pinned
  instance applied via `font-variation-settings` — see the T5180 notes in `RichText.jsx`.
- Untested to date and worth checking with any new face: **lowercase** (all prior comparisons were
  caps) and a **genuinely long string** at small size.

## Relevant files
- `src/backend/app/services/fonts.py` + `app/assets/fonts/` — the manifest and the TTFs
- `src/backend/app/services/text_render.py` — backend rasteriser
- `src/frontend/src/components/RichText.jsx` — browser preview + `@font-face` injection
- `src/frontend/src/constants/textSpec.js` — `FontKey`
- `src/backend/tests/test_t5180_text_render.py`, `e2e/T5180-text-parity.spec.js`

## Classification hint
M/L-tier depending on the split decision. Backend + Frontend. No schema change (`font` is a string
in the TextSpec). **ui-designer worth including** for the sample comparison.

## Acceptance criteria
- [ ] The split-vs-grow question is decided by the user against RENDERED samples, not description.
- [ ] New faces render identically backend and browser — parity test extended and passing.
- [ ] Each new face is checked at overlay sizes over real footage, in caps AND lowercase, with a long string.
- [ ] Licences recorded for every added face.
- [ ] The intro-card picker and the overlay picker each show the faces appropriate to their context.
